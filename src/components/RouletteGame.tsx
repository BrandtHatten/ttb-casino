import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Coins, History, Timer, Trophy, Info, AlertCircle } from 'lucide-react';
import { User } from '../types';

interface RouletteGameProps {
  socket: any;
  user: User | null;
}

interface Bet {
  userId: string;
  betAmount: number;
  username: string;
  type: string;
  value: any;
}

interface RouletteResult {
  number: number;
  color: string;
  history: { number: number; color: string }[];
  bets: Bet[];
}

const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

// European Roulette Wheel Sequence
const WHEEL_SEQUENCE = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

const getColor = (num: number) => {
  if (num === 0) return 'green';
  return RED_NUMBERS.includes(num) ? 'red' : 'black';
};

const getBgColor = (color: string) => {
  switch (color) {
    case 'red': return 'bg-red-600';
    case 'black': return 'bg-zinc-900';
    case 'green': return 'bg-emerald-600';
    default: return 'bg-zinc-800';
  }
};

export default function RouletteGame({ socket, user }: RouletteGameProps) {
  const [gameState, setGameState] = useState<'waiting' | 'spinning' | 'result'>('waiting');
  const [timeLeft, setTimeLeft] = useState(0);
  const [history, setHistory] = useState<{ number: number; color: string }[]>([]);
  const [currentBets, setCurrentBets] = useState<Bet[]>([]);
  const [myBets, setMyBets] = useState<Bet[]>([]);
  const [betAmount, setBetAmount] = useState<string>('10');
  const [lastResult, setLastResult] = useState<{ number: number; color: string } | null>(null);
  const [winningWinnings, setWinningWinnings] = useState<number | null>(null);
  const [wheelOffset, setWheelOffset] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [sessionNet, setSessionNet] = useState(0);

  const wheelRef = useRef<HTMLDivElement>(null);
  const totalOffsetRef = useRef(0);
  const pendingBetRef = useRef(0);
  const gotWinRef = useRef(false);
  const myBetsTotalRef = useRef(0);

  useEffect(() => {
    if (!socket) return;

    socket.emit('roulette:join');

    socket.on('roulette:sync', (data: any) => {
      setGameState(data.state);
      setTimeLeft(data.timeLeft);
      setHistory(data.history);
      setCurrentBets(data.bets);
      setLastResult(data.lastResult);
      
      if (user) {
        setMyBets(data.bets.filter((b: Bet) => b.userId === user.id));
      }

      // Initial alignment if needed
      if (data.lastResult) {
        const itemWidth = 88;
        const totalItems = WHEEL_SEQUENCE.length;
        const resultIndex = WHEEL_SEQUENCE.indexOf(data.lastResult.number);
        const containerWidth = wheelRef.current?.offsetWidth || 0;
        const targetIndex = (10 * totalItems) + resultIndex;
        const targetCenter = (targetIndex * itemWidth) + (itemWidth / 2);
        const initialX = (containerWidth / 2) - targetCenter;
        totalOffsetRef.current = initialX;
        setWheelOffset(initialX);
      }
    });

    socket.on('roulette:waiting', (data: { timeLeft: number }) => {
      setGameState('waiting');
      setTimeLeft(data.timeLeft);
      setWinningWinnings(null);
      if (data.timeLeft === 10) {
        // If no win was received for this round, deduct the pending bet
        if (!gotWinRef.current && pendingBetRef.current > 0) {
          setSessionNet(prev => prev - pendingBetRef.current);
        }
        pendingBetRef.current = 0;
        gotWinRef.current = false;
        setMyBets([]);
        setCurrentBets([]);
        
        // Silent reset to a safe range (repetition 10)
        // This keeps the wheel visual identical but prevents offset from growing infinitely
        const wheelWidth = WHEEL_SEQUENCE.length * 88;
        const currentX = totalOffsetRef.current;
        if (currentX !== 0) {
          const offsetInWheel = currentX % wheelWidth;
          const normalizedX = offsetInWheel - (10 * wheelWidth);
          totalOffsetRef.current = normalizedX;
          setWheelOffset(normalizedX);
        }
      }
    });

    socket.on('roulette:spin_start', (data: { resultNumber: number }) => {
      setGameState('spinning');
      pendingBetRef.current = myBetsTotalRef.current;
      gotWinRef.current = false;
      handleSpin(data.resultNumber);
    });

    socket.on('roulette:result', (data: RouletteResult) => {
      setGameState('result');
      setLastResult({ number: data.number, color: data.color });
      setHistory(data.history);
      setCurrentBets(data.bets);
    });

    socket.on('roulette:bets_update', (bets: Bet[]) => {
      setCurrentBets(bets);
      if (user) {
        setMyBets(bets.filter(b => b.userId === user.id));
      }
    });

    socket.on('roulette:win_success', (data: { winnings: number }) => {
      setWinningWinnings(data.winnings);
      gotWinRef.current = true;
      setSessionNet(prev => prev + data.winnings - pendingBetRef.current);
    });

    return () => {
      socket.off('roulette:sync');
      socket.off('roulette:waiting');
      socket.off('roulette:spin_start');
      socket.off('roulette:result');
      socket.off('roulette:bets_update');
      socket.off('roulette:win_success');
    };
  }, [socket, user]);

  useEffect(() => {
    myBetsTotalRef.current = myBets.reduce((sum, b) => sum + b.betAmount, 0);
  }, [myBets]);

  const handleSpin = (resultNumber: number) => {
    const itemWidth = 88; // 80px width + 8px margin (mx-1)
    const totalItems = WHEEL_SEQUENCE.length;
    const resultIndex = WHEEL_SEQUENCE.indexOf(resultNumber);
    const containerWidth = wheelRef.current?.offsetWidth || 0;

    // To ensure it always spins right to left, we need to move to a more negative offset
    const currentX = totalOffsetRef.current;
    const currentItemsPassed = Math.abs(currentX / itemWidth);
    
    // Add at least 5 full rotations + random extra
    const minRotations = 5;
    const nextRepetition = Math.ceil(currentItemsPassed / totalItems) + minRotations + Math.floor(Math.random() * 2);
    const targetIndex = (nextRepetition * totalItems) + resultIndex;
    
    // Position of target item's center relative to start of motion.div
    const targetCenter = (targetIndex * itemWidth) + (itemWidth / 2);
    
    // We want targetCenter to be at containerWidth / 2
    const nextX = (containerWidth / 2) - targetCenter;
    
    totalOffsetRef.current = nextX;
    setWheelOffset(nextX);
    setIsSpinning(true);

    setTimeout(() => {
      setIsSpinning(false);
    }, 4000);
  };

  const placeBet = (type: string, value: any = null) => {
    if (gameState !== 'waiting') return;
    const amount = Math.round(parseFloat(betAmount) * 100) / 100;
    if (isNaN(amount) || amount < 0.01) return;
    if (user && user.credits < amount) return;

    socket.emit('roulette:bet', { amount, type, value });
  };

  const removeBet = (type: string, value: any) => {
    if (gameState !== 'waiting') return;
    socket.emit('roulette:remove_bet', { type, value });
  };

  const getBetAmount = (type: string, value: any = null) => {
    const bet = myBets.find(b => b.type === type && b.value === value);
    return bet ? bet.betAmount : 0;
  };

  const renderWheel = () => {
    // Create a long sequence for the wheel to allow multiple spins
    const displaySequence = [];
    for (let i = 0; i < 100; i++) {
      displaySequence.push(...WHEEL_SEQUENCE);
    }

    return (
      <div ref={wheelRef} className="relative w-full h-32 bg-zinc-900/50 rounded-xl border border-zinc-800 overflow-hidden mb-8">
        {/* Center Indicator */}
        <div className="absolute left-1/2 top-0 bottom-0 w-1 bg-yellow-500 z-10 shadow-[0_0_15px_rgba(234,179,8,0.5)]" />
        
        <motion.div
          className="flex h-full items-center"
          animate={{ x: wheelOffset }}
          transition={isSpinning ? { duration: 4, ease: [0.15, 0, 0.15, 1] } : { duration: 0 }}
          style={{ width: `${displaySequence.length * 88}px` }}
        >
          {displaySequence.map((num, i) => (
            <div
              key={i}
              className={`flex-shrink-0 w-20 h-20 mx-1 rounded-lg flex items-center justify-center text-2xl font-bold text-white shadow-lg ${getBgColor(getColor(num))}`}
            >
              {num}
            </div>
          ))}
        </motion.div>

        {/* Gradient Overlays */}
        <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-zinc-900 to-transparent z-5" />
        <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-zinc-900 to-transparent z-5" />
      </div>
    );
  };

  const renderBettingTable = () => {
    const numbers = Array.from({ length: 36 }, (_, i) => i + 1);
    
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Column: Controls */}
        <div className="space-y-6">
          <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800">
            <div className="flex items-center gap-2 mb-4 text-zinc-400">
              <Coins className="w-4 h-4" />
              <span className="text-sm font-medium uppercase tracking-wider">Bet Amount</span>
            </div>
            <div className="relative">
              <input
                type="number"
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xl font-bold text-white focus:outline-none focus:border-yellow-500/50 transition-colors"
                placeholder="0.00"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                <button 
                  onClick={() => setBetAmount(prev => (Math.max(0.01, parseFloat(prev) / 2)).toFixed(2))}
                  className="px-2 py-1 text-xs font-bold bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400 transition-colors"
                >
                  1/2
                </button>
                <button 
                  onClick={() => setBetAmount(prev => (parseFloat(prev) * 2).toFixed(2))}
                  className="px-2 py-1 text-xs font-bold bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400 transition-colors"
                >
                  2x
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-2 mt-4">
              {[10, 50, 100, 500].map(amt => (
                <button
                  key={amt}
                  onClick={() => setBetAmount(amt.toString())}
                  className="py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors"
                >
                  ${amt}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-zinc-400">
                <Timer className="w-4 h-4" />
                <span className="text-sm font-medium uppercase tracking-wider">Game Status</span>
              </div>
              {gameState === 'waiting' && (
                <span className="text-yellow-500 font-bold animate-pulse">{timeLeft}s</span>
              )}
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">My Active Bets</span>
                <span className="text-white font-medium">{myBets.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Total Wagered</span>
                <span className="text-yellow-500 font-bold">
                  ${myBets.reduce((acc, b) => acc + b.betAmount, 0)}
                </span>
              </div>
            </div>
          </div>

          {winningWinnings && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl flex items-center gap-3"
            >
              <Trophy className="w-6 h-6 text-emerald-500" />
              <div>
                <p className="text-xs text-emerald-500/70 font-medium uppercase">You Won!</p>
                <p className="text-xl font-bold text-emerald-500">+${winningWinnings}</p>
              </div>
            </motion.div>
          )}
        </div>

        {/* Middle & Right Column: Betting Board */}
        <div className="md:col-span-2 space-y-4">
          <div className="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800">
            {/* Main Numbers Grid */}
            <div className="flex gap-1">
              {/* Zero */}
              <button
                onClick={() => placeBet('straight', 0)}
                className="w-16 h-full min-h-[120px] bg-emerald-600 hover:bg-emerald-500 rounded-lg flex flex-col items-center justify-center text-xl font-bold transition-all hover:scale-105 active:scale-95 relative overflow-hidden"
              >
                <span>0</span>
                {getBetAmount('straight', 0) > 0 && (
                  <div className="absolute bottom-1 left-1 right-1 bg-white/20 rounded text-[10px] py-0.5">
                    ${getBetAmount('straight', 0)}
                  </div>
                )}
              </button>
              
              <div className="flex-1 grid grid-cols-12 grid-rows-3 gap-1">
                {/* Numbers 1-36 are usually in 3 rows: 
                   Row 1: 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36
                   Row 2: 2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35
                   Row 3: 1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34
                */}
                {[3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36,
                  2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35,
                  1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34].map((num) => (
                  <button
                    key={num}
                    onClick={() => placeBet('straight', num)}
                    className={`h-10 rounded flex flex-col items-center justify-center font-bold text-sm transition-all hover:scale-110 active:scale-95 relative overflow-hidden ${getBgColor(getColor(num))}`}
                  >
                    <span>{num}</span>
                    {getBetAmount('straight', num) > 0 && (
                      <div className="absolute bottom-0.5 left-0.5 right-0.5 bg-white/20 rounded-[2px] text-[8px] leading-none py-0.5">
                        ${getBetAmount('straight', num)}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Outside Bets */}
            <div className="grid grid-cols-3 gap-1 mt-4">
              <button 
                onClick={() => placeBet('dozen1')}
                className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors relative overflow-hidden"
              >
                <span>1st 12</span>
                {getBetAmount('dozen1') > 0 && (
                  <div className="absolute bottom-1 left-1 right-1 bg-white/10 rounded text-[9px] py-0.5">
                    ${getBetAmount('dozen1')}
                  </div>
                )}
              </button>
              <button 
                onClick={() => placeBet('dozen2')}
                className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors relative overflow-hidden"
              >
                <span>2nd 12</span>
                {getBetAmount('dozen2') > 0 && (
                  <div className="absolute bottom-1 left-1 right-1 bg-white/10 rounded text-[9px] py-0.5">
                    ${getBetAmount('dozen2')}
                  </div>
                )}
              </button>
              <button 
                onClick={() => placeBet('dozen3')}
                className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors relative overflow-hidden"
              >
                <span>3rd 12</span>
                {getBetAmount('dozen3') > 0 && (
                  <div className="absolute bottom-1 left-1 right-1 bg-white/10 rounded text-[9px] py-0.5">
                    ${getBetAmount('dozen3')}
                  </div>
                )}
              </button>
            </div>

            <div className="grid grid-cols-6 gap-1 mt-1">
              <button 
                onClick={() => placeBet('low')}
                className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors relative overflow-hidden"
              >
                <span>1-18</span>
                {getBetAmount('low') > 0 && (
                  <div className="absolute bottom-1 left-1 right-1 bg-white/10 rounded text-[9px] py-0.5">
                    ${getBetAmount('low')}
                  </div>
                )}
              </button>
              <button 
                onClick={() => placeBet('even')}
                className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors relative overflow-hidden"
              >
                <span>Even</span>
                {getBetAmount('even') > 0 && (
                  <div className="absolute bottom-1 left-1 right-1 bg-white/10 rounded text-[9px] py-0.5">
                    ${getBetAmount('even')}
                  </div>
                )}
              </button>
              <button 
                onClick={() => placeBet('red')}
                className="py-3 bg-red-600 hover:bg-red-500 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors relative overflow-hidden"
              >
                <span>Red</span>
                {getBetAmount('red') > 0 && (
                  <div className="absolute bottom-1 left-1 right-1 bg-white/20 rounded text-[9px] py-0.5">
                    ${getBetAmount('red')}
                  </div>
                )}
              </button>
              <button 
                onClick={() => placeBet('black')}
                className="py-3 bg-zinc-950 hover:bg-zinc-900 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors border border-zinc-800 relative overflow-hidden"
              >
                <span>Black</span>
                {getBetAmount('black') > 0 && (
                  <div className="absolute bottom-1 left-1 right-1 bg-white/10 rounded text-[9px] py-0.5">
                    ${getBetAmount('black')}
                  </div>
                )}
              </button>
              <button 
                onClick={() => placeBet('odd')}
                className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors relative overflow-hidden"
              >
                <span>Odd</span>
                {getBetAmount('odd') > 0 && (
                  <div className="absolute bottom-1 left-1 right-1 bg-white/10 rounded text-[9px] py-0.5">
                    ${getBetAmount('odd')}
                  </div>
                )}
              </button>
              <button 
                onClick={() => placeBet('high')}
                className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors relative overflow-hidden"
              >
                <span>19-36</span>
                {getBetAmount('high') > 0 && (
                  <div className="absolute bottom-1 left-1 right-1 bg-white/10 rounded text-[9px] py-0.5">
                    ${getBetAmount('high')}
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* Recent History */}
          <div className="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800">
            <div className="flex items-center gap-2 mb-3 text-zinc-500">
              <History className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Recent History</span>
            </div>
            <div className="flex flex-wrap gap-2 pb-2">
              {history.slice(0, 15).map((res, i) => (
                <div
                  key={i}
                  className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm ${getBgColor(res.color)}`}
                >
                  {res.number}
                </div>
              ))}
              {history.length === 0 && (
                <span className="text-zinc-600 text-xs italic">No history yet</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
            ROULETTE
            <span className="px-2 py-1 bg-yellow-500 text-black text-[10px] font-bold rounded uppercase tracking-widest">Live</span>
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Classic European Roulette with 35:1 payouts</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Session Net</p>
            <p className={`text-xl font-black font-mono ${sessionNet >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {sessionNet >= 0 ? '+' : ''}${sessionNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Your Balance</p>
            <p className="text-xl font-black text-white">${user?.credits.toLocaleString()}</p>
          </div>
          <button className="p-2 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800 transition-colors">
            <Info className="w-5 h-5 text-zinc-400" />
          </button>
        </div>
      </div>

      {renderWheel()}
      
      {/* Betting Phase Timer */}
      {gameState === 'waiting' && (
        <div className="mb-8 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-yellow-500 flex items-center justify-center text-black font-black text-xl">
              {timeLeft}
            </div>
            <div>
              <p className="text-sm font-black text-yellow-500 uppercase tracking-widest">Betting Phase</p>
              <p className="text-xs text-yellow-500/60 font-medium">Place your bets now!</p>
            </div>
          </div>
          <div className="flex gap-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <div 
                key={i} 
                className={`h-1.5 w-8 rounded-full transition-colors duration-500 ${i < timeLeft ? 'bg-yellow-500' : 'bg-zinc-800'}`} 
              />
            ))}
          </div>
        </div>
      )}

      {renderBettingTable()}

      {/* Active Bets List */}
      <div className="mt-8 bg-zinc-900/30 rounded-2xl border border-zinc-800/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Current Bets</h2>
          <span className="text-xs text-zinc-500">{currentBets.length} active bets</span>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-zinc-900/50 sticky top-0">
              <tr>
                <th className="px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Player</th>
                <th className="px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Bet Type</th>
                <th className="px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-right">Amount</th>
                <th className="px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {currentBets.map((bet, i) => (
                <tr key={i} className="hover:bg-zinc-800/20 transition-colors">
                  <td className="px-6 py-4">
                    <span className="text-sm font-medium text-zinc-300">{bet.username}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                      {bet.type} {bet.value !== null && `(${bet.value})`}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-bold text-yellow-500">${bet.betAmount.toLocaleString()}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {user && bet.userId === user.id && gameState === 'waiting' && (
                      <button 
                        onClick={() => removeBet(bet.type, bet.value)}
                        className="text-[10px] font-bold text-red-500 hover:text-red-400 uppercase tracking-widest transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {currentBets.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-zinc-600 text-sm italic">
                    Waiting for bets to be placed...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
