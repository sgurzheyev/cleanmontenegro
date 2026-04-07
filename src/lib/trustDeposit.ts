/** Minimum frozen security (EGP) for street / public / city missions. */
export const MIN_TRUST_DEPOSIT_EGP_STREET = 100;

/** Home/office missions at or below this price (EGP) use the street minimum unless higher rule applies. */
export const HOME_MISSION_DEPOSIT_THRESHOLD_EGP = 200;

function isStreetMissionCategory(category: string | null | undefined): boolean {
  const c = String(category || '').toLowerCase();
  return c === 'public' || c === 'street' || c === 'city';
}

export function isHomeMissionCategory(category: string | null | undefined): boolean {
  const c = String(category || '').toLowerCase();
  return c === 'home' || c === 'office';
}

/**
 * Required worker frozen balance (EGP) for the mission category and price (EGP).
 * - Street/public/city: 100 EGP
 * - Home/office: 100 EGP if price ≤ 200; if price > 200 then max(100, 50% of mission price)
 */
export function requiredTrustDepositEgp(category: string | null | undefined, amountTargetEgp: number): number {
  const target = Number(amountTargetEgp);
  if (!Number.isFinite(target) || target <= 0) return MIN_TRUST_DEPOSIT_EGP_STREET;

  if (isStreetMissionCategory(category)) {
    return MIN_TRUST_DEPOSIT_EGP_STREET;
  }

  if (isHomeMissionCategory(category)) {
    if (target > HOME_MISSION_DEPOSIT_THRESHOLD_EGP) {
      const half = Math.round(target * 0.5 * 100) / 100;
      return Math.max(MIN_TRUST_DEPOSIT_EGP_STREET, half);
    }
    return MIN_TRUST_DEPOSIT_EGP_STREET;
  }

  return MIN_TRUST_DEPOSIT_EGP_STREET;
}

export type SecurityDepositCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'frozen_exceeds_wallet' | 'insufficient_funds';
      /** EGP still needed (liquid) to lock required trust */
      shortfallEgp?: number;
    };

export function isSecurityDepositFailure(
  c: SecurityDepositCheck
): c is Extract<SecurityDepositCheck, { ok: false }> {
  return c.ok === false;
}

export type HomeMissionAccessCheck = { ok: true } | { ok: false; reason: 'not_id_verified' };

/** Home/office missions require ID-verified workers. */
export function checkHomeMissionWorkerVerification(
  category: string | null | undefined,
  isIdVerified: boolean | null | undefined
): HomeMissionAccessCheck {
  if (!isHomeMissionCategory(category)) return { ok: true };
  if (isIdVerified) return { ok: true };
  return { ok: false, reason: 'not_id_verified' };
}

/**
 * Worker must have enough total wallet to cover trust (frozen + liquid). Amounts are EGP.
 */
export function workerCanSecureMissionDeposit(
  walletBalanceEgp: number,
  frozenBalanceEgp: number,
  category: string | null | undefined,
  amountTargetEgp: number
): SecurityDepositCheck {
  const wb = Math.max(0, Number(walletBalanceEgp || 0));
  const fr = Math.max(0, Number(frozenBalanceEgp || 0));
  if (fr > wb + 0.01) {
    return { ok: false, reason: 'frozen_exceeds_wallet' };
  }
  const requiredEgp = requiredTrustDepositEgp(category, amountTargetEgp);
  if (fr >= requiredEgp - 0.01) {
    return { ok: true };
  }
  const shortfallEgp = requiredEgp - fr;
  const available = wb - fr;
  if (available >= shortfallEgp - 0.01) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: 'insufficient_funds',
    shortfallEgp: Math.max(0, Math.round((shortfallEgp - available) * 100) / 100),
  };
}
