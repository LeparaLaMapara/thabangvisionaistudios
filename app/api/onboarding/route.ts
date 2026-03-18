import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// ─── Name validation ────────────────────────────────────────────────────────

function validateName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { valid: false, error: 'Name must be at least 2 characters.' };
  }
  // Allow letters, spaces, hyphens, apostrophes (SA names like O'Brien, Nkosi-Dlamini)
  if (!/^[a-zA-ZÀ-ÿ\s'-]+$/.test(trimmed)) {
    return { valid: false, error: 'Name contains invalid characters.' };
  }
  return { valid: true };
}

// ─── POST /api/onboarding ───────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const body = await req.json();
    const {
      firstName,
      lastName,
      streetAddress,
      city,
      province,
      postalCode,
      country,
      addressLat,
      addressLng,
      addressPlaceId,
      avatarUrl,
      avatarPublicId,
    } = body;

    // ── Validate required fields ──────────────────────────────────────────

    const firstNameResult = validateName(firstName || '');
    if (!firstNameResult.valid) {
      return NextResponse.json({ error: `First name: ${firstNameResult.error}` }, { status: 400 });
    }

    const lastNameResult = validateName(lastName || '');
    if (!lastNameResult.valid) {
      return NextResponse.json({ error: `Last name: ${lastNameResult.error}` }, { status: 400 });
    }

    if (!streetAddress?.trim()) {
      return NextResponse.json({ error: 'Street address is required.' }, { status: 400 });
    }

    if (!city?.trim()) {
      return NextResponse.json({ error: 'City is required.' }, { status: 400 });
    }

    if (!province?.trim()) {
      return NextResponse.json({ error: 'Province is required.' }, { status: 400 });
    }

    if (!avatarUrl?.trim()) {
      return NextResponse.json({ error: 'Profile photo is required.' }, { status: 400 });
    }

    // ── Generate display_name ─────────────────────────────────────────────

    const displayName = `${firstName.trim()} ${lastName.trim()}`;
    const locationLegacy = `${city.trim()}, ${province.trim()}`;

    // ── Update profile ────────────────────────────────────────────────────

    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        display_name: displayName,
        street_address: streetAddress.trim(),
        city: city.trim(),
        province: province.trim(),
        postal_code: postalCode?.trim() || null,
        country: country?.trim() || 'South Africa',
        address_lat: addressLat ?? null,
        address_lng: addressLng ?? null,
        address_place_id: addressPlaceId ?? null,
        avatar_url: avatarUrl.trim(),
        avatar_public_id: avatarPublicId || null,
        location: locationLegacy,
        onboarding_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (error) {
      console.error('[POST /api/onboarding]', error.message);
      return NextResponse.json({ error: 'Failed to save profile.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/onboarding]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
