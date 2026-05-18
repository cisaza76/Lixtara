export const LIXTARA_BUYER_FEE_PCT = 0.5;
export const REBATE_CAP = 50_000;
export const TYPICAL_BUYER_AGENT_PCT = 2.5;

export function calculateRebate(
  purchasePrice: number,
  offeredCommissionPct: number = TYPICAL_BUYER_AGENT_PCT,
): {
  commissionEarned: number;
  lixtaraFee: number;
  rebate: number;
  cappedAtMax: boolean;
} {
  const commissionEarned = purchasePrice * (offeredCommissionPct / 100);
  const lixtaraFee = purchasePrice * (LIXTARA_BUYER_FEE_PCT / 100);
  const uncapped = Math.max(0, commissionEarned - lixtaraFee);
  const cappedAtMax = uncapped > REBATE_CAP;
  const rebate = Math.min(uncapped, REBATE_CAP);
  return { commissionEarned, lixtaraFee, rebate, cappedAtMax };
}
