import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { GameSymbol, GRID_ROWS, GRID_COLS, GridPosition } from '../types';

interface SymbolProps {
  symbol: GameSymbol;
  rIdx: number;
  cIdx: number;
  winningPositions: GridPosition[];
  totalScattersOnGrid: number;
  isSpinning: boolean;
  Icon: any;
}

const SymbolComponent: React.FC<SymbolProps> = ({
  symbol,
  rIdx,
  cIdx,
  winningPositions,
  totalScattersOnGrid,
  isSpinning,
  Icon
}) => {
  const isWinning = winningPositions.some(p => p.row === rIdx && p.col === cIdx);
  
  const isScatter = symbol.type === 'SCATTER';
  const isMultiplier = symbol.type === 'MULTIPLIER';
  
  return (
    <motion.div
      key={symbol.id}
      layout
      initial={symbol.isNew ? { y: -500, opacity: 0 } : false}
      animate={{ y: 0, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ 
        layout: { type: "spring", stiffness: 300, damping: 35 },
        y: { 
          type: "spring", 
          stiffness: 300, 
          damping: 30,
          delay: (isSpinning && symbol.isNew) ? (cIdx * 0.05) + ((GRID_ROWS - 1 - rIdx) * 0.01) : 0 
        },
        opacity: { duration: 0.2 }
      }}
      className="w-full h-full flex items-center justify-center relative"
      style={{ 
        zIndex: isWinning ? 20 : (isScatter || isMultiplier ? 10 : 1),
        gridRow: rIdx + 1,
        gridColumn: cIdx + 1
      }}
    >
      <motion.div
        animate={{ 
          scale: isWinning ? [1, 1.08, 1] : (isScatter ? [1, 1.05, 1] : (isMultiplier ? [1, 1.08, 1] : 1)),
          filter: isWinning 
            ? 'brightness(1.5) drop-shadow(0 0 8px rgba(255,255,255,0.8))' 
            : (isScatter ? 'drop-shadow(0 0 6px rgba(255, 105, 180, 0.6))' : (isMultiplier ? 'drop-shadow(0 0 10px rgba(255, 255, 0, 0.8))' : 'none'))
        }}
        transition={{
          scale: isWinning 
            ? { type: "keyframes", duration: 0.3 } 
            : (isScatter || isMultiplier ? { repeat: Infinity, duration: 2, ease: "easeInOut" } : { type: "spring", stiffness: 300, damping: 20 })
        }}
        className={cn(
          isScatter ? "w-8 h-8 md:w-16 md:h-16" : (isMultiplier ? "w-9 h-9 md:w-18 md:h-18" : "w-9 h-9 md:w-18 md:h-18"),
          "flex flex-col items-center justify-center relative overflow-hidden shadow-lg",
          isScatter 
            ? cn(
                "rounded-full bg-gradient-to-tr from-pink-600 via-pink-400 to-white border-2 md:border-4 border-white/50 z-10",
                isWinning && "animate-scatter-win",
                !isWinning && totalScattersOnGrid >= 3 && "animate-scatter-tension"
              )
            : (isMultiplier 
                ? "rounded-full bg-gradient-to-tr from-yellow-600 via-yellow-400 to-white border-2 md:border-4 border-yellow-200 z-10 shadow-[0_0_15px_rgba(255,255,0,0.5)]"
                : cn("rounded-xl md:rounded-2xl", symbol.color)),
          isWinning && "ring-4 ring-white ring-opacity-50"
        )}
      >
        <Icon className={cn(
          isScatter ? "w-6 h-6 md:w-12 md:h-12" : (isMultiplier ? "w-7 h-7 md:w-14 md:h-14" : "w-6 h-6 md:w-10 md:h-10"),
          "text-white/90 drop-shadow-md",
          (isScatter || isMultiplier) && "animate-spin-slow"
        )} />
        {isMultiplier && (
          <span className="absolute bottom-1 text-[10px] md:text-sm font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] bg-black/40 px-2 rounded-full">
            x{symbol.multiplier}
          </span>
        )}
        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
      </motion.div>
    </motion.div>
  );
};

export const Symbol = React.memo(SymbolComponent);
