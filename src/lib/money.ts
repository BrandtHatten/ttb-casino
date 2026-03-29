// All monetary values are stored and transmitted as integer cents.
// This module is the single source of truth for display formatting.

export const centsToDollars = (cents: number): number => cents / 100;
export const dollarsToCents = (dollars: number): number => Math.round(dollars * 100);

export const formatMoney = (cents: number): string => {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatMoneyShort = (cents: number): string => {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`;
  return `$${dollars.toFixed(2)}`;
};

export const formatMoneyRaw = (cents: number): string => {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
