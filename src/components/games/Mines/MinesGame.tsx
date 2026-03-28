import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Bomb, 
  Diamond, 
  TrendingUp, 
  History as HistoryIcon, 
  Settings, 
  Info, 
  Play, 
  RotateCcw, 
  Coins,
  ChevronRight,
  Zap,
  Activity,
  User,
  Clock,
  TrendingDown,
  Crown,
  Medal,
  ChevronDown,
  LogOut,
  Shield,
  Megaphone,
  X
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useMines, GameStatus } from './useMines';
import { MinesGrid } from './MinesGrid';

interface MinesGameProps {
  balance: number;
  setBalance: (val: number) => void;
  socket: any;
  user?: any;
}

export const MinesGame: React.FC<MinesGameProps> = ({ balance, setBalance, socket, user }) => {
  const {
    tiles,
    status,
    multiplier,
    nextMultiplier,
    revealedCount,
    mineCount,
    setMineCount,
    betAmount,
    setBetAmount,
    startGame,
    revealTile,
    cashout,
    isCashingOut,
    gameResult
  } = useMines(balance, setBalance, socket);

  const [history, setHistory] = useState<any[]>([]);
  const [sessionNet, setSessionNet] = useState(0);

  // Update history and session net when game ends
  useEffect(() => {
    if (status === 'ended' && gameResult) {
      const winAmount = gameResult === 'win' ? betAmount * multiplier : 0;
      const net = winAmount - betAmount;
      setSessionNet(prev => prev + net);
      const newEntry = {
        id: Date.now(),
        multiplier: multiplier.toFixed(2),
        winAmount: winAmount.toFixed(2),
        timestamp: new Date().toLocaleTimeString(),
        isWin: gameResult === 'win'
      };
      setHistory(prev => [newEntry, ...prev].slice(0, 10));
    }
  }, [status, gameResult, multiplier, betAmount]);

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-6 p-4 md:p-8 max-w-7xl mx-auto w-full overflow-y-auto custom-scrollbar">
      {/* Sidebar Controls */}
      <div className="w-full lg:w-80 flex flex-col gap-4">
        <div className="bg-[#1a1c23] border border-white/5 rounded-[2rem] p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Settings className="w-4 h-4 text-amber-500" />
              </div>
              <span className="text-xs font-black text-white/40 uppercase tracking-widest">Game Controls</span>
            </div>
          </div>

          {/* Bet Amount */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-2">
              <label className="text-[10px] font-black text-white/20 uppercase tracking-widest">Bet Amount</label>
              <span className="text-[10px] font-black text-amber-500/50 uppercase tracking-widest">Credits</span>
            </div>
            <div className="relative group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 p-1.5 bg-white/5 rounded-lg group-focus-within:bg-amber-500/10 transition-colors">
                <Coins className="w-4 h-4 text-white/40 group-focus-within:text-amber-500 transition-colors" />
              </div>
              <input 
                type="number"
                value={betAmount}
                onChange={(e) => setBetAmount(Math.max(1, Number(e.target.value)))}
                disabled={status === 'playing'}
                className="w-full bg-white/5 border border-white/10 rounded-2xl pl-14 pr-6 py-4 text-white font-bold focus:outline-none focus:border-amber-500/50 transition-all disabled:opacity-50 appearance-none"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                <button 
                  onClick={() => setBetAmount(Math.max(1, Math.floor(betAmount / 2)))}
                  disabled={status === 'playing'}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-black text-white/40 uppercase transition-colors disabled:opacity-50"
                >
                  1/2
                </button>
                <button 
                  onClick={() => setBetAmount(betAmount * 2)}
                  disabled={status === 'playing'}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-black text-white/40 uppercase transition-colors disabled:opacity-50"
                >
                  2x
                </button>
              </div>
            </div>
          </div>

          {/* Mine Count */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-2">
              <label className="text-[10px] font-black text-white/20 uppercase tracking-widest">Mines</label>
              <span className="text-[10px] font-black text-red-500/50 uppercase tracking-widest">{mineCount} Bombs</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[1, 3, 5, 10, 15, 20, 24].map((count) => (
                <button
                  key={count}
                  onClick={() => setMineCount(count)}
                  disabled={status === 'playing'}
                  className={cn(
                    "py-2 rounded-xl text-xs font-black transition-all disabled:opacity-50",
                    mineCount === count 
                      ? "bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.3)]" 
                      : "bg-white/5 text-white/40 hover:bg-white/10"
                  )}
                >
                  {count}
                </button>
              ))}
              <div className="relative">
                <input 
                  type="number"
                  min="1"
                  max="24"
                  value={mineCount}
                  onChange={(e) => setMineCount(Math.min(24, Math.max(1, Number(e.target.value))))}
                  disabled={status === 'playing'}
                  className="w-full h-full bg-white/5 border border-white/10 rounded-xl text-center text-xs font-black text-white focus:outline-none focus:border-red-500/50 transition-all disabled:opacity-50"
                />
              </div>
            </div>
          </div>

          {/* Session Net */}
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Session</span>
            <span className={cn(
              "px-3 py-1 rounded-full text-xs font-black border",
              sessionNet >= 0
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-red-500/10 text-red-400 border-red-500/20"
            )}>
              {sessionNet >= 0 ? '+' : ''}{sessionNet.toFixed(2)}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 space-y-3">
            {status === 'playing' ? (
              <button 
                onClick={() => cashout()}
                disabled={revealedCount === 0 || isCashingOut}
                className="w-full py-5 bg-emerald-500 hover:bg-emerald-400 text-black font-black rounded-2xl transition-all shadow-lg active:scale-95 text-lg uppercase tracking-wider flex items-center justify-center gap-3 disabled:opacity-50 disabled:grayscale"
              >
                <TrendingUp className="w-6 h-6" />
                Cashout ({(betAmount * multiplier).toFixed(2)})
              </button>
            ) : (
              <button 
                onClick={startGame}
                disabled={balance < betAmount}
                className="w-full py-5 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-2xl transition-all shadow-lg active:scale-95 text-lg uppercase tracking-wider flex items-center justify-center gap-3 disabled:opacity-50 disabled:grayscale"
              >
                <Play className="w-6 h-6 fill-current" />
                Start Game
              </button>
            )}
          </div>
        </div>

        {/* Game Stats */}
        <div className="bg-[#1a1c23] border border-white/5 rounded-[2rem] p-6 shadow-2xl space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <Activity className="w-4 h-4 text-emerald-500" />
            </div>
            <span className="text-xs font-black text-white/40 uppercase tracking-widest">Live Stats</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
              <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">Multiplier</p>
              <p className="text-xl font-black text-white">x{multiplier.toFixed(2)}</p>
            </div>
            <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
              <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">Next Tile</p>
              <p className="text-xl font-black text-amber-500">
                {nextMultiplier > 0 ? `x${nextMultiplier.toFixed(2)}` : 'MAX'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="flex-1 flex flex-col gap-6">
        <div className="flex-1 bg-[#1a1c23] border border-white/5 rounded-[2.5rem] p-8 md:p-12 shadow-2xl flex flex-col items-center justify-center relative overflow-hidden">
          {/* Background Elements */}
          <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-[120px]" />
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,transparent_0%,#1a1c23_70%)]" />
          </div>

          <MinesGrid 
            tiles={tiles}
            status={status}
            onReveal={revealTile}
          />

          {/* Game Status Overlay */}
          <AnimatePresence>
            {status === 'ended' && gameResult === 'win' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="absolute top-12 left-1/2 -translate-x-1/2 bg-emerald-500 text-black px-8 py-3 rounded-full font-black text-xl shadow-[0_0_30px_rgba(16,185,129,0.5)] z-10"
              >
                WIN x{multiplier.toFixed(2)}
              </motion.div>
            )}
            {status === 'ended' && gameResult === 'loss' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="absolute top-12 left-1/2 -translate-x-1/2 bg-red-500 text-white px-8 py-3 rounded-full font-black text-xl shadow-[0_0_30px_rgba(239,68,68,0.5)] z-10"
              >
                BOOM!
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* History Section */}
        <div className="bg-[#1a1c23] border border-white/5 rounded-[2rem] p-6 shadow-2xl">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <HistoryIcon className="w-4 h-4 text-amber-500" />
              </div>
              <span className="text-xs font-black text-white/40 uppercase tracking-widest">Recent Games</span>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
            {history.length === 0 ? (
              <div className="w-full py-8 flex flex-col items-center justify-center text-white/10 gap-2">
                <HistoryIcon className="w-8 h-8" />
                <p className="text-[10px] font-black uppercase tracking-widest">No history yet</p>
              </div>
            ) : (
              history.map((game) => (
                <div 
                  key={game.id}
                  className={cn(
                    "flex-shrink-0 px-4 py-3 rounded-2xl border flex flex-col items-center gap-1",
                    game.isWin 
                      ? "bg-emerald-500/5 border-emerald-500/20" 
                      : "bg-red-500/5 border-red-500/20"
                  )}
                >
                  <span className={cn(
                    "text-xs font-black",
                    game.isWin ? "text-emerald-400" : "text-red-400"
                  )}>
                    x{game.multiplier}
                  </span>
                  <span className="text-[8px] font-black text-white/20 uppercase tracking-tighter">
                    {game.timestamp}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
