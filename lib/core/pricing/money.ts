/**
 * Money in integer cents. Pure: no Supabase, Next.js or provider imports.
 *
 * Everything that adds, discounts or splits money works in whole cents so a
 * total always equals the sum of its parts. Rands only appear at the edges
 * (database columns, display), converted with toCents / fromCents.
 */

/** Rands (possibly with a float tail like 0.1 + 0.2) to whole cents. */
export function toCents(rands: number): number {
  if (!Number.isFinite(rands)) throw new RangeError(`toCents: not a finite amount (${rands})`);
  // toPrecision(15) drops binary float noise (1.005 * 100 = 100.49999999999999)
  // before rounding, so R1.005 becomes 101 cents, as a person would expect.
  return Math.round(Number((rands * 100).toPrecision(15)));
}

/** Whole cents to rands. */
export function fromCents(cents: number): number {
  assertCents(cents);
  return cents / 100;
}

/** Throws unless the value is a safe integer number of cents. */
export function assertCents(cents: number, label = 'amount'): void {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`${label} must be a whole number of cents (got ${cents})`);
  }
}

export function sumCents(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  return total;
}

/**
 * A share of an amount in basis points (10 000 bps = 100%), rounded half
 * away from zero to the nearest cent. Integer arithmetic only.
 */
export function bpsOf(cents: number, bps: number): number {
  assertCents(cents);
  assertCents(bps, 'bps');
  const product = BigInt(cents) * BigInt(bps);
  const negative = product < BigInt(0);
  const abs = negative ? -product : product;
  const q = abs / BigInt(10000);
  const r = abs % BigInt(10000);
  const rounded = r * BigInt(2) >= BigInt(10000) ? q + BigInt(1) : q;
  return Number(negative ? -rounded : rounded);
}

/** A whole-number percentage (e.g. 15) as basis points (1500). */
export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

/**
 * Split `total` cents in proportion to `weights` so the parts add up to
 * exactly `total`. Largest-remainder method: everyone gets the floor of their
 * exact share, then the leftover cents go one each to the largest remainders.
 * Ties go to the earlier index, so the result is deterministic.
 *
 * Weights must be non-negative integers (cents, basis points, or 1s for an
 * even split) with a positive sum. A negative total is split as its absolute
 * value and negated, so refunds split the same way charges do.
 */
export function allocateCents(total: number, weights: readonly number[]): number[] {
  assertCents(total, 'total');
  if (weights.length === 0) throw new RangeError('allocateCents: no weights');
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) {
      throw new RangeError(`allocateCents: weights must be non-negative integers (got ${w})`);
    }
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) throw new RangeError('allocateCents: weights sum to zero');

  const sign = total < 0 ? -1 : 1;
  const absTotal = BigInt(Math.abs(total));
  const big = BigInt(weightSum);

  const floors: bigint[] = [];
  const remainders: { index: number; rem: bigint }[] = [];
  let allocated = BigInt(0);
  weights.forEach((w, index) => {
    const exact = absTotal * BigInt(w);
    const floor = exact / big;
    floors.push(floor);
    remainders.push({ index, rem: exact % big });
    allocated += floor;
  });

  let leftover = Number(absTotal - allocated);
  remainders.sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (let i = 0; leftover > 0; i++, leftover--) {
    floors[remainders[i % remainders.length].index] += BigInt(1);
  }

  // `0 * -1` is -0; keep zero shares a plain 0.
  return floors.map((f) => (f === BigInt(0) ? 0 : sign * Number(f)));
}
