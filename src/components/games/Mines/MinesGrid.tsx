import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bomb, Diamond } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Tile, GameStatus } from './useMines';

interface MinesGridProps {
  tiles: Tile[];
  status: GameStatus;
  onReveal: (id: number) => void;
}

export const MinesGrid: React.FC<MinesGridProps> = ({ tiles, status, onReveal }) => {
  return (
    <div className="grid grid-cols-5 gap-2 md:gap-3 w-full max-w-[500px] aspect-square mx-auto p-4 bg-white/5 rounded-3xl border border-white/10 shadow-2xl">
      {tiles.map((tile) => (
        <motion.button
          key={tile.id}
          whileHover={status === 'playing' && !tile.isRevealed ? { scale: 1.05 } : {}}
          whileTap={status === 'playing' && !tile.isRevealed ? { scale: 0.95 } : {}}
          onClick={() => onReveal(tile.id)}
          disabled={status !== 'playing' || tile.isRevealed}
          className={cn(
            "relative w-full h-full rounded-xl md:rounded-2xl transition-all duration-300 flex items-center justify-center overflow-hidden",
            !tile.isRevealed && "bg-white/10 hover:bg-white/20 border border-white/5",
            tile.isRevealed && tile.isMine && "bg-red-500/20 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.3)]",
            tile.isRevealed && !tile.isMine && "bg-emerald-500/20 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.3)]",
            status === 'ended' && !tile.isRevealed && "opacity-50 grayscale"
          )}
        >
          <AnimatePresence mode="wait">
            {tile.isRevealed ? (
              <motion.div
                key={tile.isMine ? 'mine' : 'diamond'}
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                className="flex items-center justify-center"
              >
                {tile.isMine ? (
                  <Bomb className="w-6 h-6 md:w-8 md:h-8 text-red-500" />
                ) : (
                  <Diamond className="w-6 h-6 md:w-8 md:h-8 text-emerald-400 fill-emerald-400/20" />
                )}
              </motion.div>
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-white/5 to-transparent" />
            )}
          </AnimatePresence>
          
          {/* Subtle glow effect for unrevealed tiles */}
          {!tile.isRevealed && status === 'playing' && (
            <div className="absolute inset-0 bg-gradient-to-tr from-amber-500/0 via-amber-500/5 to-amber-500/0 opacity-0 hover:opacity-100 transition-opacity" />
          )}
        </motion.button>
      ))}
    </div>
  );
};
