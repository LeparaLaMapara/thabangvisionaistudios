'use client';

import { useState, useCallback, useRef, useEffect, useId } from 'react';

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

/** Where the address lookup stands, for the status line under the field. */
type LookupStatus = 'idle' | 'loading' | 'results' | 'empty' | 'unavailable';

// ─── Nominatim (OpenStreetMap) Autocomplete ─────────────────────────────────
// Free, no API key. Rate limit: 1 req/sec (we debounce at 600ms).

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const MIN_QUERY_LENGTH = 3;

const INPUT_CLASS =
  'w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-base md:text-sm font-mono placeholder:text-neutral-400 focus:outline-none focus:border-white transition-colors';
const LABEL_CLASS = 'block text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2';

/**
 * Street-address field with suggestions from OpenStreetMap.
 *
 * Follows the WAI-ARIA combobox pattern: the input owns a listbox of
 * suggestions, Up/Down move through them, Enter picks one, Escape closes the
 * list. When the lookup service fails, it says so (instead of failing
 * silently and leaving delivery unable to become ready) and offers a retry.
 */
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState<LookupStatus>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const baseId = useId();
  const ids = {
    street: `${baseId}-street`,
    listbox: `${baseId}-listbox`,
    status: `${baseId}-status`,
    city: `${baseId}-city`,
    province: `${baseId}-province`,
    postal: `${baseId}-postal`,
    option: (i: number) => `${baseId}-option-${i}`,
  };

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

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
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
    if (input.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setShowSuggestions(false);
      setActiveIndex(-1);
      setStatus('idle');
      return;
    }

    setStatus('loading');
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

      if (!res.ok) {
        // Rate limited or down: say so, rather than looking like "no match".
        setSuggestions([]);
        setShowSuggestions(false);
        setStatus('unavailable');
        return;
      }

      const data: NominatimResult[] = await res.json();
      setSuggestions(data);
      setShowSuggestions(data.length > 0);
      setActiveIndex(-1);
      setStatus(data.length > 0 ? 'results' : 'empty');
    } catch {
      // Offline, blocked by an extension, or the service is down.
      setSuggestions([]);
      setShowSuggestions(false);
      setStatus('unavailable');
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    // Typed text is the address until a suggestion is picked; tell the parent
    // so a hand-typed address still reaches it (it used to only on city edits).
    emitChange({ streetAddress: value });

    // Debounce at 600ms to respect Nominatim's 1 req/sec rate limit
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchSuggestions(value);
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
    setActiveIndex(-1);
    setStatus('idle');

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

  // ─── Keyboard: WAI-ARIA combobox ─────────────────────────────────────────

  const listOpen = showSuggestions && suggestions.length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setShowSuggestions(true);
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setShowSuggestions(true);
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (listOpen && activeIndex >= 0) {
        // Pick the highlighted suggestion instead of submitting the form.
        e.preventDefault();
        handleSelect(suggestions[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      if (listOpen) {
        e.preventDefault();
        setShowSuggestions(false);
        setActiveIndex(-1);
      }
    }
  };

  const statusText: Record<LookupStatus, string> = {
    idle: '',
    loading: 'Looking up addresses…',
    results: `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}. Use the up and down arrows to choose.`,
    empty: 'No matching addresses. Check the spelling, or type the full address and fill in the city and province below.',
    unavailable: '',
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4" ref={wrapperRef}>
      <div className="relative">
        <label htmlFor={ids.street} className={LABEL_CLASS}>
          Street Address *
        </label>
        <input
          id={ids.street}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={ids.listbox}
          aria-activedescendant={listOpen && activeIndex >= 0 ? ids.option(activeIndex) : undefined}
          aria-describedby={ids.status}
          autoComplete="street-address"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
          placeholder="Start typing your address..."
          className={`${INPUT_CLASS} pr-10`}
        />

        {/* Loading indicator */}
        {status === 'loading' && (
          <div className="absolute right-3 top-[38px]" aria-hidden="true">
            <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Suggestions dropdown */}
        <ul
          id={ids.listbox}
          role="listbox"
          aria-label="Address suggestions"
          hidden={!listOpen}
          className="absolute z-50 w-full mt-1 bg-[#0A0A0B] border border-white/10 max-h-60 overflow-y-auto"
        >
          {listOpen && suggestions.map((result, i) => (
            <li
              key={result.place_id}
              id={ids.option(i)}
              role="option"
              aria-selected={i === activeIndex}
              // mousedown, not click: picking must win over the input's blur.
              onMouseDown={(e) => { e.preventDefault(); handleSelect(result); }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`cursor-pointer min-h-[44px] px-4 py-3 text-xs font-mono transition-colors border-b border-white/5 last:border-b-0 ${
                i === activeIndex ? 'bg-white/10 text-white' : 'text-neutral-300'
              }`}
            >
              {result.display_name}
            </li>
          ))}
        </ul>

        {/* Status line: read out politely to screen readers */}
        <p id={ids.status} aria-live="polite" className="mt-2 text-xs font-mono text-neutral-400 empty:hidden">
          {statusText[status]}
        </p>

        {status === 'unavailable' && (
          <div role="alert" className="mt-2 border border-[#D4A843]/30 bg-[#D4A843]/5 px-3 py-2 flex flex-wrap items-center gap-2">
            <p className="text-xs text-neutral-300 flex-1 min-w-[12rem]">
              Address search is unavailable right now. Choose Collect, or try again.
            </p>
            <button
              type="button"
              onClick={() => void fetchSuggestions(query)}
              className="min-h-[44px] px-3 text-xs font-mono font-bold uppercase tracking-widest text-[#D4A843] border border-[#D4A843]/40 hover:bg-[#D4A843]/10 transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor={ids.city} className={LABEL_CLASS}>
            City *
          </label>
          <input
            id={ids.city}
            type="text"
            autoComplete="address-level2"
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              emitChange({ city: e.target.value });
            }}
            placeholder="Johannesburg"
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor={ids.province} className={LABEL_CLASS}>
            Province *
          </label>
          <input
            id={ids.province}
            type="text"
            autoComplete="address-level1"
            value={province}
            onChange={(e) => {
              setProvince(e.target.value);
              emitChange({ province: e.target.value });
            }}
            placeholder="Gauteng"
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor={ids.postal} className={LABEL_CLASS}>
            Postal Code
          </label>
          <input
            id={ids.postal}
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            value={postalCode}
            onChange={(e) => {
              setPostalCode(e.target.value);
              emitChange({ postalCode: e.target.value });
            }}
            placeholder="2000"
            className={INPUT_CLASS}
          />
        </div>
      </div>
    </div>
  );
}
