'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, BarChart3, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';

// ─── Types ──────────────────────────────────────────────────────────────────

interface RateSuggestion {
  category: string;
  suggestedHourlyRate: number;
  marketRange: { low: number; high: number };
  confidence: 'low' | 'medium' | 'high';
  reasoning: string;
}

interface MarketComparison {
  category: string;
  currentRate: number;
  marketAverage: number;
  position: 'below_market' | 'at_market' | 'above_market';
  percentDifference: number;
}

const CONFIDENCE_VARIANT: Record<string, 'default' | 'warning' | 'success'> = {
  low: 'warning',
  medium: 'default',
  high: 'success',
};

const POSITION_LABEL: Record<string, string> = {
  below_market: 'Below Market',
  at_market: 'At Market',
  above_market: 'Above Market',
};

const POSITION_VARIANT: Record<string, 'warning' | 'success' | 'info'> = {
  below_market: 'warning',
  at_market: 'success',
  above_market: 'info',
};

function formatCategory(cat: string): string {
  return cat
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [suggestions, setSuggestions] = useState<RateSuggestion[]>([]);
  const [comparison, setComparison] = useState<MarketComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [suggestRes, compareRes] = await Promise.all([
        fetch('/api/agents/rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'suggest-rates' }),
        }),
        fetch('/api/agents/rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'compare-market' }),
        }),
      ]);

      if (!suggestRes.ok || !compareRes.ok) {
        const errData = await (suggestRes.ok ? compareRes : suggestRes).json().catch(() => null);
        setError(errData?.error ?? 'Failed to load pricing data.');
        return;
      }

      const suggestData = await suggestRes.json();
      const compareData = await compareRes.json();

      setSuggestions(suggestData.suggestions ?? []);
      setComparison(compareData.comparison ?? []);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return <LoadingSpinner label="Analyzing your rates..." className="py-20" />;
  }

  if (error) {
    return (
      <div className="py-12">
        <EmptyState
          title="Could not load pricing"
          description={error}
          action={{ label: 'Try Again', href: '/dashboard/pricing' }}
        />
      </div>
    );
  }

  const hasSuggestions = suggestions.length > 0;
  const hasComparison = comparison.length > 0;

  if (!hasSuggestions && !hasComparison) {
    return (
      <div className="py-12">
        <EmptyState
          title="No Pricing Data"
          description="Add specializations to your profile to get rate suggestions and market comparisons."
          action={{ label: 'Edit Profile', href: '/dashboard/profile' }}
        />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-lg font-display font-medium uppercase text-white">
            Pricing Guide
          </h2>
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mt-1">
            Rate suggestions &middot; Market comparison
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          loading={refreshing}
          onClick={() => fetchData(true)}
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </Button>
      </div>

      {/* Rate Suggestions */}
      {hasSuggestions && (
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-[#D4A843]" />
            <h3 className="text-sm font-bold uppercase tracking-tight border-l-2 border-[#D4A843] pl-3">
              Suggested Rates
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {suggestions.map((s) => (
              <Card key={s.category} className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-mono font-bold text-white">
                    {formatCategory(s.category)}
                  </h4>
                  <Badge variant={CONFIDENCE_VARIANT[s.confidence]}>
                    {s.confidence} confidence
                  </Badge>
                </div>

                <div className="text-2xl font-mono font-bold text-[#D4A843] mb-2">
                  R{s.suggestedHourlyRate.toLocaleString()}
                  <span className="text-xs text-neutral-400 font-normal">/hr</span>
                </div>

                {/* Market range bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs font-mono text-neutral-400 mb-1">
                    <span>R{s.marketRange.low.toLocaleString()}</span>
                    <span>R{s.marketRange.high.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 bg-neutral-800 relative">
                    <div
                      className="h-full bg-[#D4A843]/40 absolute"
                      style={{
                        left: '0%',
                        width: '100%',
                      }}
                    />
                    <div
                      className="w-2 h-2 bg-[#D4A843] absolute top-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        left: `${Math.min(100, Math.max(0, ((s.suggestedHourlyRate - s.marketRange.low) / (s.marketRange.high - s.marketRange.low)) * 100))}%`,
                      }}
                    />
                  </div>
                </div>

                <p className="text-xs font-mono text-neutral-400 leading-relaxed">
                  {s.reasoning}
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Market Comparison */}
      {hasComparison && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-[#D4A843]" />
            <h3 className="text-sm font-bold uppercase tracking-tight border-l-2 border-[#D4A843] pl-3">
              Market Comparison
            </h3>
          </div>

          <div className="space-y-3">
            {comparison.map((c) => (
              <Card key={c.category} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-mono font-bold text-white">
                      {formatCategory(c.category)}
                    </h4>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs font-mono text-neutral-400">
                        Your rate: <span className="text-white">R{c.currentRate.toLocaleString()}/hr</span>
                      </span>
                      <span className="text-xs font-mono text-neutral-400">|</span>
                      <span className="text-xs font-mono text-neutral-400">
                        Market avg: <span className="text-neutral-300">R{c.marketAverage.toLocaleString()}/hr</span>
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant={POSITION_VARIANT[c.position]}>
                      {POSITION_LABEL[c.position]}
                    </Badge>
                    {c.percentDifference !== 0 && (
                      <p className={`text-xs font-mono mt-1 ${
                        c.percentDifference > 0 ? 'text-emerald-400' : 'text-amber-400'
                      }`}>
                        {c.percentDifference > 0 ? '+' : ''}{c.percentDifference}%
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
