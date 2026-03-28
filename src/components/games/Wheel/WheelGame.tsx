import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Settings, 
  Play, 
  Coins,
  TrendingUp,
  History as HistoryIcon,
  Activity,
  Zap,
  RotateCcw,
  Target,
  Trophy,
  ChevronDown
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useWheel, RiskLevel } from './useWheel';
import confetti from 'canvas-confetti';

interface WheelGameProps {
  balance: number;
  setBalance: (val: number) => void;
  socket: any;
  user?: any;
}

export const WheelGame: React.FC<WheelGameProps> = ({ balance, setBalance, socket, user }) => {
  const {
    betAmount,
    setBetAmount,
    risk,
    setRisk,
    isSpinning,
    spin,
    rotation,
    lastResult,
    segments
  } = useWheel(balance, setBalance);

  const [history, setHistory] = useState<any[]>([]);
  const [sessionNet, setSessionNet] = useState(0);

  // Update history, session net, and emit socket events when spin completes
  useEffect(() => {
    if (lastResult !== null) {
      const winAmount = betAmount * lastResult;
      const net = winAmount - betAmount;
      setSessionNet(prev => prev + net);

      if (socket) {
        socket.emit('wheel:result', { betAmount, multiplier: lastResult, winAmount, won: lastResult > 0 });
      }

      if (lastResult >= 5) {
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
      }

      const newEntry = {
        id: Date.now(),
        multiplier: lastResult.toFixed(2),
        winAmount: winAmount.toFixed(2),
        timestamp: new Date().toLocaleTimeString(),
        isWin: lastResult > 1
      };
      setHistory(prev => [newEntry, ...prev].slice(0, 10));
    }
  }, [lastResult]);

  // Emit wheel:spin when a spin starts (isSpinning transitions to true)
  const prevSpinning = React.useRef(false);
  useEffect(() => {
    if (isSpinning && !prevSpinning.current && socket) {
      socket.emit('wheel:spin', { betAmount });
    }
    prevSpinning.current = isSpinning;
  }, [isSpinning]);

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
                disabled={isSpinning}
                className="w-full bg-white/5 border border-white/10 rounded-2xl pl-14 pr-6 py-4 text-white font-bold focus:outline-none focus:border-amber-500/50 transition-all disabled:opacity-50 appearance-none"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                <button 
                  onClick={() => setBetAmount(Math.max(1, Math.floor(betAmount / 2)))}
                  disabled={isSpinning}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-black text-white/40 uppercase transition-colors disabled:opacity-50"
                >
                  1/2
                </button>
                <button 
                  onClick={() => setBetAmount(betAmount * 2)}
                  disabled={isSpinning}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-black text-white/40 uppercase transition-colors disabled:opacity-50"
                >
                  2x
                </button>
              </div>
            </div>
          </div>

          {/* Risk Level */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-2">
              <label className="text-[10px] font-black text-white/20 uppercase tracking-widest">Risk Level</label>
              <span className="text-[10px] font-black text-amber-500/50 uppercase tracking-widest">{risk}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['low', 'medium', 'high'] as RiskLevel[]).map((level) => (
                <button
                  key={level}
                  onClick={() => setRisk(level)}
                  disabled={isSpinning}
                  className={cn(
                    "py-2 rounded-xl text-xs font-black transition-all disabled:opacity-50 uppercase tracking-tighter",
                    risk === level 
                      ? "bg-amber-500 text-black shadow-[0_0_15px_rgba(245,158,11,0.3)]" 
                      : "bg-white/5 text-white/40 hover:bg-white/10"
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4">
            <button 
              onClick={spin}
              disabled={isSpinning || balance < betAmount}
              className="w-full py-5 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-2xl transition-all shadow-lg active:scale-95 text-lg uppercase tracking-wider flex items-center justify-center gap-3 disabled:opacity-50 disabled:grayscale"
            >
              {isSpinning ? (
                <>
                  <RotateCcw className="w-6 h-6 animate-spin" />
                  Spinning...
                </>
              ) : (
                <>
                  <Play className="w-6 h-6 fill-current" />
                  Spin Wheel
                </>
              )}
            </button>
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
              <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">Last Win</p>
              <p className="text-xl font-black text-white">
                {lastResult !== null && lastResult > 0 ? `x${lastResult.toFixed(2)}` : '-'}
              </p>
            </div>
            <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
              <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">Max Multiplier</p>
              <p className="text-xl font-black text-amber-500">x{Math.max(...segments.map(s => s.multiplier)).toFixed(2)}</p>
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

          {/* The Wheel */}
          <div className="relative w-full max-w-[450px] aspect-square flex items-center justify-center">
            {/* Pointer */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-6 z-30">
              <div className="w-10 h-14 bg-amber-500 rounded-b-2xl shadow-[0_0_30px_rgba(245,158,11,0.6)] flex items-center justify-center border-x-4 border-b-4 border-black/20 relative">
                <ChevronDown className="w-8 h-8 text-black" />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-white/40 rounded-full mt-1" />
              </div>
            </div>

            {/* Outer Rim Decoration */}
            <div className="absolute inset-0 rounded-full border-[16px] border-[#1a1c23] shadow-[0_0_60px_rgba(0,0,0,0.8),inset_0_0_30px_rgba(0,0,0,0.5)] z-0" />

            {/* Wheel Container */}
            <div className="w-full h-full rounded-full relative p-4 z-10">
              <motion.div 
                className="w-full h-full"
                animate={{ rotate: rotation }}
                transition={{ duration: 4, ease: [0.32, 0.01, 0.1, 1] }}
              >
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90 overflow-visible">
                  {segments.map((segment, index) => {
                    const angle = 360 / segments.length;
                    const startAngle = index * angle;
                    const endAngle = (index + 1) * angle;
                    
                    // Path coordinates
                    const x1 = 50 + 50 * Math.cos((Math.PI * startAngle) / 180);
                    const y1 = 50 + 50 * Math.sin((Math.PI * startAngle) / 180);
                    const x2 = 50 + 50 * Math.cos((Math.PI * endAngle) / 180);
                    const y2 = 50 + 50 * Math.sin((Math.PI * endAngle) / 180);
                    
                    const largeArcFlag = angle > 180 ? 1 : 0;
                    const d = `M 50 50 L ${x1} ${y1} A 50 50 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;
                    
                    // Label coordinates
                    const labelAngle = startAngle + angle / 2;
                    const labelRadius = 38;
                    const labelX = 50 + labelRadius * Math.cos((Math.PI * labelAngle) / 180);
                    const labelY = 50 + labelRadius * Math.sin((Math.PI * labelAngle) / 180);
                    
                    // Peg coordinates
                    const pegRadius = 48;
                    const pegX = 50 + pegRadius * Math.cos((Math.PI * startAngle) / 180);
                    const pegY = 50 + pegRadius * Math.sin((Math.PI * startAngle) / 180);
                    
                    return (
                      <g key={index}>
                        <path 
                          d={d} 
                          fill={segment.color} 
                          stroke="#1a1c23" 
                          strokeWidth="0.8"
                          style={{ opacity: 0.85 }}
                        />
                        {/* Peg */}
                        <circle 
                          cx={pegX} 
                          cy={pegY} 
                          r="1.2" 
                          fill="#444" 
                          stroke="#000" 
                          strokeWidth="0.2" 
                        />
                        {/* Multiplier Text */}
                        <g transform={`rotate(${labelAngle + 90}, ${labelX}, ${labelY})`}>
                          <text
                            x={labelX}
                            y={labelY}
                            fill="white"
                            fontSize="4.5"
                            fontWeight="900"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            style={{ 
                              textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                              fontFamily: 'Inter, sans-serif'
                            }}
                          >
                            {segment.multiplier}x
                          </text>
                        </g>
                      </g>
                    );
                  })}
                </svg>
              </motion.div>
              
              {/* Inner Circle Decoration */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-[#1a1c23] rounded-full border-[10px] border-white/5 flex items-center justify-center z-20 shadow-[0_0_40px_rgba(0,0,0,0.6)]">
                <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center border border-amber-500/20 relative group">
                  <div className="absolute inset-0 bg-amber-500/20 rounded-full blur-xl animate-pulse" />
                  <Zap className="w-8 h-8 text-amber-500 drop-shadow-[0_0_15px_rgba(245,158,11,0.6)] relative z-10" />
                </div>
              </div>
            </div>
          </div>

          {/* Result Overlay */}
          <AnimatePresence>
            {lastResult !== null && !isSpinning && (
              <motion.div
                initial={{ opacity: 0, scale: 0.5, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.5, y: -20 }}
                className={cn(
                  "absolute top-12 left-1/2 -translate-x-1/2 px-8 py-3 rounded-full font-black text-2xl shadow-2xl z-30",
                  lastResult > 0 ? "bg-emerald-500 text-black shadow-emerald-500/50" : "bg-red-500 text-white shadow-red-500/50"
                )}
              >
                {lastResult > 0 ? `WIN x${lastResult.toFixed(2)}` : 'LOSE'}
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
              <span className="text-xs font-black text-white/40 uppercase tracking-widest">Recent Spins</span>
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
