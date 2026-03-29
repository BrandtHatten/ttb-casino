import { LucideIcon, Trophy, Star, Zap, Target, Crown, Gem, Coins, TrendingUp, Skull, Heart, Bomb, Sword, CircleDot } from 'lucide-react';

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  color: string;
  requirement: (stats: any) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_win',
    title: 'First Win',
    description: 'Win your first game',
    icon: Trophy,
    color: 'text-yellow-400',
    requirement: (stats) => stats.total_wins >= 1
  },
  {
    id: 'high_roller',
    title: 'High Roller',
    description: 'Wager a total of $100,000',
    icon: Gem,
    color: 'text-purple-400',
    requirement: (stats) => stats.total_wagered >= 100000
  },
  {
    id: 'blackjack_master',
    title: 'Blackjack Master',
    description: 'Win 50 hands of Blackjack',
    icon: Target,
    color: 'text-blue-400',
    requirement: (stats) => stats.blackjack_wins >= 50
  },
  {
    id: 'crash_king',
    title: 'Crash King',
    description: 'Reach a 10x multiplier in Crash',
    icon: Zap,
    color: 'text-orange-400',
    requirement: (stats) => stats.max_crash_multiplier >= 10
  },
  {
    id: 'plinko_pro',
    title: 'Plinko Pro',
    description: 'Hit a 100x multiplier in Plinko',
    icon: Star,
    color: 'text-pink-400',
    requirement: (stats) => stats.max_plinko_multiplier >= 100
  },
  {
    id: 'millionaire',
    title: 'Millionaire',
    description: 'Reach a balance of $1,000,000',
    icon: Crown,
    color: 'text-yellow-500',
    requirement: (stats) => stats.credits >= 1000000
  },
  {
    id: 'broke',
    title: 'Broke',
    description: 'Reach a balance of $0',
    icon: Skull,
    color: 'text-red-400',
    requirement: (stats) => stats.credits <= 0.01 && stats.total_bets > 0
  },
  {
    id: 'interest_collector',
    title: 'Interest Collector',
    description: 'Claim daily interest 10 times',
    icon: TrendingUp,
    color: 'text-green-400',
    requirement: (stats) => stats.interest_claims >= 10
  },
  {
    id: 'loyal_player',
    title: 'Loyal Player',
    description: 'Place 1,000 total bets',
    icon: Heart,
    color: 'text-red-500',
    requirement: (stats) => stats.total_bets >= 1000
  },
  {
    id: 'big_winner',
    title: 'Big Winner',
    description: 'Win over $50,000 in a single bet',
    icon: Coins,
    color: 'text-emerald-400',
    requirement: (stats) => stats.biggest_win >= 50000
  },
  {
    id: 'roulette_rookie',
    title: 'Roulette Rookie',
    description: 'Win 25 rounds of Roulette',
    icon: Target,
    color: 'text-red-400',
    requirement: (stats) => stats.roulette_wins >= 25
  },
  {
    id: 'lucky_number',
    title: 'Lucky Number',
    description: 'Win a straight-up bet on a single number',
    icon: Star,
    color: 'text-yellow-400',
    requirement: (stats) => stats.roulette_straight_wins >= 1
  },
  {
    id: 'roulette_master',
    title: 'Roulette Master',
    description: 'Win $100,000 in a single Roulette spin',
    icon: Crown,
    color: 'text-purple-500',
    requirement: (stats) => stats.max_roulette_win >= 100000
  },
  {
    id: 'minefield_navigator',
    title: 'Minefield Navigator',
    description: 'Successfully cash out 10 times in Mines',
    icon: Bomb,
    color: 'text-emerald-400',
    requirement: (stats) => stats.mines_wins >= 10
  },
  {
    id: 'war_hero',
    title: 'War Hero',
    description: 'Win 25 rounds of Casino War',
    icon: Sword,
    color: 'text-red-400',
    requirement: (stats) => stats.war_wins >= 25
  },
  {
    id: 'wheel_winner',
    title: 'Wheel Winner',
    description: 'Land on a 10x or higher segment in Wheel',
    icon: CircleDot,
    color: 'text-purple-400',
    requirement: (stats) => stats.max_wheel_multiplier >= 10
  }
];
