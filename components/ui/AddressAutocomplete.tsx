'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AddressResult {
  streetAddress: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
}

interface AddressAutocompleteProps {
  onSelect: (address: AddressResult) => void;
  defaultValue?: string;
  defaultAddress?: Partial<AddressResult>;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address: {
    house_number?: string;
    road?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
}

// ─── Nominatim (OpenStreetMap) Autocomplete ─────────────────────────────────
// Free, no API key. Rate limit: 1 req/sec (we debounce at 600ms).

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export default function AddressAutocomplete({
  onSelect,
  defaultValue = '',
  defaultAddress,
}: AddressAutocompleteProps) {
  const [query, setQuery] = useState(defaultValue);
  const [city, setCity] = useState(defaultAddress?.city || '');
  const [province, setProvince] = useState(defaultAddress?.province || '');
  const [postalCode, setPostalCode] = useState(defaultAddress?.postalCode || '');
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const emitChange = useCallback(
    (addr: Partial<AddressResult>) => {
      onSelect({
        streetAddress: addr.streetAddress ?? query,
        city: addr.city ?? city,
        province: addr.province ?? province,
        postalCode: addr.postalCode ?? postalCode,
        country: addr.country ?? 'South Africa',
        lat: addr.lat ?? null,
        lng: addr.lng ?? null,
        placeId: addr.placeId ?? null,
      });
    },
    [onSelect, query, city, province, postalCode],
  );

  // ─── Fetch suggestions from Nominatim ───────────────────────────────────

  const fetchSuggestions = useCallback(async (input: string) => {
    if (input.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: input,
        format: 'json',
        addressdetails: '1',
        limit: '5',
        countrycodes: 'za',
      });

      const res = await fetch(`${NOMINATIM_URL}?${params}`, {
        headers: { 'Accept-Language': 'en' },
      });

      if (res.ok) {
        const data: NominatimResult[] = await res.json();
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
      }
    } catch {
      // Silently fail — user can still type manually
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);

    // Debounce at 600ms to respect Nominatim's 1 req/sec rate limit
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 600);
  };

  // ─── Select a suggestion ────────────────────────────────────────────────

  const handleSelect = (result: NominatimResult) => {
    const addr = result.address;
    const street = addr.house_number
      ? `${addr.house_number} ${addr.road || ''}`
      : addr.road || '';
    const cityName = addr.city || addr.town || addr.village || '';
    const provinceName = addr.state || '';
    const postal = addr.postcode || '';

    setQuery(street || result.display_name.split(',')[0]);
    setCity(cityName);
    setProvince(provinceName);
    setPostalCode(postal);
    setSuggestions([]);
    setShowSuggestions(false);

    onSelect({
      streetAddress: street || result.display_name.split(',')[0],
      city: cityName,
      province: provinceName,
      postalCode: postal,
      country: addr.country || 'South Africa',
      lat: parseFloat(result.lat) || null,
      lng: parseFloat(result.lon) || null,
      placeId: String(result.place_id),
    });
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4" ref={wrapperRef}>
      <div className="relative">
        <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
          Street Address *
        </label>
        <input
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
          placeholder="Start typing your address..."
          className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-700 focus:outline-none focus:border-white transition-colors"
        />

        {/* Loading indicator */}
        {loading && (
          <div className="absolute right-3 top-[34px]">
            <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Suggestions dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-[#0A0A0B] border border-white/10 max-h-48 overflow-y-auto">
            {suggestions.map((result) => (
              <button
                key={result.place_id}
                type="button"
                onClick={() => handleSelect(result)}
                className="w-full text-left px-4 py-3 text-xs font-mono text-neutral-300 hover:bg-white/5 hover:text-white transition-colors border-b border-white/5 last:border-b-0"
              >
                {result.display_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
            City *
          </label>
          <input
            type="text"
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              emitChange({ city: e.target.value });
            }}
            placeholder="Johannesburg"
            className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-700 focus:outline-none focus:border-white transition-colors"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
            Province *
          </label>
          <input
            type="text"
            value={province}
            onChange={(e) => {
              setProvince(e.target.value);
              emitChange({ province: e.target.value });
            }}
            placeholder="Gauteng"
            className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-700 focus:outline-none focus:border-white transition-colors"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
            Postal Code
          </label>
          <input
            type="text"
            value={postalCode}
            onChange={(e) => {
              setPostalCode(e.target.value);
              emitChange({ postalCode: e.target.value });
            }}
            placeholder="2000"
            className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-700 focus:outline-none focus:border-white transition-colors"
          />
        </div>
      </div>
    </div>
  );
}
