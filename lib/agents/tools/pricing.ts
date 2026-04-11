import { PRODUCTION_SERVICES } from '@/lib/constants';
import { createAdminClient } from '@/lib/supabase/server';

// ─── Rate Suggestion Types ──────────────────────────────────────────────────

export interface RateSuggestion {
  category: string;
  suggestedHourlyRate: number;
  marketRange: { low: number; high: number };
  confidence: 'low' | 'medium' | 'high';
  reasoning: string;
}

export interface MarketComparison {
  category: string;
  currentRate: number;
  marketAverage: number;
  position: 'below_market' | 'at_market' | 'above_market';
  percentDifference: number;
}

// ─── Market Rate Data ──────────────────────────────��────────────────────────
// Derived from PRODUCTION_SERVICES in constants.ts + SA market research

function getMarketRates(): Record<string, { low: number; mid: number; high: number }> {
  const photo = PRODUCTION_SERVICES.photography.portrait.rate;
  const video = PRODUCTION_SERVICES.cinematography.shortForm.rate;
  const post = PRODUCTION_SERVICES.postProduction.photoRetouch.rate;

  return {
    photography: { low: Math.round(photo * 0.6), mid: photo, high: Math.round(photo * 1.8) },
    cinematography: { low: Math.round(video * 0.6), mid: video, high: Math.round(video * 1.8) },
    postProduction: { low: Math.round(post * 0.6), mid: post, high: Math.round(post * 1.8) },
    wedding: { low: 1200, mid: 1800, high: 3500 },
    corporate: { low: 1500, mid: 2500, high: 5000 },
    music_video: { low: 2000, mid: 3500, high: 8000 },
    content_creation: { low: 800, mid: 1500, high: 3000 },
    documentary: { low: 1500, mid: 2500, high: 5000 },
    event: { low: 1000, mid: 1800, high: 3500 },
  };
}

// ─── Suggest Rates ──────────────────────────────────────────────────────────

export async function suggestRates(creatorId: string): Promise<RateSuggestion[]> {
  const supabase = createAdminClient();
  const marketRates = getMarketRates();

  // Get creator profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('specializations, years_experience, hourly_rate, location')
    .eq('id', creatorId)
    .single();

  if (!profile) return [];

  const specializations = (profile.specializations ?? []) as string[];
  const experience = (profile.years_experience ?? 0) as number;

  // Get creator's review stats
  const { data: reviews } = await supabase
    .from('reviews')
    .select('rating')
    .eq('reviewee_id', creatorId)
    .eq('is_published', true);

  const ratings = (reviews ?? []).map((r: { rating: number }) => r.rating);
  const avgRating = ratings.length > 0
    ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length
    : 0;

  // Get portfolio analysis count for quality signal
  const { count: portfolioCount } = await supabase
    .from('portfolio_analysis')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', creatorId);

  const suggestions: RateSuggestion[] = [];

  for (const spec of specializations) {
    const market = marketRates[spec] ?? marketRates.photography;

    // Calculate experience multiplier (0-10 years mapped to 0.8-1.4)
    const expMultiplier = 0.8 + Math.min(experience, 10) * 0.06;

    // Rating multiplier (3.0-5.0 mapped to 0.9-1.2)
    const ratingMultiplier = avgRating > 0
      ? 0.9 + (Math.min(avgRating, 5) - 3) * 0.15
      : 1.0;

    // Portfolio quality signal
    const portfolioMultiplier = (portfolioCount ?? 0) > 10 ? 1.05 : 1.0;

    const suggestedRate = Math.round(
      market.mid * expMultiplier * ratingMultiplier * portfolioMultiplier,
    );

    // Clamp to market range
    const clampedRate = Math.max(market.low, Math.min(suggestedRate, market.high));

    const confidence: 'low' | 'medium' | 'high' =
      ratings.length >= 5 && experience >= 3 ? 'high' :
      ratings.length >= 1 || experience >= 1 ? 'medium' : 'low';

    const parts: string[] = [];
    if (experience > 0) parts.push(`${experience} years experience`);
    if (avgRating > 0) parts.push(`${avgRating.toFixed(1)} avg rating from ${ratings.length} reviews`);
    if ((portfolioCount ?? 0) > 0) parts.push(`${portfolioCount} portfolio pieces`);

    suggestions.push({
      category: spec,
      suggestedHourlyRate: clampedRate,
      marketRange: { low: market.low, high: market.high },
      confidence,
      reasoning: parts.length > 0
        ? `Based on ${parts.join(', ')}. Market range: R${market.low}–R${market.high}/hr.`
        : `Based on market average for ${spec}. Build your profile for more accurate suggestions.`,
    });
  }

  return suggestions;
}

// ─── Compare Market Rates ─────────────────��─────────────────────────────────

export async function compareMarketRates(creatorId: string): Promise<MarketComparison[]> {
  const supabase = createAdminClient();
  const marketRates = getMarketRates();

  const { data: profile } = await supabase
    .from('profiles')
    .select('specializations, hourly_rate')
    .eq('id', creatorId)
    .single();

  if (!profile) return [];

  const currentRate = (profile.hourly_rate ?? 0) as number;
  const specializations = (profile.specializations ?? []) as string[];

  return specializations.map((spec) => {
    const market = marketRates[spec] ?? marketRates.photography;
    const diff = currentRate > 0
      ? Math.round(((currentRate - market.mid) / market.mid) * 100)
      : 0;

    const position: 'below_market' | 'at_market' | 'above_market' =
      diff < -15 ? 'below_market' :
      diff > 15 ? 'above_market' : 'at_market';

    return {
      category: spec,
      currentRate,
      marketAverage: market.mid,
      position,
      percentDifference: diff,
    };
  });
}
