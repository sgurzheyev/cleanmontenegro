/**
 * Integer EGP only: no commas/decimals in the controlled input value.
 * Use with step="1", pattern="\\d*", inputMode="numeric".
 */

/** Keep only digits (strips commas, dots, spaces, minus, etc.). */
export function sanitizeIntegerEgpDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Parse a digit-only field to a non-negative integer EGP amount. */
export function parseIntegerEgpFromInput(value: string): number {
  const d = sanitizeIntegerEgpDigits(value);
  if (d === '') return 0;
  const n = Math.floor(Number(d));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Floor any numeric amount before Supabase RPC / Paymob payloads (integer EGP). */
export function floorEgp(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.floor(x));
}
