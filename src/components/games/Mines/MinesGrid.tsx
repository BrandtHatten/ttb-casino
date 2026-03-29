import React from 'react';
import { motion } from 'framer-motion';
import { Bomb, Diamond } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Tile, GameStatus } from './useMines';

interface MinesGridProps {
  tiles: Tile[];
  status: GameStatus;
  onReveal: (id: number) => void;
  isProcessing?: boolean;
}

export const MinesGrid: React.FC<MinesGridProps> = ({ tiles, status, onReveal, isProcessing = false }) => {
  return (
    <div className="grid grid-cols-5 gap-1.5 md:gap-3 w-full max-w-[300px] sm:max-w-[380px] md:max-w-[450px] lg:max-w-[500px] aspect-square mx-auto p-2 md:p-4 bg-white/5 rounded-3xl border border-white/10 shadow-2xl">
      {tiles.map((tile) => (
        <button
          key={tile.id}
          onClick={() => onReveal(tile.id)}
          disabled={status !== 'playing' || tile.isRevealed || isProcessing}
          className={cn(
            "relative w-full h-full rounded-xl md:rounded-2xl transition-transform duration-150 active:scale-95 flex items-center justify-center overflow-hidden",
            status === 'playing' && !tile.isRevealed && "hover:scale-105",
            !tile.isRevealed && "bg-white/10 border border-white/5",
            tile.isRevealed && tile.isMine && "bg-red-500/20 border border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.3)]",
            tile.isRevealed && !tile.isMine && "bg-emerald-500/20 border border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.3)]",
            status === 'ended' && !tile.isRevealed && "opacity-50 grayscale"
          )}
        >
          {tile.isRevealed ? (
            <motion.div
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
        </button>
      ))}
    </div>
  );
};
