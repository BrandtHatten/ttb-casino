import React, { useState, useCallback, useEffect, useRef } from 'react';

export type GameStatus = 'idle' | 'playing' | 'ended';

export interface Tile {
  id: number;
  isRevealed: boolean;
  isMine: boolean;
}

export const useMines = (balance: number, setBalance: React.Dispatch<React.SetStateAction<number>>, socket: any) => {
  const [gridSize] = useState(25);
  const [mineCount, setMineCount] = useState(3);
  const [betAmount, setBetAmount] = useState(10);
  const [status, setStatus] = useState<GameStatus>('idle');
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [nextMultiplier, setNextMultiplier] = useState(0);
  const [isCashingOut, setIsCashingOut] = useState(false);
  const [gameResult, setGameResult] = useState<'win' | 'loss' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const betAmountRef = useRef(betAmount);
  useEffect(() => { betAmountRef.current = betAmount; }, [betAmount]);

  // nCr calculation (mirrors server)
  const nCr = (n: number, r: number): number => {
    if (r < 0 || r > n) return 0;
    if (r === 0 || r === n) return 1;
    if (r > n / 2) r = n - r;
    let res = 1;
    for (let i = 1; i <= r; i++) res = (res * (n - i + 1)) / i;
    return res;
  };

  const calculateMultiplier = useCallback((revealed: number, mines: number) => {
    if (revealed <= 0) return 1;
    const total = 25;
    const safeTiles = total - mines;
    if (revealed > safeTiles) return 0;
    const denom = nCr(safeTiles, revealed);
    if (denom === 0) return 0;
    return Math.max(1, (nCr(total, revealed) / denom) * 0.99);
  }, []);

  // Update next multiplier preview
  useEffect(() => {
    setNextMultiplier(calculateMultiplier(revealedCount + 1, mineCount));
  }, [revealedCount, mineCount, calculateMultiplier]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    const onStarted = (data: { mineCount: number }) => {
      const blankTiles: Tile[] = Array.from({ length: 25 }, (_, i) => ({ id: i, isRevealed: false, isMine: false }));
      setTiles(blankTiles);
      setRevealedCount(0);
      setMultiplier(1);
      setGameResult(null);
      setStatus('playing');
      setIsProcessing(false);
    };

    const onSafe = (data: { id: number; multiplier: number; gameOver: boolean; winAmount?: number; minePositions?: number[] }) => {
      setTiles(prev => {
        const next = [...prev];
        next[data.id] = { ...next[data.id], isRevealed: true, isMine: false };
        if (data.gameOver && data.minePositions) {
          data.minePositions.forEach(pos => {
            if (!next[pos].isRevealed) next[pos] = { ...next[pos], isRevealed: true, isMine: true };
          });
        }
        return next;
      });
      setRevealedCount(prev => prev + 1);
      setMultiplier(data.multiplier);
      setIsProcessing(false);
      if (data.gameOver) {
        setGameResult('win');
        setStatus('ended');
        socket.emit('activity:reveal');
      }
    };

    const onBoom = (data: { id: number; minePositions: number[] }) => {
      setTiles(prev => {
        const next = [...prev];
        data.minePositions.forEach(pos => { next[pos] = { ...next[pos], isRevealed: true, isMine: true }; });
        return next;
      });
      setGameResult('loss');
      setStatus('ended');
      setIsProcessing(false);
      socket.emit('activity:reveal');
    };

    const onCashoutResult = (data: { winAmount: number; multiplier: number; minePositions: number[] }) => {
      setTiles(prev => {
        const next = [...prev];
        data.minePositions.forEach(pos => {
          if (!next[pos].isRevealed) next[pos] = { ...next[pos], isRevealed: true, isMine: true };
        });
        return next;
      });
      setMultiplier(data.multiplier);
      setGameResult('win');
      setStatus('ended');
      setIsCashingOut(false);
      socket.emit('activity:reveal');
    };

    const onError = () => {
      setIsProcessing(false);
      setIsCashingOut(false);
    };

    socket.on('mines:started', onStarted);
    socket.on('mines:safe', onSafe);
    socket.on('mines:boom', onBoom);
    socket.on('mines:cashout_result', onCashoutResult);
    socket.on('error', onError);

    return () => {
      socket.off('mines:started', onStarted);
      socket.off('mines:safe', onSafe);
      socket.off('mines:boom', onBoom);
      socket.off('mines:cashout_result', onCashoutResult);
      socket.off('error', onError);
    };
  }, [socket]);

  const startGame = useCallback(() => {
    if (!socket || balance < betAmount) return;
    setIsProcessing(true);
    socket.emit('mines:start', { betAmount, mineCount });
  }, [socket, balance, betAmount, mineCount]);

  const revealTile = useCallback((id: number) => {
    if (status !== 'playing' || isProcessing || !socket) return;
    const tile = tiles[id];
    if (!tile || tile.isRevealed) return;
    setIsProcessing(true);
    socket.emit('mines:reveal', { id });
  }, [status, isProcessing, socket, tiles]);

  const cashout = useCallback(() => {
    if (status !== 'playing' || !socket || revealedCount === 0) return;
    setIsCashingOut(true);
    socket.emit('mines:cashout');
  }, [status, socket, revealedCount]);

  return {
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
    gameResult,
    isProcessing,
  };
};
