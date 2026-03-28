export type SymbolType = 'HEART' | 'SQUARE' | 'PENTAGON' | 'RECTANGLE' | 'APPLE' | 'PLUM' | 'WATERMELON' | 'GRAPE' | 'BANANA' | 'SCATTER' | 'MULTIPLIER';

export interface GameSymbol {
  id: string;
  type: SymbolType;
  value: number;
  color: string;
  icon: string;
  multiplier?: number;
  isNew?: boolean;
}

export interface GridPosition {
  row: number;
  col: number;
}

export interface WinResult {
  symbolType: SymbolType;
  count: number;
  payout: number;
  positions: GridPosition[];
}

export const SYMBOLS: Record<SymbolType, Omit<GameSymbol, 'id'>> = {
  HEART: { type: 'HEART', value: 10, color: 'bg-red-500', icon: 'Heart' },
  SQUARE: { type: 'SQUARE', value: 5, color: 'bg-purple-500', icon: 'Square' },
  PENTAGON: { type: 'PENTAGON', value: 3, color: 'bg-green-500', icon: 'Pentagon' },
  RECTANGLE: { type: 'RECTANGLE', value: 2, color: 'bg-blue-500', icon: 'RectangleHorizontal' },
  APPLE: { type: 'APPLE', value: 1, color: 'bg-red-600', icon: 'Apple' },
  PLUM: { type: 'PLUM', value: 0.8, color: 'bg-purple-700', icon: 'Circle' },
  WATERMELON: { type: 'WATERMELON', value: 0.5, color: 'bg-green-600', icon: 'Citrus' },
  GRAPE: { type: 'GRAPE', value: 0.4, color: 'bg-indigo-500', icon: 'Grape' },
  BANANA: { type: 'BANANA', value: 0.25, color: 'bg-yellow-400', icon: 'Banana' },
  SCATTER: { type: 'SCATTER', value: 0, color: 'bg-pink-400', icon: 'Candy' },
  MULTIPLIER: { type: 'MULTIPLIER', value: 0, color: 'bg-rainbow', icon: 'Bomb' },
};

export const GRID_ROWS = 5;
export const GRID_COLS = 6;

export interface User {
  id: string;
  username: string;
  credits: number;
  total_wagered: number;
  is_admin: boolean;
  is_banned: boolean;
  total_bets: number;
  total_wins: number;
  net_profit: number;
  biggest_win: number;
  blackjack_wins: number;
  max_crash_multiplier: number;
  max_plinko_multiplier: number;
  interest_claims: number;
  roulette_wins: number;
  roulette_straight_wins: number;
  max_roulette_win: number;
  daily_reward_date?: string;
  weekly_reward_date?: string;
  interest_date?: string;
}

export interface UserAchievement {
  achievement_id: string;
  timestamp: string;
}
