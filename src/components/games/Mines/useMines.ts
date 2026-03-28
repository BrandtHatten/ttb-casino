import React, { useState, useCallback, useEffect } from 'react';
import confetti from 'canvas-confetti';

export type GameStatus = 'idle' | 'playing' | 'ended';

export interface Tile {
  id: number;
  isRevealed: boolean;
  isMine: boolean;
}

export const useMines = (balance: number, setBalance: React.Dispatch<React.SetStateAction<number>>, socket: any) => {
  const [gridSize] = useState(25); // 5x5
  const [mineCount, setMineCount] = useState(3);
  const [betAmount, setBetAmount] = useState(10);
  const [status, setStatus] = useState<GameStatus>('idle');
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [nextMultiplier, setNextMultiplier] = useState(0);
  const [isCashingOut, setIsCashingOut] = useState(false);
  const [gameResult, setGameResult] = useState<'win' | 'loss' | null>(null);

  // nCr calculation
  const nCr = (n: number, r: number): number => {
    if (r < 0 || r > n) return 0;
    if (r === 0 || r === n) return 1;
    if (r > n / 2) r = n - r;
    let res = 1;
    for (let i = 1; i <= r; i++) {
      res = (res * (n - i + 1)) / i;
    }
    return res;
  };

  const calculateMultiplier = useCallback((revealed: number, mines: number) => {
    if (revealed <= 0) return 1;
    const total = 25;
    const safeTiles = total - mines;
    
    if (revealed > safeTiles) return 0;
    
    const denom = nCr(safeTiles, revealed);
    if (denom === 0) return 0;
    
    const houseEdge = 0.01; // 1% house edge
    const mult = (nCr(total, revealed) / denom) * (1 - houseEdge);
    return Math.max(1, mult);
  }, []);

  useEffect(() => {
    setNextMultiplier(calculateMultiplier(revealedCount + 1, mineCount));
  }, [revealedCount, mineCount, calculateMultiplier]);

  const startGame = () => {
    if (balance < betAmount) return;
    
    setBalance(prev => prev - betAmount);
    
    // Initialize grid
    const newTiles: Tile[] = Array.from({ length: gridSize }, (_, i) => ({
      id: i,
      isRevealed: false,
      isMine: false,
    }));

    // Place mines randomly (client-side for demo, but usually server-side)
    // The user said "build just the games", so I'll implement client-side logic
    // but keep socket hooks if they want to integrate later.
    const minePositions = new Set<number>();
    while (minePositions.size < mineCount) {
      minePositions.add(Math.floor(Math.random() * gridSize));
    }

    newTiles.forEach((tile, i) => {
      if (minePositions.has(i)) {
        tile.isMine = true;
      }
    });

    setTiles(newTiles);
    setRevealedCount(0);
    setMultiplier(1);
    setGameResult(null);
    setStatus('playing');

    if (socket) {
      socket.emit('mines:start', { betAmount, mineCount });
    }
  };

  const revealTile = (id: number) => {
    if (status !== 'playing') return;
    const tile = tiles[id];
    if (tile.isRevealed) return;

    const newTiles = [...tiles];
    newTiles[id] = { ...tile, isRevealed: true };
    setTiles(newTiles);

    if (tile.isMine) {
      // Game Over
      setStatus('ended');
      setMultiplier(1);
      setGameResult('loss');
      setRevealedCount(prev => prev + 1); // Ensure UI knows a move was made
      
      // Reveal all tiles to show where mines were
      setTiles(prev => prev.map(t => ({ ...t, isRevealed: true })));

      if (socket) {
        socket.emit('mines:lost', { id, betAmount });
      }
    } else {
      const newRevealedCount = revealedCount + 1;
      setRevealedCount(newRevealedCount);
      const newMult = calculateMultiplier(newRevealedCount, mineCount);
      setMultiplier(newMult);

      // Check if all safe tiles revealed
      if (newRevealedCount === gridSize - mineCount) {
        cashout(newMult);
      }
    }
  };

  const cashout = (finalMult?: number) => {
    if (status !== 'playing') return;
    
    const winMult = finalMult || multiplier;
    const winAmount = betAmount * winMult;
    
    setIsCashingOut(true);
    setBalance(prev => prev + winAmount);
    setGameResult('win');
    setStatus('ended');
    
    // Reveal all mines
    setTiles(prev => prev.map(t => ({ ...t, isRevealed: true })));

    if (winMult > 1.5) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    }

    if (socket) {
      socket.emit('mines:cashout', { multiplier: winMult, winAmount, betAmount });
    }
    
    setTimeout(() => setIsCashingOut(false), 1000);
  };

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
    gameResult
  };
};
