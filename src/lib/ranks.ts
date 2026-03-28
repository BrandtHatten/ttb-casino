export interface Rank {
  name: string;
  wagered: number;
  dailyReward: number;
  color: string;
}

export const RANKS: Rank[] = [
  { name: 'Bronze I', wagered: 0, dailyReward: 100, color: '#CD7F32' },
  { name: 'Bronze II', wagered: 10000, dailyReward: 150, color: '#CD7F32' },
  { name: 'Bronze III', wagered: 25000, dailyReward: 200, color: '#CD7F32' },
  { name: 'Bronze IV', wagered: 40000, dailyReward: 275, color: '#CD7F32' },
  { name: 'Bronze V', wagered: 60000, dailyReward: 350, color: '#CD7F32' },
  { name: 'Silver I', wagered: 90000, dailyReward: 450, color: '#C0C0C0' },
  { name: 'Silver II', wagered: 140000, dailyReward: 575, color: '#C0C0C0' },
  { name: 'Silver III', wagered: 200000, dailyReward: 725, color: '#C0C0C0' },
  { name: 'Silver IV', wagered: 280000, dailyReward: 900, color: '#C0C0C0' },
  { name: 'Silver V', wagered: 400000, dailyReward: 1100, color: '#C0C0C0' },
  { name: 'Gold I', wagered: 550000, dailyReward: 1400, color: '#FFD700' },
  { name: 'Gold II', wagered: 800000, dailyReward: 1750, color: '#FFD700' },
  { name: 'Gold III', wagered: 1200000, dailyReward: 2200, color: '#FFD700' },
  { name: 'Gold IV', wagered: 1750000, dailyReward: 2750, color: '#FFD700' },
  { name: 'Gold V', wagered: 2500000, dailyReward: 3500, color: '#FFD700' },
  { name: 'Platinum I', wagered: 3750000, dailyReward: 4500, color: '#E5E4E2' },
  { name: 'Platinum II', wagered: 6000000, dailyReward: 6000, color: '#E5E4E2' },
  { name: 'Platinum III', wagered: 9500000, dailyReward: 8000, color: '#E5E4E2' },
  { name: 'Platinum IV', wagered: 15000000, dailyReward: 10000, color: '#E5E4E2' },
  { name: 'Platinum V', wagered: 25000000, dailyReward: 15000, color: '#E5E4E2' },
];

export const getRank = (wagered: number): Rank => {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (wagered >= RANKS[i].wagered) {
      return RANKS[i];
    }
  }
  return RANKS[0];
};

export const getNextRank = (wagered: number): Rank | null => {
  for (let i = 0; i < RANKS.length; i++) {
    if (wagered < RANKS[i].wagered) {
      return RANKS[i];
    }
  }
  return null;
};

export const getVIPBadge = (wagered: number) => {
  if (wagered >= 3750000) return { name: 'Platinum', color: '#E5E4E2' };
  if (wagered >= 550000) return { name: 'Gold', color: '#FFD700' };
  if (wagered >= 90000) return { name: 'Silver', color: '#C0C0C0' };
  return { name: 'Bronze', color: '#CD7F32' };
};
