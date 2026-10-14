/**
 * Where the person was when they took their ID-check photos, asked from the
 * browser (navigator.geolocation). Photo GPS depends on the phone and is often
 * stripped (iPhones, webcams); the browser asks the same way on every device.
 * Sharing is optional: a refusal is recorded and flagged, never blocked.
 */

export type DeviceLocationStatus = 'shared' | 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export interface DeviceLocation {
  status: DeviceLocationStatus;
  latitude: number | null;
  longitude: number | null;
  /** Radius in metres the browser is 95% sure of. */
  accuracy_m: number | null;
  /** When the browser fixed the position (ISO). */
  captured_at: string | null;
}

const STATUSES: readonly DeviceLocationStatus[] = ['shared', 'denied', 'unavailable', 'timeout', 'unsupported'];

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** What the browser sent, cleaned. Anything malformed becomes "unavailable". */
export function sanitizeDeviceLocation(raw: unknown, now: Date = new Date()): DeviceLocation {
  const none = (status: DeviceLocationStatus): DeviceLocation => ({
    status, latitude: null, longitude: null, accuracy_m: null, captured_at: null,
  });
  if (!raw || typeof raw !== 'object') return none('unavailable');
  const r = raw as Record<string, unknown>;
  const status = STATUSES.includes(r.status as DeviceLocationStatus) ? (r.status as DeviceLocationStatus) : 'unavailable';
  if (status !== 'shared') return none(status);

  const lat = num(r.latitude);
  const lon = num(r.longitude);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return none('unavailable');
  const accuracy = num(r.accuracy_m);
  const at = typeof r.captured_at === 'string' && !Number.isNaN(Date.parse(r.captured_at)) ? new Date(r.captured_at) : null;
  return {
    status: 'shared',
    latitude: lat,
    longitude: lon,
    accuracy_m: accuracy !== null && accuracy >= 0 ? Math.round(accuracy) : null,
    // A time in the future is the browser's clock, not a real fix time.
    captured_at: at && at.getTime() <= now.getTime() + 5 * 60_000 ? at.toISOString() : null,
  };
}

/** Rough mainland South Africa box (same as the photo GPS check). */
export function inSouthAfrica(lat: number, lon: number): boolean {
  return lat >= -35 && lat <= -22 && lon >= 16 && lon <= 33;
}

/** Great-circle distance in km. */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Ask the browser once (shows the "Allow location?" prompt). Never throws and
 * never waits more than `timeoutMs`.
 */
export function requestDeviceLocation(timeoutMs = 15_000): Promise<DeviceLocation> {
  const none = (status: DeviceLocationStatus): DeviceLocation => ({
    status, latitude: null, longitude: null, accuracy_m: null, captured_at: null,
  });
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(none('unsupported'));
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: DeviceLocation) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    // Some browsers never call back when the prompt is dismissed.
    const timer = setTimeout(() => finish(none('timeout')), timeoutMs + 1_000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        finish({
          status: 'shared',
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: Math.round(pos.coords.accuracy),
          captured_at: new Date(pos.timestamp || Date.now()).toISOString(),
        });
      },
      (err) => {
        clearTimeout(timer);
        finish(none(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable'));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 120_000 },
    );
  });
}
