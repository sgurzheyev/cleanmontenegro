/** Whole EUR amounts only — no fractional cents in UI. */
function roundWhole(amount: number): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function formatNumberEu(amount: number): string {
  const n = roundWhole(amount);
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/** Numeric part only (no “EUR”) — use in i18n strings that add the currency once. */
export function formatEurDigits(amount: number): string {
  return formatNumberEu(amount);
}

/**
 * Internal wallet / missions use EUR. Always whole numbers (absolute rounding).
 */
export function formatEur(amount: number): string {
  return `${formatNumberEu(amount)} EUR`;
}

/**
 * Back-compat exports (EGP naming) while refactor is in progress.
 * These now format EUR to avoid stale "EGP" UI output.
 */
export function formatEgpDigits(amount: number): string {
  return formatEurDigits(amount);
}

export function formatEgp(amount: number): string {
  return formatEur(amount);
}
