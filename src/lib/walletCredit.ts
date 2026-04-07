/**
 * CleanMontenegro: internal economy is EUR, charged and credited 1:1 via Stripe.
 * Keep the wallet integer-safe by rounding/flooring at UI boundaries.
 */

/** User enters EUR in the deposit form; Stripe charges EUR; wallet credits EUR 1:1. */
export function stripeEurInputToWalletEur(inputEur: number): number {
  if (!Number.isFinite(inputEur) || inputEur <= 0) return 0;
  return Math.max(0, Math.floor(inputEur));
}

/** Profile `wallet_balance` / `frozen_balance` are stored in EUR (internal economy). */
export function profileWalletBalanceEur(raw: number | null | undefined): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * Back-compat exports (old EGP naming) so existing call-sites keep working while refactor is ongoing.
 */
export function stripeEgpInputToWalletEgp(input: number): number {
  return stripeEurInputToWalletEur(input);
}

export function profileWalletBalanceEgp(raw: number | null | undefined): number {
  return profileWalletBalanceEur(raw);
}
