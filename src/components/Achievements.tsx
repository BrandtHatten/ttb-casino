import React from 'react';
import { motion } from 'framer-motion';
import { ACHIEVEMENTS } from '../lib/achievements';
import { UserAchievement } from '../types';
import { cn } from '../lib/utils';
import { CheckCircle2, Lock } from 'lucide-react';

interface AchievementsProps {
  userAchievements: UserAchievement[];
}

export const Achievements: React.FC<AchievementsProps> = ({ userAchievements }) => {
  const unlockedIds = new Set(userAchievements.map(a => a.achievement_id));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {ACHIEVEMENTS.map((achievement) => {
        const isUnlocked = unlockedIds.has(achievement.id);
        const Icon = achievement.icon;
        const unlockData = userAchievements.find(a => a.achievement_id === achievement.id);

        return (
          <motion.div
            key={achievement.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "relative p-4 rounded-2xl border transition-all duration-300",
              isUnlocked 
                ? "bg-white/10 border-white/20 shadow-lg shadow-black/20" 
                : "bg-black/20 border-white/5 opacity-60 grayscale"
            )}
          >
            <div className="flex items-start gap-4">
              <div className={cn(
                "p-3 rounded-xl bg-black/40 border border-white/10",
                isUnlocked ? achievement.color : "text-white/20"
              )}>
                <Icon className="w-6 h-6" />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-display font-bold text-white truncate">
                    {achievement.title}
                  </h4>
                  {isUnlocked ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <Lock className="w-4 h-4 text-white/20 shrink-0" />
                  )}
                </div>
                <p className="text-xs text-white/40 leading-relaxed">
                  {achievement.description}
                </p>
                {isUnlocked && unlockData && (
                  <p className="text-[10px] text-white/20 mt-2 uppercase tracking-widest font-bold">
                    Unlocked {new Date(unlockData.timestamp).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>

            {isUnlocked && (
              <div className="absolute top-2 right-2">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full animate-pulse",
                  achievement.color.replace('text-', 'bg-')
                )} />
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
};
