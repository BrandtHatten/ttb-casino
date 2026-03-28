import React, { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { CASE_ITEMS } from '../lib/caseItems';
import { cn } from '../lib/utils';
import { motion } from 'framer-motion';

interface CaseOpeningProps {
  socket: Socket | null;
  user: any;
  updateCredits: (newCredits: number) => void;
}

export const CaseOpening: React.FC<CaseOpeningProps> = ({ socket, user, updateCredits }) => {
  const randomItem = () => CASE_ITEMS[Math.floor(Math.random() * CASE_ITEMS.length)];

  const [betAmount, setBetAmount] = useState('10');
  const [caseCount, setCaseCount] = useState(1);
  const [isOpening, setIsOpening] = useState(false);
  const [strips, setStrips] = useState<any[][]>(() =>
    Array.from({ length: 1 }, () => Array.from({ length: 60 }, () => randomItem()))
  );
  const [results, setResults] = useState<any[] | null>(null);
  const [totalWinnings, setTotalWinnings] = useState(0);
  const stripRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Turbo mode
  const [turboMode, setTurboMode] = useState(false);
  const turboModeRef = useRef(false);
  useEffect(() => { turboModeRef.current = turboMode; }, [turboMode]);

  // Auto-bet state
  const [sessionNet, setSessionNet] = useState(0);
  const [autobetEnabled, setAutobetEnabled] = useState(false);
  const [autobetRounds, setAutobetRounds] = useState('0'); // 0 = infinite
  const [autobetStopProfit, setAutobetStopProfit] = useState('');
  const [autobetStopLoss, setAutobetStopLoss] = useState('');
  const [autobetCompleted, setAutobetCompleted] = useState(0);
  const [autobetNet, setAutobetNet] = useState(0);

  // Refs to avoid stale closures inside handleResult callback
  const autobetRef = useRef({ active: false, completed: 0, net: 0 });
  const betAmountRef = useRef(parseFloat(betAmount) || 10);
  const caseCountRef = useRef(caseCount);
  const creditsRef = useRef(user?.credits ?? 0);
  const autobetRoundsRef = useRef(parseInt(autobetRounds) || 0);
  const autobetStopProfitRef = useRef(parseFloat(autobetStopProfit) || 0);
  const autobetStopLossRef = useRef(parseFloat(autobetStopLoss) || 0);

  useEffect(() => { betAmountRef.current = parseFloat(betAmount) || 10; }, [betAmount]);
  useEffect(() => { caseCountRef.current = caseCount; }, [caseCount]);
  useEffect(() => { creditsRef.current = user?.credits ?? 0; }, [user?.credits]);
  useEffect(() => { autobetRoundsRef.current = parseInt(autobetRounds) || 0; }, [autobetRounds]);
  useEffect(() => { autobetStopProfitRef.current = parseFloat(autobetStopProfit) || 0; }, [autobetStopProfit]);
  useEffect(() => { autobetStopLossRef.current = parseFloat(autobetStopLoss) || 0; }, [autobetStopLoss]);

  const stopAutobet = () => {
    autobetRef.current.active = false;
    setAutobetEnabled(false);
  };

  const startNextRound = (socketRef: Socket, currentCredits: number) => {
    const amount = betAmountRef.current;
    const count = caseCountRef.current;
    const totalBet = amount * count;

    if (currentCredits < totalBet) {
      autobetRef.current.active = false;
      setAutobetEnabled(false);
      return;
    }

    setIsOpening(true);
    setResults(null);
    setTotalWinnings(0);
    updateCredits(currentCredits - totalBet);
    creditsRef.current = currentCredits - totalBet;

    const newStrips = Array.from({ length: count }, () =>
      Array.from({ length: 60 }, () => randomItem())
    );
    setStrips(newStrips);
    stripRefs.current.forEach(ref => {
      if (ref) { ref.style.transition = 'none'; ref.style.transform = 'translateX(0)'; }
    });
    socketRef.emit('case:open', { betAmount: amount, count });
  };

  const handleOpen = () => {
    if (!socket || isOpening) return;
    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount < 0.01) return;
    const totalBet = amount * caseCount;
    if (user.credits < totalBet) return;

    setIsOpening(true);
    setResults(null);
    setTotalWinnings(0);
    updateCredits(user.credits - totalBet);
    creditsRef.current = user.credits - totalBet;

    const initialStrips = Array.from({ length: caseCount }, () =>
      Array.from({ length: 60 }, () => randomItem())
    );
    setStrips(initialStrips);

    stripRefs.current.forEach(ref => {
      if (ref) { ref.style.transition = 'none'; ref.style.transform = 'translateX(0)'; }
    });

    // If autobet was just clicked, initialize session
    if (autobetEnabled) {
      autobetRef.current = { active: true, completed: 0, net: 0 };
      setAutobetCompleted(0);
      setAutobetNet(0);
    }

    socket.emit('case:open', { betAmount: amount, count: caseCount });
  };

  useEffect(() => {
    if (!socket) return;

    const handleResult = (data: any) => {
      const turbo = turboModeRef.current;
      const animDuration = turbo ? 0.4 : 5;
      const resultDelay = turbo ? 500 : 5300;
      const nextRoundDelay = turbo ? 100 : 600;

      const newStrips = data.results.map((result: any) => {
        const strip = Array.from({ length: 60 }, () => randomItem());
        strip[52] = result.item;
        return strip;
      });

      setStrips(newStrips);

      requestAnimationFrame(() => {
        stripRefs.current.forEach(ref => {
          if (ref) { ref.style.transition = 'none'; ref.style.transform = 'translateX(0)'; }
        });

        requestAnimationFrame(() => {
          stripRefs.current.forEach(ref => {
            if (ref) {
              ref.style.transition = `transform ${animDuration}s cubic-bezier(0.25, 0.1, 0.1, 1)`;
              const isMobile = window.innerWidth < 768;
              const itemWidth = isMobile ? 78 : 108;
              const halfWidth = isMobile ? 35 : 50;
              const randomOffset = turbo ? 0 : (Math.random() - 0.5) * (isMobile ? 50 : 80);
              ref.style.transform = `translateX(calc(-${52 * itemWidth + halfWidth}px + ${randomOffset}px))`;
            }
          });

          setTimeout(() => {
            setResults(data.results);
            setTotalWinnings(Math.round(data.totalWinnings * 100) / 100);
            setSessionNet(prev => Math.round((prev + data.totalWinnings - betAmountRef.current * caseCountRef.current) * 100) / 100);
            updateCredits(data.newCredits);
            creditsRef.current = data.newCredits;
            setIsOpening(false);
            socket.emit('activity:reveal');

            // Auto-bet logic
            const ab = autobetRef.current;
            if (ab.active) {
              const roundBet = betAmountRef.current * caseCountRef.current;
              const roundNet = data.totalWinnings - roundBet;
              ab.completed += 1;
              ab.net += roundNet;
              setAutobetCompleted(ab.completed);
              setAutobetNet(Math.round(ab.net * 100) / 100);

              const maxRounds = autobetRoundsRef.current;
              const stopProfit = autobetStopProfitRef.current;
              const stopLoss = autobetStopLossRef.current;

              const hitRoundLimit = maxRounds > 0 && ab.completed >= maxRounds;
              const hitProfitStop = stopProfit > 0 && ab.net >= stopProfit;
              const hitLossStop = stopLoss > 0 && ab.net <= -stopLoss;

              if (hitRoundLimit || hitProfitStop || hitLossStop) {
                ab.active = false;
                setAutobetEnabled(false);
              } else {
                setTimeout(() => {
                  if (!autobetRef.current.active) return;
                  startNextRound(socket, creditsRef.current);
                }, nextRoundDelay);
              }
            }
          }, resultDelay);
        });
      });
    };

    socket.on('case:result', handleResult);
    return () => { socket.off('case:result', handleResult); };
  }, [socket, updateCredits]);

  const totalBet = (parseFloat(betAmount) || 0) * caseCount;
  const canOpen = !isOpening && (parseFloat(betAmount) >= 0.01) && user.credits >= totalBet;

  return (
    <div className="flex-1 flex flex-col bg-[#0f1923] overflow-y-auto font-sans">
      <div className="p-4 md:p-8 flex flex-col items-center gap-4 md:gap-8 max-w-6xl mx-auto w-full">

        {/* Controls */}
        <div className="bg-[#1a242d] p-4 md:p-6 rounded-2xl border border-white/5 w-full max-w-2xl flex flex-col gap-4 md:gap-6 order-1">
          <div className="flex flex-col md:flex-row gap-4 md:gap-6">
            <div className="flex-1 space-y-2">
              <label className="text-xs font-black text-white/40 uppercase tracking-widest px-1">Bet Amount</label>
              <div className="flex bg-[#0f1923] rounded-lg border border-white/5 p-1">
                <input
                  type="number"
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  disabled={isOpening}
                  className="flex-1 bg-transparent px-3 text-sm font-mono text-white focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={() => setBetAmount((parseFloat(betAmount) / 2).toFixed(2))}
                  disabled={isOpening}
                  className="px-3 py-2 text-xs font-bold text-white/60 hover:text-white hover:bg-white/5 rounded transition-colors disabled:opacity-50"
                >
                  1/2
                </button>
                <button
                  onClick={() => setBetAmount((parseFloat(betAmount) * 2).toFixed(2))}
                  disabled={isOpening}
                  className="px-3 py-2 text-xs font-bold text-white/60 hover:text-white hover:bg-white/5 rounded transition-colors disabled:opacity-50"
                >
                  2x
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-2">
              <label className="text-xs font-black text-white/40 uppercase tracking-widest px-1">Cases</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(num => (
                  <button
                    key={num}
                    onClick={() => {
                      if (isOpening) return;
                      setCaseCount(num);
                      setStrips(Array.from({ length: num }, () =>
                        Array.from({ length: 60 }, () => randomItem())
                      ));
                      setResults(null);
                      setTotalWinnings(0);
                      stripRefs.current.forEach(ref => {
                        if (ref) { ref.style.transition = 'none'; ref.style.transform = 'translateX(0)'; }
                      });
                    }}
                    disabled={isOpening}
                    className={cn(
                      "flex-1 h-12 rounded-lg font-black text-sm transition-all disabled:opacity-50",
                      caseCount === num
                        ? "bg-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]"
                        : "bg-[#0f1923] text-white/60 hover:bg-white/5 border border-white/5"
                    )}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Open / Stop button */}
          {autobetRef.current.active ? (
            <button
              onClick={stopAutobet}
              className="w-full h-14 bg-red-500 hover:bg-red-400 text-white rounded-xl font-black uppercase tracking-widest text-lg transition-all shadow-[0_0_20px_rgba(239,68,68,0.3)]"
            >
              Stop Auto Bet
            </button>
          ) : (
            <button
              onClick={handleOpen}
              disabled={!canOpen}
              className={cn(
                "w-full h-14 text-white rounded-xl font-black uppercase tracking-widest text-lg transition-all disabled:bg-white/5 disabled:text-white/20 disabled:shadow-none",
                autobetEnabled
                  ? "bg-amber-500 hover:bg-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)]"
                  : "bg-green-500 hover:bg-green-400 shadow-[0_0_20px_rgba(34,197,94,0.3)] hover:shadow-[0_0_30px_rgba(34,197,94,0.5)]"
              )}
            >
              {isOpening ? 'Opening...' : autobetEnabled
                ? `Auto Bet — $${totalBet.toLocaleString()} per round`
                : `Open ${caseCount} Case${caseCount > 1 ? 's' : ''} for $${totalBet.toLocaleString()}`
              }
            </button>
          )}

          {/* Session Net */}
          <div className="bg-[#0f1923] rounded-xl px-3 py-2 flex items-center justify-between border border-white/5">
            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Session Net</span>
            <span className={cn("text-sm font-mono font-black", sessionNet >= 0 ? "text-green-400" : "text-red-400")}>
              {sessionNet >= 0 ? '+' : ''}${sessionNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {/* Turbo + Auto Bet toggles */}
          <div className="border-t border-white/5 pt-4 space-y-3">
            {/* Turbo Mode */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-white/40 uppercase tracking-widest">Turbo Mode</span>
                {turboMode && (
                  <span className="text-[9px] font-black uppercase tracking-widest text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 px-1.5 py-0.5 rounded-full">
                    ⚡ Fast
                  </span>
                )}
              </div>
              <button
                onClick={() => setTurboMode(t => !t)}
                className={cn(
                  "relative w-10 h-5 rounded-full transition-colors duration-200 overflow-hidden",
                  turboMode ? "bg-yellow-500" : "bg-white/10"
                )}
              >
                <span className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200",
                  turboMode ? "left-[22px]" : "left-0.5"
                )} />
              </button>
            </div>

            {/* Auto Bet */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-white/40 uppercase tracking-widest">Auto Bet</span>
              <button
                onClick={() => {
                  if (autobetRef.current.active) return;
                  const next = !autobetEnabled;
                  setAutobetEnabled(next);
                  if (!next) {
                    setAutobetCompleted(0);
                    setAutobetNet(0);
                    autobetRef.current = { active: false, completed: 0, net: 0 };
                  }
                }}
                disabled={autobetRef.current.active}
                className={cn(
                  "relative w-10 h-5 rounded-full transition-colors duration-200 disabled:opacity-60 overflow-hidden",
                  autobetEnabled ? "bg-amber-500" : "bg-white/10"
                )}
              >
                <span className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200",
                  autobetEnabled ? "left-[22px]" : "left-0.5"
                )} />
              </button>
            </div>

            {autobetEnabled && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">Rounds</label>
                    <input
                      type="number"
                      value={autobetRounds}
                      onChange={e => setAutobetRounds(e.target.value)}
                      disabled={autobetRef.current.active}
                      placeholder="∞"
                      min="0"
                      className="w-full bg-[#0f1923] border border-white/5 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-amber-500/50 disabled:opacity-50"
                    />
                    <div className="text-[9px] text-white/20 px-1">0 = infinite</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">Stop Profit</label>
                    <input
                      type="number"
                      value={autobetStopProfit}
                      onChange={e => setAutobetStopProfit(e.target.value)}
                      disabled={autobetRef.current.active}
                      placeholder="$0"
                      min="0"
                      className="w-full bg-[#0f1923] border border-white/5 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-green-500/50 disabled:opacity-50"
                    />
                    <div className="text-[9px] text-white/20 px-1">net profit</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">Stop Loss</label>
                    <input
                      type="number"
                      value={autobetStopLoss}
                      onChange={e => setAutobetStopLoss(e.target.value)}
                      disabled={autobetRef.current.active}
                      placeholder="$0"
                      min="0"
                      className="w-full bg-[#0f1923] border border-white/5 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-red-500/50 disabled:opacity-50"
                    />
                    <div className="text-[9px] text-white/20 px-1">net loss</div>
                  </div>
                </div>

                {/* Running stats */}
                {autobetRef.current.active && (
                  <div className="flex items-center justify-between bg-[#0f1923] rounded-lg px-4 py-2.5 border border-white/5">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Round</span>
                      <span className="text-sm font-black text-white font-mono">{autobetCompleted}</span>
                      {parseInt(autobetRounds) > 0 && <span className="text-xs text-white/30">/ {autobetRounds}</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Net</span>
                      <span className={cn("text-sm font-black font-mono", autobetNet >= 0 ? "text-green-400" : "text-red-400")}>
                        {autobetNet >= 0 ? '+' : ''}${autobetNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </div>

        {/* Total Winnings */}
        {results && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center order-3 md:order-2"
          >
            <div className="text-sm font-bold text-white/60 uppercase tracking-widest mb-1">Total Winnings</div>
            <div className={cn(
              "text-4xl font-black",
              totalWinnings > totalBet ? "text-green-500" : "text-white"
            )}>
              ${totalWinnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </motion.div>
        )}

        {/* Cases Display */}
        <div className="w-full flex flex-col gap-2 md:gap-4 order-2 md:order-3">
          {strips.map((strip, i) => (
            <div key={i} className="relative w-full h-20 md:h-32 bg-[#1a242d] rounded-xl overflow-hidden border border-white/5 shadow-inner">
              <div className="absolute left-1/2 top-0 bottom-0 w-1 bg-amber-500 z-10 -translate-x-1/2 shadow-[0_0_10px_rgba(245,158,11,0.5)]" />

              <div
                ref={el => stripRefs.current[i] = el}
                className="absolute top-0 left-0 h-full flex items-center gap-2 px-[50%]"
                style={{ willChange: 'transform' }}
              >
                {strip.map((item, j) => (
                  <div
                    key={j}
                    className="w-[70px] h-16 md:w-[100px] md:h-24 shrink-0 rounded-lg flex flex-col items-center justify-center gap-1 md:gap-2 border-b-2 md:border-b-4 bg-[#2a353e]"
                    style={{ borderColor: item.color }}
                  >
                    <span className="text-lg md:text-2xl font-black" style={{ color: item.color }}>{item.multiplier}x</span>
                    <span className="text-[8px] md:text-[10px] font-bold text-white/60 uppercase tracking-wider">{item.name}</span>
                  </div>
                ))}
              </div>

              {results && results[i] && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 bg-black/60 flex items-center justify-center z-20 backdrop-blur-sm"
                >
                  <div className="flex flex-col items-center gap-1 md:gap-2">
                    <span className="text-2xl md:text-4xl font-black" style={{ color: results[i].item.color, textShadow: `0 0 20px ${results[i].item.color}80` }}>
                      {results[i].item.multiplier}x
                    </span>
                    <span className="text-base md:text-xl font-bold text-white">${results[i].winAmount.toLocaleString()}</span>
                  </div>
                </motion.div>
              )}
            </div>
          ))}
        </div>

        {/* Drop Rates */}
        <div className="w-full max-w-2xl bg-[#1a242d] rounded-2xl border border-white/5 overflow-hidden order-4">
          <div className="p-4 border-b border-white/5 bg-white/[0.02]">
            <h3 className="text-sm font-black text-white/80 uppercase tracking-widest">Drop Rates</h3>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {CASE_ITEMS.map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-[#0f1923] border border-white/5">
                <span className="text-lg font-black" style={{ color: item.color }}>{item.multiplier}x</span>
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">{item.name}</span>
                <span className="text-xs font-mono text-white/60 mt-1">{item.weight}%</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};
