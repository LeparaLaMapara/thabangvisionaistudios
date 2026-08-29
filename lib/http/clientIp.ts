/**
 * The caller's IP, for rate-limit and abuse keys.
 *
 * The AI guest limiter keyed on the raw `x-forwarded-for` header, whole and
 * unsplit, so a caller sending a different value each time got a fresh bucket
 * each time — the 10/min guest cap was one header away from unlimited, and with
 * the AI spend ceiling unenforced that meant uncapped cost.
 *
 * On Vercel the platform sets `x-forwarded-for` with the real client IP as the
 * FIRST entry; any further entries are appended by upstream proxies the client
 * may control. Taking the first hop, trimmed, is the value to trust. `x-real-ip`
 * is the fallback, and a fixed string is the last resort so a missing header
 * collapses everyone into one shared bucket rather than exempting them.
 *
 * This is not spoof-proof — nothing header-based is — but it removes the
 * trivial per-request rotation, and the enforced budget ceiling is the backstop
 * behind it.
 */

type HeaderSource = Headers | { get(name: string): string | null };

export function clientIp(headers: HeaderSource): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;

  return 'unknown';
}
