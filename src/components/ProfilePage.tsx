import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  User, 
  Trophy, 
  Coins, 
  TrendingUp, 
  Activity, 
  Gift, 
  ChevronRight,
  Shield,
  Star,
  Zap,
  Clock,
  Calendar,
  Medal
} from 'lucide-react';
import { getRank, getNextRank, getVIPBadge } from '../lib/ranks';
import { cn } from '../lib/utils';
import { Achievements } from './Achievements';
import { UserAchievement } from '../types';

interface ProfilePageProps {
  user: any;
  onGift: (username: string, amount: number) => Promise<void>;
  onClaimInterest: () => Promise<void>;
  onClaimDaily: () => Promise<void>;
  onClaimWeekly: () => Promise<void>;
  userAchievements: UserAchievement[];
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ 
  user, 
  onGift, 
  onClaimInterest, 
  onClaimDaily, 
  onClaimWeekly,
  userAchievements 
}) => {
  const [giftUsername, setGiftUsername] = useState('');
  const [giftAmount, setGiftAmount] = useState('');
  const [isGifting, setIsGifting] = useState(false);
  const [isClaimingInterest, setIsClaimingInterest] = useState(false);
  const [isClaimingDaily, setIsClaimingDaily] = useState(false);
  const [isClaimingWeekly, setIsClaimingWeekly] = useState(false);

  const rank = getRank(user.total_wagered || 0);
  const nextRank = getNextRank(user.total_wagered || 0);
  const vip = getVIPBadge(user.total_wagered || 0);

  const progress = nextRank 
    ? ((user.total_wagered - rank.wagered) / (nextRank.wagered - rank.wagered)) * 100
    : 100;

  const handleGift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!giftUsername || !giftAmount) return;
    setIsGifting(true);
    try {
      await onGift(giftUsername, parseFloat(giftAmount));
      setGiftUsername('');
      setGiftAmount('');
    } finally {
      setIsGifting(false);
    }
  };

  const handleClaimInterest = async () => {
    if (user.credits < 10000 || isClaimingInterest || hasClaimedToday) return;
    setIsClaimingInterest(true);
    try {
      await onClaimInterest();
    } finally {
      setIsClaimingInterest(false);
    }
  };

  const handleClaimDaily = async () => {
    if (isClaimingDaily || hasClaimedDaily) return;
    setIsClaimingDaily(true);
    try {
      await onClaimDaily();
    } finally {
      setIsClaimingDaily(false);
    }
  };

  const handleClaimWeekly = async () => {
    if (isClaimingWeekly || hasClaimedWeekly) return;
    setIsClaimingWeekly(true);
    try {
      await onClaimWeekly();
    } finally {
      setIsClaimingWeekly(false);
    }
  };

  const now = new Date();
  const todayStart = new Date(now).setUTCHours(0, 0, 0, 0);
  const lastClaimRaw = user.interest_date ? user.interest_date : "0";
  const lastClaim = isNaN(parseInt(lastClaimRaw)) ? new Date(lastClaimRaw).getTime() : parseInt(lastClaimRaw);
  const hasClaimedToday = lastClaim >= todayStart;

  const todayStr = now.toISOString().split('T')[0];
  const hasClaimedDaily = user.daily_reward_date === todayStr;
  
  const lastWeekly = user.weekly_reward_date ? new Date(user.weekly_reward_date) : null;
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const hasClaimedWeekly = lastWeekly && lastWeekly > oneWeekAgo;

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 bg-[#0a0a0a] custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header / Identity */}
        <div className="flex flex-col md:flex-row gap-8 items-start md:items-center bg-[#1a1c23] p-8 rounded-[2.5rem] border border-white/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 blur-[100px] -mr-32 -mt-32" />
          
          <div className="relative">
            <div className="w-32 h-32 bg-gradient-to-br from-amber-400 to-amber-600 rounded-3xl flex items-center justify-center shadow-2xl">
              <User className="w-16 h-16 text-black" />
            </div>
            <div className="absolute -bottom-2 -right-2 bg-black border-2 border-amber-500 px-3 py-1 rounded-full flex items-center gap-1 shadow-lg">
              <Shield className="w-3 h-3 text-amber-500" />
              <span className="text-[10px] font-black text-white uppercase tracking-widest">{vip.name}</span>
            </div>
          </div>

          <div className="flex-1 space-y-2">
            <h2 className="text-4xl font-display font-black text-white uppercase italic tracking-tight">
              {user.username}
            </h2>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2 text-white/40">
                <Clock className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-widest">Member since {new Date(user.id.length > 10 ? parseInt(user.id.substring(0, 8), 36) : Date.now()).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2 text-amber-500">
                <Star className="w-4 h-4 fill-current" />
                <span className="text-xs font-black uppercase tracking-widest">{rank.name}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">Current Balance</span>
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-6 py-3 rounded-2xl">
              <Coins className="w-5 h-5 text-amber-500" />
              <span className="text-2xl font-mono font-black text-amber-500">${user.credits.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Top Row: Rewards, Gift Credits, Daily Interest */}
          <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Rewards */}
            <div className="bg-[#1a1c23] p-6 rounded-[2.5rem] border border-white/5 space-y-6 flex flex-col justify-between">
              <div className="space-y-1">
                <h3 className="text-lg font-black text-white uppercase tracking-tight">Rewards</h3>
                <p className="text-xs text-white/40 font-bold uppercase tracking-widest">Claim your loyalty bonuses</p>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={handleClaimDaily}
                  disabled={isClaimingDaily || hasClaimedDaily}
                  className={cn(
                    "w-full p-4 rounded-2xl border flex items-center justify-between transition-all active:scale-95",
                    hasClaimedDaily 
                      ? "bg-white/5 border-white/10 opacity-50 cursor-not-allowed" 
                      : "bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Calendar className={cn("w-5 h-5", hasClaimedDaily ? "text-white/20" : "text-amber-500")} />
                    <div className="text-left">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">Daily Reward</span>
                      <span className="text-sm font-bold text-white">${rank.dailyReward.toLocaleString()}</span>
                    </div>
                  </div>
                  <span className={cn("text-[10px] font-black uppercase tracking-widest", hasClaimedDaily ? "text-white/20" : "text-amber-500")}>
                    {hasClaimedDaily ? 'CLAIMED' : 'CLAIM'}
                  </span>
                </button>

                <button 
                  onClick={handleClaimWeekly}
                  disabled={isClaimingWeekly || hasClaimedWeekly}
                  className={cn(
                    "w-full p-4 rounded-2xl border flex items-center justify-between transition-all active:scale-95",
                    hasClaimedWeekly 
                      ? "bg-white/5 border-white/10 opacity-50 cursor-not-allowed" 
                      : "bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Trophy className={cn("w-5 h-5", hasClaimedWeekly ? "text-white/20" : "text-purple-500")} />
                    <div className="text-left">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">Weekly Reward</span>
                      <span className="text-sm font-bold text-white">$10,000</span>
                    </div>
                  </div>
                  <span className={cn("text-[10px] font-black uppercase tracking-widest", hasClaimedWeekly ? "text-white/20" : "text-purple-500")}>
                    {hasClaimedWeekly ? 'CLAIMED' : 'CLAIM'}
                  </span>
                </button>
              </div>
            </div>

            {/* Gift Credits */}
            <div className="bg-[#1a1c23] p-6 rounded-[2.5rem] border border-white/5 space-y-4">
              <div className="space-y-1">
                <h3 className="text-lg font-black text-white uppercase tracking-tight">Gift Credits</h3>
                <p className="text-xs text-white/40 font-bold uppercase tracking-widest">Share with friends</p>
              </div>

              <form onSubmit={handleGift} className="space-y-3">
                <div className="space-y-1">
                  <input 
                    type="text"
                    value={giftUsername}
                    onChange={(e) => setGiftUsername(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                    placeholder="Recipient Username"
                  />
                </div>
                <div className="relative">
                  <Coins className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500" />
                  <input 
                    type="number"
                    value={giftAmount}
                    onChange={(e) => setGiftAmount(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors font-mono"
                    placeholder="Amount"
                  />
                </div>
                <button 
                  type="submit"
                  disabled={isGifting}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-xl transition-all shadow-lg active:scale-95 uppercase tracking-wider text-xs flex items-center justify-center gap-2"
                >
                  {isGifting ? 'Sending...' : (
                    <>
                      Send Gift
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Daily Interest */}
            <div className="bg-gradient-to-br from-amber-500/10 to-transparent p-6 rounded-[2.5rem] border border-amber-500/20 space-y-4 flex flex-col justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center shrink-0">
                  <TrendingUp className="w-6 h-6 text-black" />
                </div>
                <div className="space-y-0.5">
                  <h4 className="text-sm font-black text-white uppercase tracking-tight">Daily Interest</h4>
                  <p className="text-[10px] text-amber-500 font-bold uppercase tracking-widest">1% Daily Yield</p>
                </div>
              </div>
              <p className="text-[10px] text-white/40 leading-relaxed font-medium">
                Hold <span className="text-white font-bold">$10,000+</span> to earn <span className="text-white font-bold">1% interest</span> daily.
              </p>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                  <span className="text-white/20">Status</span>
                  <span className={cn(user.credits >= 10000 ? "text-green-500" : "text-red-500")}>
                    {user.credits >= 10000 ? "ACTIVE" : "INACTIVE"}
                  </span>
                </div>
                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className={cn("h-full transition-all", user.credits >= 10000 ? "bg-green-500" : "bg-red-500")}
                    style={{ width: `${Math.min((user.credits / 10000) * 100, 100)}%` }}
                  />
                </div>
                <button 
                  onClick={handleClaimInterest}
                  disabled={user.credits < 10000 || isClaimingInterest || hasClaimedToday}
                  className={cn(
                    "w-full py-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all shadow-lg active:scale-95",
                    user.credits >= 10000 && !hasClaimedToday
                      ? "bg-amber-500 hover:bg-amber-400 text-black shadow-amber-500/20" 
                      : "bg-white/5 text-white/20 cursor-not-allowed"
                  )}
                >
                  {isClaimingInterest ? 'Claiming...' : hasClaimedToday ? 'Claimed Today' : 'Claim Interest'}
                </button>
              </div>
            </div>
          </div>

          {/* Rank Progress */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-[#1a1c23] p-8 rounded-[2.5rem] border border-white/5 space-y-6 h-full flex flex-col justify-center">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">Rank Progression</h3>
                  <p className="text-xs text-white/40 font-bold uppercase tracking-widest">Wager more to unlock higher rewards</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">Total Wagered</span>
                  <span className="text-xl font-mono font-black text-white">${(user.total_wagered || 0).toLocaleString()}</span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                  <span className="text-amber-500">{rank.name}</span>
                  <span className="text-white/40">{nextRank ? nextRank.name : 'MAX RANK'}</span>
                </div>
                <div className="h-4 bg-white/5 rounded-full overflow-hidden border border-white/10 p-1">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full shadow-[0_0_10px_rgba(245,158,11,0.5)]"
                  />
                </div>
                {nextRank && (
                  <p className="text-center text-[10px] font-bold text-white/40 uppercase tracking-widest">
                    ${(nextRank.wagered - (user.total_wagered || 0)).toLocaleString()} more to reach {nextRank.name}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4">
                <div className="bg-white/5 p-4 rounded-2xl border border-white/5 space-y-1">
                  <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Daily Reward</span>
                  <div className="flex items-center gap-2 text-amber-500">
                    <Gift className="w-4 h-4" />
                    <span className="text-lg font-mono font-black">${rank.dailyReward.toLocaleString()}</span>
                  </div>
                </div>
                <div className="bg-white/5 p-4 rounded-2xl border border-white/5 space-y-1">
                  <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">VIP Status</span>
                  <div className="flex items-center gap-2 text-white">
                    <Shield className="w-4 h-4 text-amber-500" />
                    <span className="text-lg font-black uppercase tracking-tight">{vip.name}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="lg:col-span-1 grid grid-cols-2 gap-4">
            {[
              { label: 'Net Profit', value: `$${(user.net_profit || 0).toLocaleString()}`, icon: TrendingUp, color: (user.net_profit || 0) >= 0 ? 'text-green-500' : 'text-red-500' },
              { label: 'Total Bets', value: (user.total_bets || 0).toLocaleString(), icon: Activity, color: 'text-blue-500' },
              { label: 'Total Wins', value: (user.total_wins || 0).toLocaleString(), icon: Trophy, color: 'text-amber-500' },
              { label: 'Win Rate', value: user.total_bets > 0 ? `${((user.total_wins / user.total_bets) * 100).toFixed(1)}%` : '0%', icon: Zap, color: 'text-purple-500' },
            ].map((stat, i) => (
              <div key={i} className="bg-[#1a1c23] p-6 rounded-3xl border border-white/5 space-y-2 flex flex-col justify-center">
                <stat.icon className={cn("w-5 h-5", stat.color)} />
                <div className="space-y-0.5">
                  <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">{stat.label}</span>
                  <span className="text-lg font-mono font-black text-white">{stat.value}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Achievements Section */}
          <div className="lg:col-span-3 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center border border-amber-500/20">
                <Medal className="w-6 h-6 text-amber-500" />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-lg font-black text-white uppercase tracking-tight">Achievements</h3>
                <p className="text-xs text-white/40 font-bold uppercase tracking-widest">Complete challenges to earn trophies</p>
              </div>
            </div>
            <Achievements userAchievements={userAchievements} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
