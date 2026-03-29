import React, { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { Target, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface ChallengesPanelProps {
  socket: Socket | null;
}

export const ChallengesPanel: React.FC<ChallengesPanelProps> = ({ socket }) => {
  const [challenges, setChallenges] = useState<any[]>([]);

  useEffect(() => {
    if (!socket) return;
    socket.on('challenges:data', (data: any[]) => setChallenges(data));
    socket.on('challenge:progress', ({ challengeId, progress }: any) => {
      setChallenges(prev => prev.map(c => c.id === challengeId ? { ...c, user_progress: progress } : c));
    });
    socket.on('challenge:completed', ({ challengeId }: any) => {
      setChallenges(prev => prev.map(c => c.id === challengeId ? { ...c, completed: 1 } : c));
    });
    socket.on('challenges:reset', () => socket.emit('challenges:get'));
    return () => {
      socket.off('challenges:data');
      socket.off('challenge:progress');
      socket.off('challenge:completed');
      socket.off('challenges:reset');
    };
  }, [socket]);

  if (challenges.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Target className="w-3.5 h-3.5 text-amber-500" />
        <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Daily Challenges</span>
      </div>
      {challenges.map(c => {
        const done = c.completed === 1;
        const progress = done ? c.target_value : Math.min(c.user_progress || 0, c.target_value);
        const pct = done ? 100 : Math.min(100, (progress / c.target_value) * 100);
        return (
          <div key={c.id} className={cn("bg-[#1a1c23] border rounded-2xl p-4 transition-all", done ? "border-amber-500/30" : "border-white/5")}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-white/80 leading-tight">{c.description}</p>
                <p className="text-[9px] text-amber-500 font-black uppercase tracking-widest mt-1">+${c.reward.toLocaleString()} reward</p>
              </div>
              {done ? <CheckCircle2 className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" /> : (
                <span className="text-[9px] font-black text-white/30 shrink-0">{progress}/{c.target_value}</span>
              )}
            </div>
            <div className="mt-3 h-1 bg-white/5 rounded-full overflow-hidden">
              <div className={cn("h-full rounded-full transition-all duration-500", done ? "bg-amber-500" : "bg-amber-500/60")} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
