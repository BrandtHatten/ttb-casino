import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Coins, 
  History, 
  Trophy, 
  TrendingUp, 
  ChevronLeft, 
  ChevronRight,
  Shield,
  Sword,
  Zap,
  ArrowRight
} from 'lucide-react';
import { useWar, Card, CardSuit } from './useWar';
import { cn } from '../../../lib/utils';

interface WarGameProps {
  balance: number;
  setBalance: React.Dispatch<React.SetStateAction<number>>;
  socket?: any;
  user?: any;
}

const SuitIcon = ({ suit, className }: { suit: CardSuit; className?: string }) => {
  switch (suit) {
    case 'hearts': return <span className={`text-red-600 ${className}`}>♥</span>;
    case 'diamonds': return <span className={`text-red-600 ${className}`}>♦</span>;
    case 'clubs': return <span className={`text-black ${className}`}>♣</span>;
    case 'spades': return <span className={`text-black ${className}`}>♠</span>;
  }
};

const PlayingCard = ({ card, label, isHidden = false }: { card: Card | null; label: string; isHidden?: boolean }) => {
  return (
    <div className="flex flex-col items-center gap-4">
      <span className="text-sm font-bold text-amber-500/60 uppercase tracking-widest">{label}</span>
      <div className="relative w-40 h-56 [perspective:1000px]">
        <AnimatePresence mode="wait">
          {!card || isHidden ? (
            <motion.div
              key="back"
              initial={{ rotateY: 180, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              exit={{ rotateY: -180, opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
              className="absolute inset-0 bg-[#1a1c23] rounded-xl border-2 border-amber-500/20 shadow-[0_0_30px_rgba(0,0,0,0.5)] flex items-center justify-center overflow-hidden"
            >
              <div className="absolute inset-2 border border-amber-500/10 rounded-lg flex items-center justify-center">
                <div className="w-full h-full opacity-10 bg-[radial-gradient(circle_at_center,theme(colors.amber.500)_0%,transparent_70%)]" />
                <Zap className="w-12 h-12 text-amber-500/20" />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={`front-${card.suit}-${card.value}`}
              initial={{ rotateY: 180, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              exit={{ rotateY: -180, opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
              className="absolute inset-0 bg-white rounded-xl border-4 border-[#1a1c23] shadow-[0_0_40px_rgba(0,0,0,0.6)] flex flex-col p-4"
            >
              <div className="flex justify-between items-start">
                <div className="flex flex-col items-center leading-none">
                  <span className={`text-2xl font-black ${['hearts', 'diamonds'].includes(card.suit) ? 'text-red-600' : 'text-black'}`}>
                    {card.label}
                  </span>
                  <SuitIcon suit={card.suit} className="text-xl" />
                </div>
              </div>
              
              <div className="flex-1 flex items-center justify-center">
                <SuitIcon suit={card.suit} className="text-7xl drop-shadow-md" />
              </div>
              
              <div className="flex justify-between items-end rotate-180">
                <div className="flex flex-col items-center leading-none">
                  <span className={`text-2xl font-black ${['hearts', 'diamonds'].includes(card.suit) ? 'text-red-600' : 'text-black'}`}>
                    {card.label}
                  </span>
                  <SuitIcon suit={card.suit} className="text-xl" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export const WarGame: React.FC<WarGameProps> = ({ balance, setBalance, socket, user }) => {
  const {
    betAmount,
    setBetAmount,
    status,
    playerCard,
    aiCard,
    gameResult,
    pot,
    history,
    playHand,
    goToWar,
    surrender,
  } = useWar(balance, setBalance);

  const [sessionNet, setSessionNet] = useState(0);
  const prevHistoryLen = useRef(0);

  // Track session net and emit socket events when a hand completes
  useEffect(() => {
    if (history.length > prevHistoryLen.current) {
      const last = history[0];
      const net = last.winAmount - (last.result === 'win' ? last.winAmount / (last.winAmount === betAmount * 8 ? 8 : 2) : betAmount);
      setSessionNet(prev => prev + (last.winAmount - betAmount));
      if (socket) {
        socket.emit('war:result', {
          betAmount,
          winAmount: last.winAmount,
          won: last.result === 'win'
        });
      }
      prevHistoryLen.current = history.length;
    }
  }, [history.length]);

  // Emit war:bet on each new hand start
  const prevStatus = useRef<string>('idle');
  useEffect(() => {
    if (status === 'dealing' && prevStatus.current !== 'dealing' && socket) {
      socket.emit('war:bet', { betAmount });
    }
    prevStatus.current = status;
  }, [status]);

  return (
    <div className="flex flex-col lg:flex-row gap-8 max-w-7xl mx-auto p-4 lg:p-8 min-h-[calc(100vh-80px)]">
      {/* Sidebar Controls */}
      <div className="w-full lg:w-80 flex flex-col gap-6">
        <div className="bg-[#1a1c23]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/5 shadow-2xl">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 bg-amber-500/10 rounded-xl">
              <TrendingUp className="w-5 h-5 text-amber-500" />
            </div>
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">Betting</h2>
          </div>

          <div className="space-y-6">
            {/* Session Net */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white/30 uppercase tracking-widest">Session</span>
              <span className={cn(
                "px-3 py-1 rounded-full text-xs font-black border",
                sessionNet >= 0
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
              )}>
                {sessionNet >= 0 ? '+' : ''}{sessionNet.toFixed(2)}
              </span>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <label className="text-xs font-bold text-amber-500/60 uppercase tracking-widest">Bet Amount</label>
                <span className="text-xs font-mono text-white/40">${balance.toLocaleString()}</span>
              </div>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                  <Coins className="w-4 h-4 text-amber-500/40 group-focus-within:text-amber-500 transition-colors" />
                </div>
                <input
                  type="number"
                  value={betAmount}
                  onChange={(e) => setBetAmount(Math.max(1, Number(e.target.value)))}
                  disabled={status !== 'idle' && status !== 'result'}
                  className="w-full bg-black/40 border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white font-mono focus:outline-none focus:border-amber-500/50 transition-all disabled:opacity-50"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button
                  onClick={() => setBetAmount(Math.max(1, Math.floor(betAmount / 2)))}
                  disabled={status !== 'idle' && status !== 'result'}
                  className="py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-white transition-colors disabled:opacity-50"
                >
                  1/2
                </button>
                <button
                  onClick={() => setBetAmount(Math.min(balance, betAmount * 2))}
                  disabled={status !== 'idle' && status !== 'result'}
                  className="py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-white transition-colors disabled:opacity-50"
                >
                  2x
                </button>
              </div>
            </div>

            {status === 'war' ? (
              <div className="space-y-3">
                <button
                  onClick={goToWar}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-black font-black py-5 rounded-2xl shadow-[0_0_30px_rgba(245,158,11,0.3)] transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 uppercase tracking-tighter text-lg"
                >
                  <Sword className="w-6 h-6" />
                  Go to War!
                </button>
                <button
                  onClick={surrender}
                  className="w-full bg-white/5 hover:bg-white/10 text-white font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-sm"
                >
                  <Shield className="w-4 h-4" />
                  Surrender
                </button>
              </div>
            ) : (
              <button
                onClick={playHand}
                disabled={status === 'dealing' || balance < betAmount}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-white/5 disabled:text-white/20 text-black font-black py-5 rounded-2xl shadow-[0_0_30px_rgba(245,158,11,0.3)] transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 uppercase tracking-tighter text-lg"
              >
                {status === 'dealing' ? (
                  <div className="w-6 h-6 border-4 border-black/20 border-t-black rounded-full animate-spin" />
                ) : (
                  <>
                    <Zap className="w-6 h-6" />
                    Deal Hand
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* History */}
        <div className="bg-[#1a1c23]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/5 flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <History className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">Recent Hands</h2>
          </div>
          <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar">
            <AnimatePresence initial={false}>
              {history.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center justify-between p-3 bg-black/20 rounded-xl border border-white/5"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-2">
                      <div className="w-8 h-10 bg-white rounded border border-black/10 flex items-center justify-center text-xs font-bold text-black">
                        {item.player.label}
                      </div>
                      <div className="w-8 h-10 bg-white rounded border border-black/10 flex items-center justify-center text-xs font-bold text-black">
                        {item.ai.label}
                      </div>
                    </div>
                    <span className={`text-xs font-bold uppercase ${item.result === 'win' ? 'text-green-500' : 'text-red-500'}`}>
                      {item.result}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-white/60">
                    {item.winAmount > 0 ? `+$${item.winAmount}` : '-'}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="flex-1 flex flex-col gap-6 relative">
        <div className="flex-1 bg-[#1a1c23]/80 backdrop-blur-xl rounded-[40px] border border-white/5 shadow-2xl relative overflow-hidden flex flex-col items-center justify-center p-8">
          {/* Background Decoration */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-[120px]" />
          
          <div className="relative w-full max-w-4xl flex flex-col items-center gap-12 z-10">
            {/* Result Message */}
            <div className="h-20 flex items-center justify-center">
              <AnimatePresence>
                {status === 'result' && (
                  <motion.div
                    initial={{ opacity: 0, y: -20, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.9 }}
                    transition={{ 
                      duration: 0.4,
                      delay: 0.6, // Wait for card flip (0.4s) + small buffer
                      ease: "easeOut"
                    }}
                  >
                    <div className={`px-12 py-4 rounded-2xl border-2 shadow-2xl flex items-center gap-4 ${
                      gameResult === 'win' 
                        ? 'bg-green-500/10 border-green-500/50 text-green-500' 
                        : 'bg-red-500/10 border-red-500/50 text-red-500'
                    }`}>
                      {gameResult === 'win' ? (
                        <>
                          <Trophy className="w-8 h-8" />
                          <div className="flex flex-col">
                            <span className="text-2xl font-black uppercase italic tracking-tighter">Victory!</span>
                            <span className="text-xs font-bold opacity-60">You won the hand</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <Zap className="w-8 h-8" />
                          <div className="flex flex-col">
                            <span className="text-2xl font-black uppercase italic tracking-tighter">Defeat</span>
                            <span className="text-xs font-bold opacity-60">Dealer takes the pot</span>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Pot Display */}
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs font-bold text-amber-500/60 uppercase tracking-[0.3em]">Total Pot</span>
              <div className="px-8 py-3 bg-black/40 rounded-full border border-amber-500/20 shadow-[0_0_30px_rgba(245,158,11,0.1)]">
                <span className="text-3xl font-black text-white font-mono">${pot.toLocaleString()}</span>
              </div>
            </div>

            {/* Cards Area */}
            <div className="w-full flex flex-col md:flex-row items-center justify-center gap-12 md:gap-24">
              <PlayingCard card={playerCard} label="Your Card" />
              
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 bg-amber-500/10 rounded-full flex items-center justify-center border border-amber-500/20">
                  <span className="text-amber-500 font-black text-xl italic">VS</span>
                </div>
                {status === 'war' && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.6, duration: 0.4 }}
                    className="px-4 py-1 bg-red-500 rounded-full text-[10px] font-black text-white uppercase tracking-widest animate-pulse"
                  >
                    WAR!
                  </motion.div>
                )}
              </div>

              <PlayingCard card={aiCard} label="Dealer Card" />
            </div>

          {/* War Overlay */}
            <AnimatePresence>
              {status === 'war' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.6, duration: 0.4 }}
                  className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-[40px]"
                >
                  <div className="bg-[#1a1c23] border-2 border-red-500/50 p-12 rounded-[40px] shadow-[0_0_100px_rgba(239,68,68,0.3)] flex flex-col items-center text-center gap-6">
                    <div className="w-24 h-24 bg-red-500/10 rounded-full flex items-center justify-center border-2 border-red-500/20 mb-2">
                      <Sword className="w-12 h-12 text-red-500 animate-bounce" />
                    </div>
                    <div>
                      <h3 className="text-5xl font-black text-white uppercase italic tracking-tighter mb-2">It's a Tie!</h3>
                      <p className="text-white/60 max-w-xs text-sm leading-relaxed">
                        The cards are equal. You can surrender half your bet or <span className="text-red-500 font-bold">Go to War</span> for a chance to win double the pot!
                      </p>
                    </div>
                    <div className="flex gap-4 w-full">
                      <button
                        onClick={goToWar}
                        className="flex-1 bg-red-500 hover:bg-red-400 text-white font-black py-4 rounded-2xl transition-all uppercase tracking-tighter"
                      >
                        Go to War
                      </button>
                      <button
                        onClick={surrender}
                        className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-4 rounded-2xl transition-all uppercase tracking-widest text-xs"
                      >
                        Surrender
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Game Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-[#1a1c23]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/5 shadow-xl flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Win Rate</span>
            <span className="text-xl font-black text-white">
              {history.length > 0 
                ? `${Math.round((history.filter(h => h.result === 'win').length / history.length) * 100)}%`
                : '0%'
              }
            </span>
          </div>
          <div className="bg-[#1a1c23]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/5 shadow-xl flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Total Hands</span>
            <span className="text-xl font-black text-white">{history.length}</span>
          </div>
          <div className="bg-[#1a1c23]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/5 shadow-xl flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Max Win</span>
            <span className="text-xl font-black text-green-500">
              ${Math.max(0, ...history.map(h => h.winAmount)).toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
