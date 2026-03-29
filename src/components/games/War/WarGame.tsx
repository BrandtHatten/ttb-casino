import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Coins,
  History,
  Trophy,
  TrendingUp,
  Shield,
  Sword,
  Zap,
  Users,
  Loader2,
  RefreshCw,
  UserX,
  Crown,
} from 'lucide-react';
import { Card, CardSuit } from './useWar';
import { cn } from '../../../lib/utils';

interface WarGameProps {
  balance: number;
  setBalance: React.Dispatch<React.SetStateAction<number>>;
  socket?: any;
  user?: any;
}

type GameStatus = 'idle' | 'queuing' | 'matched' | 'revealing' | 'result' | 'war_pending' | 'war_deciding' | 'war_revealing' | 'war_result';

const SuitIcon = ({ suit, className }: { suit: CardSuit; className?: string }) => {
  switch (suit) {
    case 'hearts':   return <span className={`text-red-600 ${className}`}>♥</span>;
    case 'diamonds': return <span className={`text-red-600 ${className}`}>♦</span>;
    case 'clubs':    return <span className={`text-black ${className}`}>♣</span>;
    case 'spades':   return <span className={`text-black ${className}`}>♠</span>;
  }
};

const PlayingCard = ({ card, label, isHidden = false }: { card: Card | null; label: string; isHidden?: boolean }) => (
  <div className="flex flex-col items-center gap-2 sm:gap-4">
    <span className="text-xs sm:text-sm font-bold text-amber-500/60 uppercase tracking-widest">{label}</span>
    <div className="relative w-20 h-28 sm:w-36 sm:h-52 [perspective:1000px]">
      <AnimatePresence mode="wait">
        {!card || isHidden ? (
          <motion.div
            key="back"
            initial={{ rotateY: 180, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            exit={{ rotateY: -180, opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            className="absolute inset-0 bg-[#1a1c23] rounded-xl border-2 border-amber-500/20 shadow-[0_0_30px_rgba(0,0,0,0.5)] flex items-center justify-center overflow-hidden"
          >
            <div className="absolute inset-2 border border-amber-500/10 rounded-lg flex items-center justify-center">
              <div className="w-full h-full opacity-10 bg-[radial-gradient(circle_at_center,theme(colors.amber.500)_0%,transparent_70%)]" />
              <Zap className="w-8 h-8 sm:w-12 sm:h-12 text-amber-500/20" />
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={`front-${card.suit}-${card.value}`}
            initial={{ rotateY: 180, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            exit={{ rotateY: -180, opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            className="absolute inset-0 bg-white rounded-xl border-4 border-[#1a1c23] shadow-[0_0_40px_rgba(0,0,0,0.6)] flex flex-col p-2 sm:p-4 overflow-hidden"
          >
            <div className="flex justify-between items-start">
              <div className="flex flex-col items-center leading-none">
                <span className={`text-base sm:text-2xl font-black ${['hearts', 'diamonds'].includes(card.suit) ? 'text-red-600' : 'text-black'}`}>
                  {card.label}
                </span>
                <SuitIcon suit={card.suit} className="text-sm sm:text-xl" />
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <SuitIcon suit={card.suit} className="text-4xl sm:text-7xl drop-shadow-md" />
            </div>
            <div className="flex justify-between items-end rotate-180">
              <div className="flex flex-col items-center leading-none">
                <span className={`text-base sm:text-2xl font-black ${['hearts', 'diamonds'].includes(card.suit) ? 'text-red-600' : 'text-black'}`}>
                  {card.label}
                </span>
                <SuitIcon suit={card.suit} className="text-sm sm:text-xl" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  </div>
);

export const WarGame: React.FC<WarGameProps> = ({ balance, setBalance, socket, user }) => {
  const [betAmount, setBetAmount] = useState(10);
  const [status, setStatus] = useState<GameStatus>('idle');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [opponent, setOpponent] = useState<{ username: string } | null>(null);
  const [playerCard, setPlayerCard] = useState<Card | null>(null);
  const [opponentCard, setOpponentCard] = useState<Card | null>(null);
  const [playerWarCard, setPlayerWarCard] = useState<Card | null>(null);
  const [opponentWarCard, setOpponentWarCard] = useState<Card | null>(null);
  const [gameResult, setGameResult] = useState<'win' | 'lose' | 'surrender' | null>(null);
  const [winAmount, setWinAmount] = useState(0);
  const [sessionNet, setSessionNet] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  const [myDecision, setMyDecision] = useState<'war' | 'surrender' | null>(null);

  const roomIdRef = useRef<string | null>(null);
  const betAmountRef = useRef(betAmount);
  useEffect(() => { betAmountRef.current = betAmount; }, [betAmount]);

  useEffect(() => {
    if (!socket) return;

    socket.on('war:pvp_queued', () => {
      setStatus('queuing');
    });

    socket.on('war:pvp_matched', (data: { roomId: string; opponent: { username: string } }) => {
      setRoomId(data.roomId);
      roomIdRef.current = data.roomId;
      setOpponent(data.opponent);
      setStatus('matched');
      setPlayerCard(null);
      setOpponentCard(null);
      setPlayerWarCard(null);
      setOpponentWarCard(null);
      setGameResult(null);
      setMyDecision(null);
    });

    socket.on('war:pvp_cards', (data: { yourCard: Card; opponentCard: Card }) => {
      setPlayerCard(data.yourCard);
      setOpponentCard(data.opponentCard);
      setStatus('result');
    });

    socket.on('war:pvp_tie', () => {
      setStatus('war_pending');
    });

    socket.on('war:pvp_war_cards', (data: { yourCard: Card; opponentCard: Card }) => {
      setPlayerWarCard(data.yourCard);
      setOpponentWarCard(data.opponentCard);
      setStatus('war_result');
    });

    socket.on('war:pvp_result', (data: { result: 'win' | 'lose' | 'surrender'; winAmount: number; betAmount: number }) => {
      const net = data.result === 'win' ? data.winAmount - data.betAmount : data.result === 'surrender' ? -Math.floor(data.betAmount / 2) : -data.betAmount;
      setSessionNet(prev => prev + net);
      setGameResult(data.result);
      setWinAmount(data.winAmount);
      setStatus(prev => prev === 'war_result' || prev === 'war_deciding' ? 'war_result' : 'result');
      setHistory(prev => [{
        id: Date.now(),
        result: data.result,
        winAmount: data.winAmount,
        betAmount: data.betAmount,
        opponent: opponent?.username ?? '?',
        timestamp: new Date().toLocaleTimeString(),
      }, ...prev].slice(0, 10));
    });

    socket.on('war:pvp_opponent_left', () => {
      setStatus('idle');
      setOpponent(null);
      setRoomId(null);
      roomIdRef.current = null;
    });

    return () => {
      socket.off('war:pvp_queued');
      socket.off('war:pvp_matched');
      socket.off('war:pvp_cards');
      socket.off('war:pvp_tie');
      socket.off('war:pvp_war_cards');
      socket.off('war:pvp_result');
      socket.off('war:pvp_opponent_left');
    };
  }, [socket, opponent]);

  // Leave queue on unmount
  useEffect(() => {
    return () => { if (socket) socket.emit('war:pvp_leave_queue'); };
  }, [socket]);

  const findMatch = () => {
    if (!socket || balance < betAmount) return;
    socket.emit('war:pvp_queue', { betAmount });
  };

  const cancelQueue = () => {
    if (!socket) return;
    socket.emit('war:pvp_leave_queue');
    setStatus('idle');
  };

  const sendDecision = (decision: 'war' | 'surrender') => {
    if (!socket || !roomIdRef.current) return;
    setMyDecision(decision);
    setStatus('war_deciding');
    socket.emit('war:pvp_decision', { roomId: roomIdRef.current, decision });
  };

  const playAgain = () => {
    setStatus('idle');
    setRoomId(null);
    roomIdRef.current = null;
    setOpponent(null);
    setPlayerCard(null);
    setOpponentCard(null);
    setPlayerWarCard(null);
    setOpponentWarCard(null);
    setGameResult(null);
    setMyDecision(null);
  };

  const isInGame = status !== 'idle';
  const showWarOverlay = status === 'war_pending' || status === 'war_deciding';
  const showCards = ['result', 'war_pending', 'war_deciding', 'war_revealing', 'war_result'].includes(status);
  const showWarCards = ['war_revealing', 'war_result'].includes(status);

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-8 max-w-7xl mx-auto p-4 lg:p-8 w-full overflow-y-auto custom-scrollbar">
      {/* Sidebar */}
      <div className="w-full lg:w-80 flex flex-col gap-6">
        <div className="bg-[#1a1c23]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/5 shadow-2xl">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 bg-amber-500/10 rounded-xl">
              <TrendingUp className="w-5 h-5 text-amber-500" />
            </div>
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">War PVP</h2>
            <span className="ml-auto px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded-full text-[10px] font-black text-red-400 uppercase tracking-widest">Live</span>
          </div>

          <div className="space-y-5">
            {/* Session Net */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white/30 uppercase tracking-widest">Session</span>
              <span className={cn(
                'px-3 py-1 rounded-full text-xs font-black border',
                sessionNet >= 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'
              )}>
                {sessionNet >= 0 ? '+' : ''}{sessionNet.toFixed(2)}
              </span>
            </div>

            {/* Opponent badge */}
            {opponent && (
              <div className="flex items-center gap-3 p-3 bg-white/5 rounded-2xl border border-white/5">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <Users className="w-4 h-4 text-amber-500" />
                </div>
                <div>
                  <p className="text-[10px] text-white/30 uppercase tracking-widest">Opponent</p>
                  <p className="text-sm font-black text-white">{opponent.username}</p>
                </div>
              </div>
            )}

            {/* Bet Amount */}
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
                  type="number" inputMode="decimal"
                  value={betAmount}
                  onChange={(e) => setBetAmount(Math.max(1, Number(e.target.value)))}
                  disabled={isInGame}
                  className="w-full bg-black/40 border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white font-mono focus:outline-none focus:border-amber-500/50 transition-all disabled:opacity-50"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button
                  onClick={() => setBetAmount(Math.max(1, Math.floor(betAmount / 2)))}
                  disabled={isInGame}
                  className="py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-white transition-colors disabled:opacity-50"
                >1/2</button>
                <button
                  onClick={() => setBetAmount(Math.min(balance, betAmount * 2))}
                  disabled={isInGame}
                  className="py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-white transition-colors disabled:opacity-50"
                >2x</button>
              </div>
            </div>

            {/* Action Button */}
            {status === 'idle' && (
              <button
                onClick={findMatch}
                disabled={balance < betAmount}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-white/5 disabled:text-white/20 text-black font-black py-5 rounded-2xl shadow-[0_0_30px_rgba(245,158,11,0.3)] transition-all active:scale-[0.98] flex items-center justify-center gap-2 uppercase tracking-tighter text-lg"
              >
                <Users className="w-6 h-6" />
                Find Match
              </button>
            )}

            {status === 'queuing' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                  <Loader2 className="w-5 h-5 text-amber-500 animate-spin flex-shrink-0" />
                  <div>
                    <p className="text-sm font-black text-white">Finding opponent…</p>
                    <p className="text-[10px] text-white/30 uppercase tracking-widest">Bet: ${betAmount}</p>
                  </div>
                </div>
                <button
                  onClick={cancelQueue}
                  className="w-full py-3 bg-white/5 hover:bg-white/10 text-white font-bold rounded-2xl transition-all uppercase tracking-widest text-sm"
                >
                  Cancel
                </button>
              </div>
            )}

            {(status === 'result' || status === 'war_result') && gameResult && (
              <button
                onClick={playAgain}
                className="w-full bg-amber-500 hover:bg-amber-400 text-black font-black py-5 rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 uppercase tracking-tighter text-lg"
              >
                <RefreshCw className="w-6 h-6" />
                Play Again
              </button>
            )}
          </div>
        </div>

        {/* History */}
        <div className="hidden lg:flex bg-[#1a1c23]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/5 flex-1 overflow-hidden flex-col">
          <div className="flex items-center gap-2 mb-4">
            <History className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">Recent Hands</h2>
          </div>
          <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar">
            <AnimatePresence initial={false}>
              {history.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center justify-between p-3 bg-black/20 rounded-xl border border-white/5"
                >
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-xs font-black uppercase',
                      item.result === 'win' ? 'text-green-500' : item.result === 'surrender' ? 'text-yellow-500' : 'text-red-500'
                    )}>
                      {item.result === 'surrender' ? 'Fold' : item.result}
                    </span>
                    <span className="text-[10px] text-white/30">vs {item.opponent}</span>
                  </div>
                  <span className="text-xs font-mono text-white/60">
                    {item.result === 'win' ? `+$${item.winAmount}` : item.result === 'surrender' ? `-$${Math.floor(item.betAmount/2)}` : `-$${item.betAmount}`}
                  </span>
                </motion.div>
              ))}
              {history.length === 0 && (
                <p className="text-xs text-white/20 text-center py-4">No hands yet</p>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="flex-1 flex flex-col gap-6 relative">
        <div className="flex-1 bg-[#1a1c23]/80 backdrop-blur-xl rounded-[40px] border border-white/5 shadow-2xl relative overflow-hidden flex flex-col items-center justify-center p-4 md:p-8 min-h-[400px]">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-[120px]" />

          <div className="relative w-full max-w-4xl flex flex-col items-center gap-4 md:gap-8 z-10">

            {/* Idle State */}
            {status === 'idle' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center gap-6 text-center"
              >
                <div className="w-24 h-24 bg-amber-500/10 rounded-full flex items-center justify-center border border-amber-500/20">
                  <Sword className="w-12 h-12 text-amber-500" />
                </div>
                <div>
                  <h2 className="text-3xl font-black text-white uppercase italic tracking-tighter mb-2">War PVP</h2>
                  <p className="text-white/40 text-sm max-w-xs">Get matched with a real opponent. Highest card wins. Ties go to War!</p>
                </div>
              </motion.div>
            )}

            {/* Queuing */}
            {status === 'queuing' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-6"
              >
                <div className="relative w-24 h-24">
                  <div className="w-24 h-24 rounded-full border-4 border-amber-500/20 border-t-amber-500 animate-spin" />
                  <Users className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 text-amber-500" />
                </div>
                <p className="text-xl font-black text-white uppercase tracking-tighter">Searching for opponent…</p>
                <p className="text-white/30 text-sm">Bet: ${betAmount} · Anyone can join</p>
              </motion.div>
            )}

            {/* Matched — brief reveal before cards */}
            {status === 'matched' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-4"
              >
                <div className="flex items-center gap-6">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-14 h-14 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                      <span className="text-lg font-black text-amber-500">{user?.username?.[0]?.toUpperCase()}</span>
                    </div>
                    <span className="text-xs font-black text-white/60">{user?.username}</span>
                  </div>
                  <div className="text-2xl font-black text-white/30 italic">VS</div>
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-14 h-14 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                      <span className="text-lg font-black text-red-400">{opponent?.username?.[0]?.toUpperCase()}</span>
                    </div>
                    <span className="text-xs font-black text-white/60">{opponent?.username}</span>
                  </div>
                </div>
                <p className="text-white/40 text-sm">Dealing cards…</p>
              </motion.div>
            )}

            {/* Cards */}
            {showCards && (
              <>
                {/* Result banner */}
                <div className="h-14 flex items-center justify-center">
                  <AnimatePresence>
                    {gameResult && (
                      <motion.div
                        initial={{ opacity: 0, y: -20, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4, delay: 0.6 }}
                        className={cn(
                          'px-6 py-3 rounded-2xl border-2 shadow-2xl flex items-center gap-3',
                          gameResult === 'win' ? 'bg-green-500/10 border-green-500/50 text-green-500' :
                          gameResult === 'surrender' ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-500' :
                          'bg-red-500/10 border-red-500/50 text-red-500'
                        )}
                      >
                        {gameResult === 'win' ? <Crown className="w-7 h-7" /> : gameResult === 'surrender' ? <Shield className="w-7 h-7" /> : <Zap className="w-7 h-7" />}
                        <div>
                          <span className="text-xl font-black uppercase italic tracking-tighter">
                            {gameResult === 'win' ? `Victory! +$${winAmount}` : gameResult === 'surrender' ? 'Surrendered' : 'Defeated'}
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* War cards (shown on top if war round) */}
                {showWarCards && (
                  <div className="flex flex-row items-center justify-center gap-4 md:gap-16 w-full">
                    <PlayingCard card={playerWarCard} label="Your War Card" />
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center border border-red-500/30">
                        <Sword className="w-5 h-5 text-red-500" />
                      </div>
                    </div>
                    <PlayingCard card={opponentWarCard} label={`${opponent?.username ?? 'Opponent'}'s War Card`} />
                  </div>
                )}

                {/* Main cards */}
                <div className="flex flex-row items-center justify-center gap-4 md:gap-16 w-full">
                  <PlayingCard card={playerCard} label="Your Card" />
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 bg-amber-500/10 rounded-full flex items-center justify-center border border-amber-500/20">
                      <span className="text-amber-500 font-black text-lg italic">VS</span>
                    </div>
                  </div>
                  <PlayingCard card={opponentCard} label={`${opponent?.username ?? 'Opponent'}'s Card`} />
                </div>
              </>
            )}

            {/* War Overlay */}
            <AnimatePresence>
              {showWarOverlay && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: 0.8, duration: 0.4 }}
                  className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm rounded-[40px]"
                >
                  <div className="bg-[#1a1c23] border-2 border-red-500/50 p-6 md:p-10 rounded-[40px] shadow-[0_0_100px_rgba(239,68,68,0.3)] flex flex-col items-center text-center gap-5 max-w-sm w-full mx-4">
                    <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center border-2 border-red-500/20">
                      <Sword className="w-8 h-8 text-red-500 animate-bounce" />
                    </div>
                    <div>
                      <h3 className="text-3xl font-black text-white uppercase italic tracking-tighter mb-2">It's a Tie!</h3>
                      {status === 'war_deciding' ? (
                        <div className="flex items-center gap-2 justify-center text-white/50">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-sm">Waiting for {opponent?.username}…</span>
                        </div>
                      ) : (
                        <p className="text-white/50 text-sm leading-relaxed">
                          Go to War (double your bet) or Surrender (lose half).
                        </p>
                      )}
                    </div>
                    {status === 'war_pending' && (
                      <div className="flex gap-3 w-full">
                        <button
                          onClick={() => sendDecision('war')}
                          className="flex-1 bg-red-500 hover:bg-red-400 text-white font-black py-4 rounded-2xl transition-all uppercase tracking-tighter flex items-center justify-center gap-2"
                        >
                          <Sword className="w-5 h-5" />
                          War!
                        </button>
                        <button
                          onClick={() => sendDecision('surrender')}
                          className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-4 rounded-2xl transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2"
                        >
                          <Shield className="w-4 h-4" />
                          Fold
                        </button>
                      </div>
                    )}
                    {status === 'war_deciding' && myDecision && (
                      <div className={cn(
                        'px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest',
                        myDecision === 'war' ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white/50'
                      )}>
                        You chose: {myDecision === 'war' ? '⚔️ War' : '🛡 Fold'}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Opponent left */}
            <AnimatePresence>
              {status === 'idle' && opponent && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-3 text-center"
                >
                  <UserX className="w-12 h-12 text-red-400/50" />
                  <p className="text-white/40 text-sm">Opponent disconnected. Your bet was refunded.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Stats */}
        <div className="hidden lg:grid grid-cols-3 gap-4">
          <div className="bg-[#1a1c23]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/5 shadow-xl flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Win Rate</span>
            <span className="text-xl font-black text-white">
              {history.length > 0 ? `${Math.round((history.filter(h => h.result === 'win').length / history.length) * 100)}%` : '0%'}
            </span>
          </div>
          <div className="bg-[#1a1c23]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/5 shadow-xl flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Hands Played</span>
            <span className="text-xl font-black text-white">{history.length}</span>
          </div>
          <div className="bg-[#1a1c23]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/5 shadow-xl flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Best Win</span>
            <span className="text-xl font-black text-green-500">
              ${history.filter(h => h.result === 'win').reduce((max, h) => Math.max(max, h.winAmount), 0).toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
