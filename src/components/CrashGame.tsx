import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Socket } from 'socket.io-client';
import { TrendingUp, Coins, Users, History, Zap, AlertCircle, User } from 'lucide-react';
import { cn } from '../lib/utils';
import confetti from 'canvas-confetti';

interface CrashGameProps {
  socket: Socket | null;
  user: any;
}

export const CrashGame: React.FC<CrashGameProps> = ({ socket, user }) => {
  const [multiplier, setMultiplier] = useState(1.0);
  const [gameState, setGameState] = useState<'waiting' | 'running' | 'crashed'>('waiting');
  const [timeLeft, setTimeLeft] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [bets, setBets] = useState<any[]>([]);
  const [betAmount, setBetAmount] = useState('10');
  const [autoCashout, setAutoCashout] = useState('');
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [autoSettings, setAutoSettings] = useState({
    numGames: '0',
    advanced: false,
    onWin: { action: 'reset' as 'reset' | 'increase', value: '0' },
    onLoss: { action: 'reset' as 'reset' | 'increase', value: '0' },
    stopOnNetGain: '0',
    stopOnNetLoss: '0',
  });
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [gamesPlayed, setGamesPlayed] = useState(0);
  const [startCredits, setStartCredits] = useState(0);
  const [baseBetAmount, setBaseBetAmount] = useState('10');

  const [hasBet, setHasBet] = useState(false);
  const [isCashedOut, setIsCashedOut] = useState(false);
  const [payout, setPayout] = useState(0);
  const [sessionNet, setSessionNet] = useState(0);
  const [graphPoints, setGraphPoints] = useState<{x: number, y: number}[]>([]);
  const graphRef = useRef<HTMLDivElement>(null);

  const stateRef = useRef<any>({});
  const creditsRef = useRef(user.credits);

  // Update creditsRef when user prop changes
  useEffect(() => {
    creditsRef.current = user.credits;
  }, [user.credits]);

  // Update stateRef every render to keep it fresh for socket handlers
  stateRef.current = {
    mode,
    isAutoRunning,
    betAmount,
    autoCashout,
    autoSettings,
    gamesPlayed,
    startCredits,
    baseBetAmount,
    hasBet,
    isCashedOut,
    gameState,
    credits: user.credits
  };

  useEffect(() => {
    if (!socket) return;

    socket.emit('crash:join');

    const handleUserData = (data: any) => {
      creditsRef.current = data.credits;
    };
    socket.on('user_data', handleUserData);

    socket.on('crash:sync', (data) => {
      setMultiplier(data.multiplier);
      setGameState(data.state);
      setHistory(data.history);
      setTimeLeft(data.timeLeft);
      if (data.points && data.points.length > 0) {
        setGraphPoints(data.points);
      } else if (data.state === 'running') {
        // Fallback if points are missing: at least start from 0
        setGraphPoints([{ x: 0, y: 1.0 }]);
      } else {
        setGraphPoints([]);
      }
      if (data.bets) {
        setBets(data.bets);
        const myBet = data.bets.find((b: any) => b.userId === user.id);
        if (myBet) {
          if (data.state === 'crashed') {
            setHasBet(false);
          } else {
            setHasBet(true);
          }
          setIsCashedOut(myBet.cashedOut);
          if (myBet.cashedOut) {
            setPayout(myBet.payout);
          }
        } else {
          setHasBet(false);
          setIsCashedOut(false);
          setPayout(0);
        }
      }
    });

    socket.on('crash:tick', (data: { multiplier: number, x?: number }) => {
      setMultiplier(data.multiplier);
      setGameState('running');
      
      // Update graph points
      setGraphPoints(prev => {
        const x = data.x ?? (prev.length * 0.1);
        
        // If we have no points, start from 1.0 at x=0.
        if (prev.length === 0) {
          return [{ x: 0, y: 1.0 }, { x, y: data.multiplier }];
        }
        
        // Prevent duplicate points for the same x
        if (prev[prev.length - 1].x === x) {
          const newPoints = [...prev];
          newPoints[newPoints.length - 1] = { x, y: data.multiplier };
          return newPoints;
        }
        
        return [...prev, { x, y: data.multiplier }];
      });

      // Server handles auto cashout now for better precision
    });

    socket.on('crash:start', () => {
      setGameState('running');
      setMultiplier(1.0);
      setPayout(0);
      setGraphPoints([{ x: 0, y: 1.0 }]);
    });

    socket.on('crash:crashed', (data) => {
      setGameState('crashed');
      setMultiplier(data.multiplier);
      setHistory(data.history);

      const { mode: currentMode, isAutoRunning: currentIsAutoRunning, hasBet: currentHasBet, isCashedOut: currentIsCashedOut, autoSettings: currentAutoSettings, baseBetAmount: currentBaseBetAmount } = stateRef.current;

      // Track net loss for crashed bets
      if (currentHasBet && !currentIsCashedOut) {
        setSessionNet(prev => prev - parseFloat(stateRef.current.betAmount));
      }

      // Handle Auto Loss
      if (currentMode === 'auto' && currentIsAutoRunning && currentHasBet && !currentIsCashedOut) {
        if (currentAutoSettings.onLoss.action === 'increase') {
          const increase = parseFloat(currentAutoSettings.onLoss.value) / 100;
          // Apply increase to the Base Bet Amount, not the current bet amount
          setBetAmount(prev => (parseFloat(prev) + (parseFloat(currentBaseBetAmount) * increase)).toFixed(2));
        } else {
          setBetAmount(currentBaseBetAmount);
        }
        setGamesPlayed(prev => prev + 1);
      }
      
      // Reset for next round
      setHasBet(false);
    });

    socket.on('crash:waiting', (data) => {
      const { 
        mode: currentMode, 
        isAutoRunning: currentIsAutoRunning, 
        hasBet: currentHasBet, 
        autoSettings: currentAutoSettings, 
        startCredits: currentStartCredits, 
        gamesPlayed: currentGamesPlayed, 
        credits: currentCredits, 
        betAmount: currentBetAmount,
        autoCashout: currentAutoCashout,
        gameState: currentGameState
      } = stateRef.current;

      if (currentGameState !== 'waiting') {
        setGameState('waiting');
        setGraphPoints([]);
        setHasBet(false);
        setIsCashedOut(false);
        setPayout(0);
      }
      
      setTimeLeft(data.timeLeft);
      
      // Auto bet logic
      if (currentMode === 'auto' && currentIsAutoRunning && !currentHasBet && currentGameState !== 'waiting') {
        // Check stop conditions using fresh creditsRef
        const latestCredits = creditsRef.current;
        const currentNet = latestCredits - currentStartCredits;
        const stopGain = parseFloat(currentAutoSettings.stopOnNetGain);
        const stopLoss = parseFloat(currentAutoSettings.stopOnNetLoss);
        const maxGames = parseInt(currentAutoSettings.numGames);

        console.log('Auto-bet check:', { currentNet, stopGain, stopLoss, latestCredits, currentStartCredits });

        if (stopGain > 0 && currentNet >= stopGain) {
          console.log('Stopping on net gain');
          setIsAutoRunning(false);
          return;
        }
        if (stopLoss > 0 && currentNet <= -stopLoss) {
          console.log('Stopping on net loss');
          setIsAutoRunning(false);
          return;
        }
        if (maxGames > 0 && currentGamesPlayed >= maxGames) {
          console.log('Stopping on max games');
          setIsAutoRunning(false);
          return;
        }

        const amount = parseFloat(currentBetAmount);
        if (!isNaN(amount) && amount > 0 && amount <= latestCredits) {
          socket.emit('crash:bet', { 
            betAmount: amount, 
            autoCashout: currentAutoCashout ? parseFloat(currentAutoCashout) : 0 
          });
          setHasBet(true);
        } else {
          setIsAutoRunning(false);
        }
      }
    });

    socket.on('crash:bets_update', (updatedBets) => {
      setBets(updatedBets);
      const myBet = updatedBets.find((b: any) => b.userId === user.id);
      if (myBet) {
        setHasBet(true);
        setIsCashedOut(myBet.cashedOut);
        if (myBet.cashedOut) {
          setPayout(myBet.payout);
        }
      } else {
        setHasBet(false);
        setIsCashedOut(false);
        setPayout(0);
      }
    });

    socket.on('error', (msg: string) => {
      console.error("Socket error:", msg);
      setBets(currentBets => {
        const myBet = currentBets.find((b: any) => b.userId === user.id);
        if (!myBet) {
          setHasBet(false);
          if (stateRef.current.isAutoRunning) {
            setIsAutoRunning(false);
          }
        }
        return currentBets;
      });
    });

    socket.on('crash:cashout_success', (data) => {
      setIsCashedOut(true);
      setPayout(data.payout);
      setSessionNet(prev => prev + data.payout - parseFloat(stateRef.current.betAmount));

      const { mode: currentMode, isAutoRunning: currentIsAutoRunning, autoSettings: currentAutoSettings, baseBetAmount: currentBaseBetAmount } = stateRef.current;

      // Handle Auto Win
      if (currentMode === 'auto' && currentIsAutoRunning) {
        if (currentAutoSettings.onWin.action === 'increase') {
          const increase = parseFloat(currentAutoSettings.onWin.value) / 100;
          // Apply increase to the Base Bet Amount, not the current bet amount
          setBetAmount(prev => (parseFloat(prev) + (parseFloat(currentBaseBetAmount) * increase)).toFixed(2));
        } else {
          setBetAmount(currentBaseBetAmount);
        }
        setGamesPlayed(prev => prev + 1);
      }
      
      if (data.multiplier >= 2.0) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#2181e2', '#22c55e', '#facc15']
        });
      }
    });

    return () => {
      socket.off('crash:sync');
      socket.off('crash:tick');
      socket.off('crash:start');
      socket.off('crash:crashed');
      socket.off('crash:waiting');
      socket.off('crash:bets_update');
      socket.off('crash:cashout_success');
      socket.off('user_data', handleUserData);
    };
  }, [socket]);

  const handleCancelBet = () => {
    if (!socket || gameState !== 'waiting' || !hasBet) return;
    socket.emit('crash:cancel_bet');
    setHasBet(false);
  };

  const handlePlaceBet = () => {
    if (!socket || gameState !== 'waiting' || hasBet) return;
    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount < 0.01 || amount > user.credits) return;

    if (mode === 'auto' && !isAutoRunning) {
      setIsAutoRunning(true);
      setGamesPlayed(0);
      setStartCredits(user.credits);
      setBaseBetAmount(betAmount);
    }

    socket.emit('crash:bet', { 
      betAmount: amount, 
      autoCashout: autoCashout ? parseFloat(autoCashout) : 0 
    });
    setHasBet(true);
  };

  const handleStopAuto = () => {
    setIsAutoRunning(false);
  };

  const handleCashout = () => {
    if (!socket || gameState !== 'running' || !hasBet || isCashedOut) return;
    socket.emit('crash:cashout');
  };

  const totalBet = bets.reduce((acc, bet) => acc + bet.betAmount, 0);

  // Graph dimensions
  const padding = 60;
  const maxX = Math.max(10, (graphPoints[graphPoints.length - 1]?.x || 0) + 2);
  const maxY = Math.max(2, multiplier + 0.5);

  const getX = (x: number, width: number) => padding + (x / maxX) * (width - padding * 2);
  const getY = (y: number, height: number) => height - padding - ((y - 1) / (maxY - 1)) * (height - padding * 2);

  const yAxisValues = [1.0, 1.2, 1.3, 1.5, 1.7, 1.8].map(v => {
    if (multiplier > 1.8) {
      return v * (multiplier / 1.8);
    }
    return v;
  });

  return (
    <div className="flex-1 flex flex-col lg:flex-row bg-[#0f1923] overflow-y-auto lg:overflow-hidden font-sans">
      {/* Left Sidebar Controls */}
      <div className="w-full lg:w-[300px] bg-[#1a242d] p-4 flex flex-col gap-4 border-r border-white/5 shrink-0 order-2 lg:order-1 lg:overflow-y-auto custom-scrollbar">
        {/* Mode Tabs */}
        <div className="flex p-1 bg-[#0f1923] rounded-xl h-12 order-2 lg:order-none">
          <button 
            onClick={() => setMode('manual')}
            className={cn(
              "flex-1 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all",
              mode === 'manual' ? "bg-[#2a353e] text-white shadow-lg" : "text-white/40 hover:text-white/60"
            )}
          >
            Manual
          </button>
          <button 
            onClick={() => setMode('auto')}
            className={cn(
              "flex-1 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all",
              mode === 'auto' ? "bg-[#2a353e] text-white shadow-lg" : "text-white/40 hover:text-white/60"
            )}
          >
            Auto
          </button>
        </div>

        {/* Amount Input */}
        <div className="space-y-1.5 order-3 lg:order-none">
          <label className="text-[10px] font-black text-white/40 uppercase tracking-widest px-1">Amount</label>
          <div className="flex gap-0.5">
            <div className="relative flex-1">
              <input 
                type="number"
                value={betAmount}
                onChange={(e) => {
                  setBetAmount(e.target.value);
                  if (!isAutoRunning) setBaseBetAmount(e.target.value);
                }}
                className="w-full h-10 bg-[#0f1923] border border-white/5 rounded-l-lg pl-3 pr-8 text-xs font-mono text-white focus:outline-none focus:border-blue-500/30 transition-colors"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center text-[8px] font-black text-black">G</div>
            </div>
            <button 
              onClick={() => {
                const newAmount = (parseFloat(betAmount) / 2).toFixed(2);
                setBetAmount(newAmount);
                if (!isAutoRunning) setBaseBetAmount(newAmount);
              }}
              className="w-10 h-10 bg-[#2a353e] hover:bg-[#36414b] text-white/60 text-[10px] font-bold transition-colors border-l border-white/5"
            >
              ½
            </button>
            <button 
              onClick={() => {
                const newAmount = (parseFloat(betAmount) * 2).toFixed(2);
                setBetAmount(newAmount);
                if (!isAutoRunning) setBaseBetAmount(newAmount);
              }}
              className="w-10 h-10 bg-[#2a353e] hover:bg-[#36414b] text-white/60 text-[10px] font-bold rounded-r-lg transition-colors border-l border-white/5"
            >
              2x
            </button>
          </div>
        </div>

        {/* Cashout At Input */}
        <div className="space-y-1.5 order-4 lg:order-none">
          <label className="text-[10px] font-black text-white/40 uppercase tracking-widest px-1">Cashout At</label>
          <div className="flex gap-0.5">
            <input 
              type="number"
              step="0.01"
              value={autoCashout}
              onChange={(e) => setAutoCashout(e.target.value)}
              className="flex-1 h-10 bg-[#0f1923] border border-white/5 rounded-l-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-blue-500/30 transition-colors"
            />
            <div className="flex">
              <button 
                className="w-10 h-10 bg-[#2a353e] hover:bg-[#36414b] text-white/60 flex items-center justify-center border-l border-white/5"
              >
                <TrendingUp className="w-3 h-3 rotate-180 opacity-40" />
              </button>
              <div className="w-[1px] h-6 bg-white/5 self-center" />
              <div className="flex flex-col">
                <button 
                  onClick={() => setAutoCashout(prev => (parseFloat(prev || '1.90') + 0.1).toFixed(2))}
                  className="w-10 h-5 bg-[#2a353e] hover:bg-[#36414b] text-white/60 flex items-center justify-center rounded-tr-lg border-l border-white/5"
                >
                  <TrendingUp className="w-2 h-2 rotate-180" />
                </button>
                <button 
                  onClick={() => setAutoCashout(prev => Math.max(1.01, parseFloat(prev || '2.10') - 0.1).toFixed(2))}
                  className="w-10 h-5 bg-[#2a353e] hover:bg-[#36414b] text-white/60 flex items-center justify-center rounded-br-lg border-l border-white/5 border-t border-white/5"
                >
                  <TrendingUp className="w-2 h-2" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {mode === 'auto' && (
          <div className="flex flex-col gap-4 order-5 lg:order-none">
            {/* Number of Games */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-white/40 uppercase tracking-widest px-1">Number of Games (0 = ∞)</label>
              <input 
                type="number"
                value={autoSettings.numGames}
                onChange={(e) => setAutoSettings(prev => ({ ...prev, numGames: e.target.value }))}
                className="w-full h-10 bg-[#0f1923] border border-white/5 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-blue-500/30 transition-colors"
              />
            </div>

            {/* Net Gain on Win (Field) */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-white/40 uppercase tracking-widest px-1">Net Gain on Win</label>
              <div className="relative">
                <input 
                  type="number"
                  value={autoCashout ? (parseFloat(betAmount) * (parseFloat(autoCashout) - 1)).toFixed(2) : ''}
                  onChange={(e) => {
                    const gain = parseFloat(e.target.value);
                    const amount = parseFloat(betAmount);
                    if (!isNaN(gain) && !isNaN(amount) && amount > 0) {
                      setAutoCashout((1 + gain / amount).toFixed(2));
                    }
                  }}
                  className="w-full h-10 bg-[#0f1923] border border-white/5 rounded-lg pl-3 pr-8 text-xs font-mono text-white focus:outline-none focus:border-blue-500/30 transition-colors"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center text-[8px] font-black text-black">G</div>
              </div>
            </div>

            {/* Advanced Toggle */}
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Advanced</span>
              <button 
                onClick={() => setAutoSettings(prev => ({ ...prev, advanced: !prev.advanced }))}
                className={cn(
                  "w-8 h-4 rounded-full transition-all relative",
                  autoSettings.advanced ? "bg-blue-500" : "bg-[#2a353e]"
                )}
              >
                <div className={cn(
                  "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all",
                  autoSettings.advanced ? "left-4.5" : "left-0.5"
                )} />
              </button>
            </div>

            {autoSettings.advanced && (
              <div className="space-y-4 pt-2 border-t border-white/5">
                {/* On Win */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-white/40 uppercase tracking-widest px-1">On Win</label>
                  <div className="flex gap-1">
                    <button 
                      onClick={() => setAutoSettings(prev => ({ ...prev, onWin: { ...prev.onWin, action: 'reset' } }))}
                      className={cn(
                        "flex-1 h-8 rounded-lg text-[9px] font-black uppercase transition-all",
                        autoSettings.onWin.action === 'reset' ? "bg-blue-500 text-white" : "bg-[#2a353e] text-white/40"
                      )}
                    >
                      Reset
                    </button>
                    <button 
                      onClick={() => setAutoSettings(prev => ({ ...prev, onWin: { ...prev.onWin, action: 'increase' } }))}
                      className={cn(
                        "flex-1 h-8 rounded-lg text-[9px] font-black uppercase transition-all",
                        autoSettings.onWin.action === 'increase' ? "bg-blue-500 text-white" : "bg-[#2a353e] text-white/40"
                      )}
                    >
                      Increase by
                    </button>
                  </div>
                  {autoSettings.onWin.action === 'increase' && (
                    <div className="relative">
                      <input 
                        type="number"
                        value={autoSettings.onWin.value}
                        onChange={(e) => setAutoSettings(prev => ({ ...prev, onWin: { ...prev.onWin, value: e.target.value } }))}
                        className="w-full h-8 bg-[#0f1923] border border-white/5 rounded-lg px-3 text-[10px] font-mono text-white focus:outline-none"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-white/20">%</span>
                    </div>
                  )}
                </div>

                {/* On Loss */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-white/40 uppercase tracking-widest px-1">On Loss</label>
                  <div className="flex gap-1">
                    <button 
                      onClick={() => setAutoSettings(prev => ({ ...prev, onLoss: { ...prev.onLoss, action: 'reset' } }))}
                      className={cn(
                        "flex-1 h-8 rounded-lg text-[9px] font-black uppercase transition-all",
                        autoSettings.onLoss.action === 'reset' ? "bg-blue-500 text-white" : "bg-[#2a353e] text-white/40"
                      )}
                    >
                      Reset
                    </button>
                    <button 
                      onClick={() => setAutoSettings(prev => ({ ...prev, onLoss: { ...prev.onLoss, action: 'increase' } }))}
                      className={cn(
                        "flex-1 h-8 rounded-lg text-[9px] font-black uppercase transition-all",
                        autoSettings.onLoss.action === 'increase' ? "bg-blue-500 text-white" : "bg-[#2a353e] text-white/40"
                      )}
                    >
                      Increase by
                    </button>
                  </div>
                  {autoSettings.onLoss.action === 'increase' && (
                    <div className="relative">
                      <input 
                        type="number"
                        value={autoSettings.onLoss.value}
                        onChange={(e) => setAutoSettings(prev => ({ ...prev, onLoss: { ...prev.onLoss, value: e.target.value } }))}
                        className="w-full h-8 bg-[#0f1923] border border-white/5 rounded-lg px-3 text-[10px] font-mono text-white focus:outline-none"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-white/20">%</span>
                    </div>
                  )}
                </div>

                {/* Stop Conditions */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-white/40 uppercase tracking-widest px-1">Stop on Gain</label>
                    <input 
                      type="number"
                      value={autoSettings.stopOnNetGain}
                      onChange={(e) => setAutoSettings(prev => ({ ...prev, stopOnNetGain: e.target.value }))}
                      className="w-full h-8 bg-[#0f1923] border border-white/5 rounded-lg px-2 text-[10px] font-mono text-white focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-white/40 uppercase tracking-widest px-1">Stop on Loss</label>
                    <input 
                      type="number"
                      value={autoSettings.stopOnNetLoss}
                      onChange={(e) => setAutoSettings(prev => ({ ...prev, stopOnNetLoss: e.target.value }))}
                      className="w-full h-8 bg-[#0f1923] border border-white/5 rounded-lg px-2 text-[10px] font-mono text-white focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Play Button */}
        <button 
          onClick={() => {
            if (gameState === 'running' && hasBet && !isCashedOut) {
              handleCashout();
            } else if (mode === 'auto' && isAutoRunning) {
              handleStopAuto();
            } else if (gameState === 'waiting' && hasBet) {
              handleCancelBet();
            } else {
              handlePlaceBet();
            }
          }}
          disabled={(gameState !== 'waiting' && !(gameState === 'running' && hasBet && !isCashedOut) && !(mode === 'auto' && isAutoRunning))}
          className={cn(
            "w-full h-12 rounded-lg font-black uppercase tracking-widest transition-all shadow-lg active:scale-[0.98] text-xs order-1 lg:order-none lg:mt-auto",
            gameState === 'running' && hasBet && !isCashedOut 
              ? "bg-[#22c55e] hover:bg-[#16a34a] text-white" 
              : mode === 'auto' && isAutoRunning
                ? "bg-[#f43f5e] hover:bg-[#e11d48] text-white"
                : gameState === 'waiting' && hasBet
                  ? "bg-[#f43f5e] hover:bg-[#e11d48] text-white"
                  : "bg-[#2181e2] hover:bg-[#1a6ec2] text-white disabled:bg-white/5 disabled:text-white/20"
          )}
        >
          {gameState === 'running' && hasBet && !isCashedOut ? (
            <div className="flex flex-col items-center">
              <span className="text-[8px] opacity-70">Cashout</span>
              <span className="text-sm">${Math.floor(parseFloat(betAmount) * multiplier).toLocaleString()}</span>
            </div>
          ) : (
            mode === 'auto' 
              ? (isAutoRunning 
                  ? 'Stop Auto' 
                  : (hasBet && gameState === 'waiting' ? 'Cancel Bet' : 'Run Auto')) 
              : (isCashedOut 
                  ? 'Cashed Out' 
                  : (hasBet ? 'Cancel Bet' : 'Play (Next Round)'))
          )}
        </button>

        {/* Stats */}
        <div className="mt-2 order-6 lg:order-none space-y-1.5">
          <div className="bg-[#0f1923] rounded-xl px-3 py-2 flex items-center justify-between border border-white/5">
            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Session Net</span>
            <span className={cn("text-sm font-mono font-black", sessionNet >= 0 ? "text-green-400" : "text-red-400")}>
              {sessionNet >= 0 ? '+' : ''}${sessionNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="bg-[#0f1923] rounded-xl p-3 flex items-center justify-between border border-white/5">
            <div className="flex items-center gap-2 text-white/40">
              <div className="w-5 h-5 bg-white/5 rounded-md flex items-center justify-center">
                <User className="w-3 h-3" />
              </div>
              <span className="text-[11px] font-black">{bets.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 bg-amber-500 rounded-full flex items-center justify-center text-[7px] font-black text-black">G</div>
              <span className="text-[11px] font-mono font-black text-white/60">{totalBet.toLocaleString()}</span>
              <div className="w-[1px] h-3 bg-white/10 mx-1" />
              <TrendingUp className="w-3 h-3 text-white/10 rotate-180" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="flex-1 flex flex-col min-h-[500px] lg:min-h-0 lg:overflow-hidden order-1 lg:order-2">
        {/* History Bar */}
        <div className="h-14 shrink-0 border-b border-white/5 flex items-center px-4 gap-1.5 overflow-x-auto no-scrollbar">
          {history.map((h, i) => (
            <div 
              key={i}
              className={cn(
                "px-3 py-1 rounded-full text-[10px] font-black font-mono whitespace-nowrap",
                h >= 2 ? "bg-[#22c55e] text-black" : "bg-[#2a353e] text-white/60"
              )}
            >
              {h.toFixed(2)}x
            </div>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest flex items-center gap-1">
              <TrendingUp className="w-3 h-3 rotate-180" /> You
            </span>
            <div className="p-1.5 bg-[#2a353e] rounded-lg text-white/40 hover:text-white transition-colors cursor-pointer">
              <History className="w-3.5 h-3.5" />
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col lg:flex-row lg:overflow-hidden">
          {/* Graph Area */}
          <div className="flex-1 relative min-h-[300px] lg:min-h-0 overflow-hidden bg-[#0f1923]" ref={graphRef}>
            {/* Multiplier Display */}
            <div className="absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-none">
              <AnimatePresence mode="wait">
                <motion.div
                  key={gameState === 'crashed' ? 'crashed' : 'running'}
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="flex flex-col items-center"
                >
                  <span className={cn(
                    "text-[80px] md:text-[120px] font-black font-mono tracking-tighter leading-none",
                    gameState === 'crashed' ? "text-[#f43f5e]" : "text-white"
                  )}>
                    {multiplier.toFixed(2)}x
                  </span>
                  {gameState === 'crashed' && (
                    <div className="mt-2 px-6 py-2 bg-[#2a353e] rounded-lg border border-white/5 shadow-2xl">
                      <span className="text-xl font-black text-white uppercase tracking-widest">Crashed</span>
                    </div>
                  )}
                  {gameState === 'waiting' && (
                    <div className="mt-4 flex flex-col items-center gap-1">
                      <p className="text-blue-500 font-black uppercase tracking-[0.2em] text-[10px]">Starting in</p>
                      <span className="text-3xl font-mono font-black text-white">{timeLeft}s</span>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* SVG Graph */}
            <svg className="w-full h-full">
              {/* Grid Lines */}
              <g className="opacity-[0.02]">
                {[...Array(10)].map((_, i) => (
                  <line 
                    key={`v-${i}`}
                    x1={padding + (i / 9) * (graphRef.current?.clientWidth || 0 - padding * 2)}
                    y1={padding}
                    x2={padding + (i / 9) * (graphRef.current?.clientWidth || 0 - padding * 2)}
                    y2={(graphRef.current?.clientHeight || 0) - padding}
                    stroke="white"
                    strokeWidth="1"
                  />
                ))}
                {[...Array(10)].map((_, i) => (
                  <line 
                    key={`h-${i}`}
                    x1={padding}
                    y1={padding + (i / 9) * (graphRef.current?.clientHeight || 0 - padding * 2)}
                    x2={(graphRef.current?.clientWidth || 0) - padding}
                    y2={padding + (i / 9) * (graphRef.current?.clientHeight || 0 - padding * 2)}
                    stroke="white"
                    strokeWidth="1"
                  />
                ))}
              </g>

              {/* Axes Labels */}
              <g className="text-[10px] font-black fill-white/20 uppercase">
                {yAxisValues.map((val, i) => (
                  <g key={`y-group-${i}`}>
                    <rect 
                      x={padding - 50}
                      y={getY(val, graphRef.current?.clientHeight || 0) - 10}
                      width="40"
                      height="20"
                      rx="4"
                      fill="#1a242d"
                    />
                    <text 
                      x={padding - 30}
                      y={getY(val, graphRef.current?.clientHeight || 0)}
                      textAnchor="middle"
                      alignmentBaseline="middle"
                    >
                      {val.toFixed(1)}x
                    </text>
                  </g>
                ))}
                {[2, 4, 6, 8].map((val, i) => (
                  <text 
                    key={`x-${i}`}
                    x={getX(val, graphRef.current?.clientWidth || 0)}
                    y={(graphRef.current?.clientHeight || 0) - padding + 25}
                    textAnchor="middle"
                  >
                    {val}s
                  </text>
                ))}
                <text 
                  x={(graphRef.current?.clientWidth || 0) - padding}
                  y={(graphRef.current?.clientHeight || 0) - padding + 25}
                  textAnchor="end"
                >
                  Total {(graphPoints.length * 0.1).toFixed(0)}s
                </text>
              </g>

              {/* Graph Path */}
              {graphPoints.length > 1 && (
                <>
                  {/* Area Fill */}
                  <path 
                    d={`
                      M ${getX(graphPoints[0].x, graphRef.current?.clientWidth || 0)} ${(graphRef.current?.clientHeight || 0) - padding}
                      ${graphPoints.map(p => `L ${getX(p.x, graphRef.current?.clientWidth || 0)} ${getY(p.y, graphRef.current?.clientHeight || 0)}`).join(' ')}
                      L ${getX(graphPoints[graphPoints.length - 1].x, graphRef.current?.clientWidth || 0)} ${(graphRef.current?.clientHeight || 0) - padding}
                      Z
                    `}
                    fill="url(#graphGradient)"
                    className="transition-all duration-100"
                  />
                  {/* Line */}
                  <path 
                    d={`M ${graphPoints.map(p => `${getX(p.x, graphRef.current?.clientWidth || 0)} ${getY(p.y, graphRef.current?.clientHeight || 0)}`).join(' L ')}`}
                    fill="none"
                    stroke={gameState === 'crashed' ? '#f43f5e' : '#3b82f6'}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-all duration-100"
                    style={{ filter: 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.5))' }}
                  />
                  {/* End Point Glow */}
                  {gameState === 'running' && (
                    <circle 
                      cx={getX(graphPoints[graphPoints.length - 1].x, graphRef.current?.clientWidth || 0)}
                      cy={getY(graphPoints[graphPoints.length - 1].y, graphRef.current?.clientHeight || 0)}
                      r="4"
                      fill="#3b82f6"
                      className="animate-pulse"
                    />
                  )}
                </>
              )}

              <defs>
                <linearGradient id="graphGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* Right Sidebar: Bets List */}
          <div className="w-full lg:w-64 bg-[#1a242d] border-l border-white/5 flex flex-col min-h-[250px] lg:min-h-0 lg:overflow-hidden">
            <div className="p-4 border-b border-white/5 flex items-center justify-between shrink-0">
              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Live Bets</span>
              <span className="px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded text-[9px] font-black">{bets.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-1">
              {bets.sort((a, b) => b.betAmount - a.betAmount).map((bet, i) => (
                <div 
                  key={i} 
                  className={cn(
                    "flex items-center justify-between p-2 rounded-lg transition-all",
                    bet.cashedOut ? "bg-green-500/5 border border-green-500/10" : "bg-white/5 border border-transparent"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center text-[10px] font-black text-white/40">
                      {bet.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-white truncate w-20">{bet.username}</span>
                      {bet.cashedOut && (
                        <span className="text-[8px] font-black text-green-500">{(bet.payout / bet.betAmount).toFixed(2)}x</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] font-mono font-black text-white/60">${bet.betAmount.toLocaleString()}</span>
                    {bet.cashedOut && (
                      <span className="text-[10px] font-mono font-black text-green-500">+${(bet.payout - bet.betAmount).toLocaleString()}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
