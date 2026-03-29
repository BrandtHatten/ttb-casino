import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Socket } from 'socket.io-client';
import { TrendingUp, Coins, Play, RotateCcw, Zap, AlertCircle, User, ChevronDown, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import confetti from 'canvas-confetti';

interface PlinkoGameProps {
  socket: Socket | null;
  user: any;
}

type RiskLevel = 'low' | 'medium' | 'high' | 'extreme';

interface Ball {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  row: number;
  column: number;
  path: number[]; // -1 for left, 1 for right
  targetSlot: number;
  color: string;
  betAmount: number;
  risk: RiskLevel;
  rows: number;
}

const MULTIPLIERS: Record<number, Record<RiskLevel, number[]>> = {
  8: {
    low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    extreme: [250, 20, 2, 0.2, 0.1, 0.2, 2, 20, 250]
  },
  10: {
    low: [8.9, 3, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 3, 8.9],
    medium: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
    high: [76, 10, 3, 1.4, 0.3, 0.2, 0.3, 1.4, 3, 10, 76],
    extreme: [500, 50, 5, 0.5, 0.1, 0.1, 0.1, 0.5, 5, 50, 500]
  },
  12: {
    low: [10, 5, 2, 1.6, 1.4, 1.1, 0.5, 1.1, 1.4, 1.6, 2, 5, 10],
    medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    extreme: [1000, 100, 10, 1, 0.2, 0.1, 0.1, 0.1, 0.2, 1, 10, 100, 1000]
  },
  14: {
    low: [15, 7, 3, 2, 1.5, 1.1, 1, 0.5, 1, 1.1, 1.5, 2, 3, 7, 15],
    medium: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
    high: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420],
    extreme: [2500, 250, 25, 2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 2, 25, 250, 2500]
  },
  16: {
    low: [16, 9, 4, 3, 2, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 2, 3, 4, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    high: [1000, 130, 26, 9, 4, 2, 0.3, 0.2, 0.2, 0.2, 0.3, 2, 4, 9, 26, 130, 1000],
    extreme: [5000, 500, 50, 5, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 5, 50, 500, 5000]
  }
};

export const PlinkoGame: React.FC<PlinkoGameProps> = ({ socket, user }) => {
  const [betAmount, setBetAmount] = useState('10');
  const [risk, setRisk] = useState<RiskLevel>('medium');
  const [rows, setRows] = useState(12);
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [balls, setBalls] = useState<Ball[]>([]);
  const [recentWins, setRecentWins] = useState<{multiplier: number, amount: number}[]>([]);
  const [sessionNet, setSessionNet] = useState(0);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballsRef = useRef<Ball[]>([]);
  const requestRef = useRef<number>();
  const lastAutoDropRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);

  const PEG_RADIUS = 3;
  const BALL_RADIUS = 5;
  const GRAVITY = 0.35;
  const BOUNCE = 0.45;
  const FRICTION = 0.98;
  const TARGET_FPS = 60;
  const TARGET_FRAME_MS = 1000 / TARGET_FPS;

  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 600;
  const PYRAMID_TOP = 60;
  const PYRAMID_BOTTOM = 480;
  const PYRAMID_HEIGHT = PYRAMID_BOTTOM - PYRAMID_TOP;

  const getSpacing = useCallback(() => {
    // We want the pyramid to fit in the same vertical space
    // Row 1 is removed, so we have (rows - 1) levels of pegs (from row 2 to rows)
    const spacingY = PYRAMID_HEIGHT / (rows - 1);
    const spacingX = spacingY * 1.15;
    return { spacingX, spacingY };
  }, [rows]);

  const getPegs = useCallback(() => {
    const pegs = [];
    const { spacingX, spacingY } = getSpacing();
    
    // Start from r=2 to remove the top-most peg (row 1 which has 1 peg)
    // Row r will have r pegs
    for (let r = 2; r <= rows; r++) {
      const rowY = PYRAMID_TOP + (r - 2) * spacingY;
      const rowWidth = (r - 1) * spacingX;
      const startX = CANVAS_WIDTH / 2 - rowWidth / 2;
      
      for (let i = 0; i < r; i++) {
        pegs.push({
          x: startX + i * spacingX,
          y: rowY
        });
      }
    }
    return pegs;
  }, [rows, getSpacing]);

  const spawnBall = useCallback((data: { id?: string, path: number[], slot: number, risk: RiskLevel, rows: number, betAmount: number }) => {
    const { id: serverId, path, slot, risk, rows, betAmount } = data;
    const { spacingX } = getSpacing();
    
    // The path determines the sequence of columns.
    // We start by choosing the first peg in Row 2.
    // If path[0] is -1, we hit the left peg (col 0), if 1, we hit the right peg (col 1).
    const initialCol = path[0] === 1 ? 1 : 0;

    const id = serverId || Math.random().toString(36).substr(2, 9);
    const newBall: Ball = {
      id,
      x: CANVAS_WIDTH / 2 + (path[0] * spacingX * 0.2), // Start slightly offset towards first peg
      y: -20,
      vx: path[0] * 0.5,
      vy: 2,
      row: 2,
      column: initialCol,
      path,
      targetSlot: slot,
      color: risk === 'low' ? '#22c55e' : risk === 'medium' ? '#facc15' : risk === 'high' ? '#f97316' : '#ef4444',
      betAmount,
      risk,
      rows
    };

    ballsRef.current.push(newBall);
    setBalls([...ballsRef.current]);
  }, [getSpacing]);

  const dropBall = useCallback(() => {
    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount < 0.01 || amount > user.credits) return;

    if (socket) {
      socket.emit('plinko:drop', { betAmount: amount, risk, rows });
    }
  }, [betAmount, risk, rows, user.credits, socket]);

  useEffect(() => {
    if (!socket) return;

    const handleResult = (data: any) => {
      spawnBall(data);
    };

    const handleResultMulti = (data: { results: any[] }) => {
      data.results.forEach((res, i) => {
        setTimeout(() => {
          spawnBall(res);
        }, i * 150);
      });
    };

    socket.on('plinko:result', handleResult);
    socket.on('plinko:result-multi', handleResultMulti);

    return () => {
      socket.off('plinko:result', handleResult);
      socket.off('plinko:result-multi', handleResultMulti);
    };
  }, [socket, spawnBall]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAutoRunning && mode === 'auto') {
      interval = setInterval(() => {
        dropBall();
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isAutoRunning, mode, dropBall]);

  const update = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const delta = lastFrameTimeRef.current ? Math.min((timestamp - lastFrameTimeRef.current) / TARGET_FRAME_MS, 3) : 1;
    lastFrameTimeRef.current = timestamp;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { spacingX, spacingY } = getSpacing();
    const pegs = getPegs();

    // Draw Pegs
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    pegs.forEach(peg => {
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, PEG_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Buckets/Multipliers
    const lastRowY = PYRAMID_TOP + (rows - 2) * spacingY;
    const lastRowWidth = (rows - 1) * spacingX;
    const firstPegX = CANVAS_WIDTH / 2 - lastRowWidth / 2;
    const multipliers = MULTIPLIERS[rows][risk];

    multipliers.forEach((m, i) => {
      const centerX = firstPegX + (i - 0.5) * spacingX;
      const width = spacingX - 4;
      const height = 30;
      const x = centerX - width / 2;
      const y = lastRowY + spacingY + 20;

      // Color based on multiplier
      let color = 'rgba(255, 255, 255, 0.05)';
      if (m >= 10) color = 'rgba(239, 68, 68, 0.25)';
      else if (m >= 2) color = 'rgba(249, 115, 22, 0.25)';
      else if (m >= 1) color = 'rgba(250, 204, 21, 0.25)';
      else color = 'rgba(34, 197, 94, 0.25)';

      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      
      // Draw rounded rect
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, 6);
      ctx.fill();
      ctx.stroke();

      // Text
      ctx.fillStyle = m >= 1 ? '#fff' : 'rgba(255, 255, 255, 0.5)';
      const fontSize = Math.max(7, Math.min(10, spacingX / 3.5));
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(m + 'x', x + width / 2, y + height / 2 + 4);
    });

    // Update and Draw Balls
    const remainingBalls: Ball[] = [];
    const subSteps = 4;
    
    ballsRef.current.forEach(ball => {
      for (let s = 0; s < subSteps; s++) {
        ball.vy += (GRAVITY * delta) / subSteps;
        ball.vx *= Math.pow(FRICTION, delta / subSteps);
        
        // Target peg for current row
        const rowWidth = (ball.row - 1) * spacingX;
        const startX = CANVAS_WIDTH / 2 - rowWidth / 2;
        const targetPegX = startX + ball.column * spacingX;
        const targetPegY = PYRAMID_TOP + (ball.row - 2) * spacingY;

        // Guidance: nudge ball towards the target peg horizontally
        if (ball.row <= rows) {
          const dx = targetPegX - ball.x;
          const dy = targetPegY - ball.y;
          
          if (dy > 0) {
            // Calculate required horizontal velocity to hit targetPegX when we reach targetPegY
            const timeToHit = dy / Math.max(0.1, ball.vy);
            const requiredVx = dx / timeToHit;
            // Gently steer towards required velocity
            ball.vx += (requiredVx - ball.vx) * 0.1;
          }
        } else {
          // Centering logic for the final slot
          const finalRowWidth = (rows - 1) * spacingX;
          const finalStartX = CANVAS_WIDTH / 2 - finalRowWidth / 2;
          const targetX = finalStartX + (ball.targetSlot - 0.5) * spacingX;
          const dx = targetX - ball.x;
          ball.vx += dx * 0.02;
          ball.vx *= 0.98;
        }

        ball.x += (ball.vx * delta) / subSteps;
        ball.y += (ball.vy * delta) / subSteps;

        // Peg collision (only with target peg)
        if (ball.row <= rows) {
          const dx = ball.x - targetPegX;
          const dy = ball.y - targetPegY;
          const distSq = dx * dx + dy * dy;
          const minDist = BALL_RADIUS + PEG_RADIUS;

          if (distSq < minDist * minDist) {
            const dist = Math.sqrt(distSq);
            const angle = Math.atan2(dy, dx);
            
            // Resolve overlap
            const overlap = minDist - dist;
            ball.x += Math.cos(angle) * overlap;
            ball.y += Math.sin(angle) * overlap;

            // Bounce direction from predetermined path
            const direction = ball.path[ball.row - 1];
            
            // Apply bounce physics
            const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
            const bounceSpeed = Math.max(speed * BOUNCE, 3.5);
            
            // Force the horizontal direction based on path
            // We want a nice parabolic arc to the next peg
            const bounceAngle = direction === 1 
              ? -Math.PI / 3 + (Math.random() * 0.1) // Bounce Right
              : -2 * Math.PI / 3 - (Math.random() * 0.1); // Bounce Left
            
            ball.vx = Math.cos(bounceAngle) * bounceSpeed;
            ball.vy = Math.sin(bounceAngle) * bounceSpeed;

            // Update target for next row
            if (direction === 1) ball.column++;
            ball.row++;
            
            break; // One collision per sub-step
          }
        }
      }

      // Check if finished
      const finishLine = lastRowY + spacingY + 30;
      if (ball.y > finishLine) {
        const mult = MULTIPLIERS[ball.rows][ball.risk][ball.targetSlot];
        const winAmount = ball.betAmount * mult;

        setRecentWins(prev => [{ multiplier: mult, amount: winAmount }, ...prev].slice(0, 5));
        setSessionNet(prev => prev + winAmount - ball.betAmount);
        
        if (socket && ball.id) {
          socket.emit('plinko:landed', { id: ball.id });
        }
        
        if (mult >= 10) {
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.8 },
            colors: ['#ef4444', '#f97316', '#facc15']
          });
        }
      } else {
        remainingBalls.push(ball);
        
        // Draw ball
        ctx.shadowBlur = 10;
        ctx.shadowColor = ball.color;
        ctx.fillStyle = ball.color;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    if (remainingBalls.length !== balls.length) {
      setBalls([...remainingBalls]);
    }
    ballsRef.current = remainingBalls;

    // Auto drop logic
    if (mode === 'auto' && isAutoRunning) {
      const now = Date.now();
      if (now - lastAutoDropRef.current > 400) {
        dropBall();
        lastAutoDropRef.current = now;
      }
    }

    requestRef.current = requestAnimationFrame(update);
  }, [getSpacing, getPegs, rows, risk, mode, isAutoRunning, dropBall, balls.length, socket]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(update);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [update]);

  return (
    <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden bg-[#0a0a0a]">
      {/* Left Sidebar: Controls */}
      <div className="w-full lg:w-80 border-r border-white/5 bg-black/40 backdrop-blur-xl p-4 lg:p-6 flex flex-col gap-4 lg:gap-6 shrink-0 order-2 lg:order-1 lg:overflow-y-auto custom-scrollbar">
        <div className="flex items-center gap-3 mb-2 order-1 lg:order-none">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-display font-black text-white uppercase italic tracking-tight">Plinko</h2>
            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest">Drop and Win</p>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="bg-[#0f1923] p-1 rounded-xl flex gap-1 border border-white/5 order-3 lg:order-none">
          <button 
            onClick={() => { setMode('manual'); setIsAutoRunning(false); }}
            className={cn(
              "flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              mode === 'manual' ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20" : "text-white/40 hover:text-white"
            )}
          >
            Manual
          </button>
          <button 
            onClick={() => setMode('auto')}
            className={cn(
              "flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              mode === 'auto' ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20" : "text-white/40 hover:text-white"
            )}
          >
            Auto
          </button>
        </div>

        {/* Bet Amount */}
        <div className="space-y-2 order-4 lg:order-none">
          <div className="flex items-center justify-between px-1">
            <label className="text-[10px] font-black text-white/40 uppercase tracking-widest">Bet Amount</label>
            <span className="text-[10px] font-mono text-white/20">${parseFloat(betAmount).toLocaleString()}</span>
          </div>
          <div className="relative group">
            <Coins className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500 group-focus-within:text-amber-400 transition-colors" />
            <input 
              type="number" inputMode="decimal"
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              className="w-full h-12 bg-[#0f1923] border border-white/5 rounded-xl pl-12 pr-4 text-sm font-mono text-white focus:outline-none focus:border-blue-500/30 transition-colors"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
              <button 
                onClick={() => setBetAmount(prev => (parseFloat(prev) / 2).toString())}
                className="w-8 h-8 bg-white/5 hover:bg-white/10 rounded-lg flex items-center justify-center text-[10px] font-black text-white/40 transition-colors"
              >
                1/2
              </button>
              <button 
                onClick={() => setBetAmount(prev => (parseFloat(prev) * 2).toString())}
                className="w-8 h-8 bg-white/5 hover:bg-white/10 rounded-lg flex items-center justify-center text-[10px] font-black text-white/40 transition-colors"
              >
                2x
              </button>
            </div>
          </div>
        </div>

        {/* Risk Level */}
        <div className="space-y-2 order-5 lg:order-none">
          <label className="text-[10px] font-black text-white/40 uppercase tracking-widest px-1">Risk Level</label>
          <div className="grid grid-cols-2 gap-2">
            {(['low', 'medium', 'high', 'extreme'] as RiskLevel[]).map((r) => (
              <button 
                key={r}
                onClick={() => setRisk(r)}
                disabled={balls.length > 0 || isAutoRunning}
                className={cn(
                  "py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border",
                  risk === r 
                    ? "bg-blue-500/10 border-blue-500 text-blue-400 shadow-lg shadow-blue-500/5" 
                    : "bg-[#0f1923] border-white/5 text-white/40 hover:border-white/10",
                  (balls.length > 0 || isAutoRunning) && "opacity-50 cursor-not-allowed grayscale"
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Rows */}
        <div className="space-y-2 order-6 lg:order-none">
          <div className="flex items-center justify-between px-1">
            <label className="text-[10px] font-black text-white/40 uppercase tracking-widest">Rows</label>
            <span className="text-[10px] font-mono text-blue-400 font-black">{rows}</span>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {[8, 10, 12, 14, 16].map((r) => (
              <button 
                key={r}
                onClick={() => setRows(r)}
                disabled={balls.length > 0 || isAutoRunning}
                className={cn(
                  "h-10 rounded-lg text-[10px] font-black transition-all border",
                  rows === r 
                    ? "bg-blue-500 border-blue-400 text-white" 
                    : "bg-[#0f1923] border-white/5 text-white/40 hover:border-white/10",
                  (balls.length > 0 || isAutoRunning) && "opacity-50 cursor-not-allowed grayscale"
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Action Button */}
        <button 
          onClick={() => {
            if (mode === 'auto') {
              setIsAutoRunning(!isAutoRunning);
            } else {
              dropBall();
            }
          }}
          disabled={parseFloat(betAmount) > user.credits || parseFloat(betAmount) < 0.01}
          className={cn(
            "w-full h-14 rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl active:scale-95 text-sm order-2 lg:order-none lg:mt-auto",
            mode === 'auto' && isAutoRunning
              ? "bg-red-500 hover:bg-red-400 text-white shadow-red-500/20"
              : "bg-blue-500 hover:bg-blue-400 text-white shadow-blue-500/20 disabled:opacity-50 disabled:grayscale"
          )}
        >
          {mode === 'auto' ? (isAutoRunning ? 'Stop Auto' : 'Start Auto') : 'Drop Ball'}
        </button>

        {/* Session Net */}
        <div className="bg-[#0f1923] rounded-xl px-3 py-2 flex items-center justify-between border border-white/5 order-7 lg:order-none">
          <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Session Net</span>
          <span className={cn("text-sm font-mono font-black", sessionNet >= 0 ? "text-green-400" : "text-red-400")}>
            {sessionNet >= 0 ? '+' : ''}${sessionNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Recent Wins */}
        <div className="space-y-3 order-8 lg:order-none">
          <div className="flex items-center gap-2 px-1">
            <TrendingUp className="w-3 h-3 text-white/20" />
            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Recent Wins</span>
          </div>
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {recentWins.map((win, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white/5 border border-white/5 rounded-xl p-3 flex items-center justify-between group hover:bg-white/10 transition-colors"
                >
                  <span className={cn(
                    "text-xs font-black italic",
                    win.multiplier >= 10 ? "text-red-400" : win.multiplier >= 2 ? "text-amber-400" : "text-blue-400"
                  )}>
                    {win.multiplier}x
                  </span>
                  <span className="text-xs font-mono font-bold text-white/60">${win.amount.toLocaleString()}</span>
                </motion.div>
              ))}
            </AnimatePresence>
            {recentWins.length === 0 && (
              <div className="text-center py-4">
                <p className="text-[10px] text-white/10 font-black uppercase tracking-widest italic">No drops yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="flex-1 relative flex flex-col items-center justify-center p-4 md:p-8 min-h-[400px] lg:min-h-0 order-1 lg:order-2">
        {/* Background Glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/5 blur-[120px] rounded-full" />
        </div>

        {/* Game Canvas */}
        <div className="relative w-full max-w-[360px] sm:max-w-[500px] md:max-w-[650px] lg:max-w-[800px] aspect-[4/3] bg-[#0f1923]/40 backdrop-blur-sm rounded-2xl md:rounded-[2.5rem] border border-white/5 shadow-2xl overflow-hidden flex items-center justify-center">
          <canvas 
            ref={canvasRef}
            width={800}
            height={600}
            className="w-full h-full"
          />
          
          {/* Active Balls Counter */}
          <div className="absolute top-2 right-2 md:top-6 md:right-8 flex items-center gap-1 md:gap-2 bg-black/40 backdrop-blur-md px-2 md:px-4 py-1 md:py-2 rounded-full border border-white/10">
            <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-[8px] md:text-[10px] font-black text-white/60 uppercase tracking-widest">{balls.length} Active Balls</span>
          </div>
        </div>

        {/* Bottom Info */}
        <div className="mt-8 flex items-center gap-8 text-white/20">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">Provably Fair</span>
          </div>
          <div className="w-px h-4 bg-white/5" />
          <div className="flex items-center gap-2">
            <User className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">{user.username}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
