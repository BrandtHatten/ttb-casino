import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { User, Trophy, TrendingUp, Activity, Star, Zap, ArrowLeft, Medal, Shield } from 'lucide-react';
import { getRank, getNextRank, getVIPBadge } from '../lib/ranks';
import { cn } from '../lib/utils';
import { Achievements } from './Achievements';

interface PublicProfilePageProps {
  username: string;
  onBack: () => void;
}

export const PublicProfilePage: React.FC<PublicProfilePageProps> = ({ username, onBack }) => {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/user/public/${encodeURIComponent(username)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setProfile(data); setLoading(false); })
      .catch(() => { setError('User not found.'); setLoading(false); });
  }, [username]);

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-[#0a0a0a] text-white/40 text-sm font-bold uppercase tracking-widest">
      Loading...
    </div>
  );

  if (error || !profile) return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] gap-4">
      <p className="text-white/40 text-sm font-bold uppercase tracking-widest">{error}</p>
      <button onClick={onBack} className="flex items-center gap-2 text-amber-500 hover:text-amber-400 text-sm font-bold uppercase tracking-widest transition-colors">
        <ArrowLeft className="w-4 h-4" /> Go Back
      </button>
    </div>
  );

  const rank = getRank(profile.total_wagered);
  const nextRank = getNextRank(profile.total_wagered);
  const vip = getVIPBadge(profile.total_wagered);
  const progress = nextRank
    ? ((profile.total_wagered - rank.wagered) / (nextRank.wagered - rank.wagered)) * 100
    : 100;

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 bg-[#0a0a0a] custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* Back button */}
        <button onClick={onBack} className="flex items-center gap-2 text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        {/* Header */}
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
              {profile.username}
            </h2>
            <div className="flex items-center gap-2 text-amber-500">
              <Star className="w-4 h-4 fill-current" />
              <span className="text-xs font-black uppercase tracking-widest">{rank.name}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Rank Progress */}
          <div className="lg:col-span-2">
            <div className="bg-[#1a1c23] p-8 rounded-[2.5rem] border border-white/5 space-y-6 h-full flex flex-col justify-center">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">Rank Progression</h3>
                  <p className="text-xs text-white/40 font-bold uppercase tracking-widest">Total wagered</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">Total Wagered</span>
                  <span className="text-xl font-mono font-black text-white">${profile.total_wagered.toLocaleString()}</span>
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
                    ${(nextRank.wagered - profile.total_wagered).toLocaleString()} more to reach {nextRank.name}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="lg:col-span-1 grid grid-cols-2 gap-4">
            {[
              { label: 'Net Profit', value: `$${profile.net_profit.toLocaleString()}`, icon: TrendingUp, color: profile.net_profit >= 0 ? 'text-green-500' : 'text-red-500' },
              { label: 'Total Bets', value: profile.total_bets.toLocaleString(), icon: Activity, color: 'text-blue-500' },
              { label: 'Total Wins', value: profile.total_wins.toLocaleString(), icon: Trophy, color: 'text-amber-500' },
              { label: 'Win Rate', value: profile.total_bets > 0 ? `${((profile.total_wins / profile.total_bets) * 100).toFixed(1)}%` : '0%', icon: Zap, color: 'text-purple-500' },
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

          {/* Achievements */}
          <div className="lg:col-span-3 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center border border-amber-500/20">
                <Medal className="w-6 h-6 text-amber-500" />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-lg font-black text-white uppercase tracking-tight">Achievements</h3>
                <p className="text-xs text-white/40 font-bold uppercase tracking-widest">
                  {profile.achievements.length} / {13} unlocked
                </p>
              </div>
            </div>
            <Achievements userAchievements={profile.achievements} />
          </div>
        </div>
      </div>
    </div>
  );
};
