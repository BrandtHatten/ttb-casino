import React, { useState, useCallback, useRef } from 'react';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface WheelSegment {
  multiplier: number;
  color: string;
}

const SEGMENTS: Record<RiskLevel, WheelSegment[]> = {
  low: [
    { multiplier: 1, color: '#10b981' },
    { multiplier: 1.5, color: '#10b981' },
    { multiplier: 1, color: '#10b981' },
    { multiplier: 0, color: '#ef4444' },
    { multiplier: 1, color: '#10b981' },
    { multiplier: 1.5, color: '#10b981' },
    { multiplier: 1, color: '#10b981' },
    { multiplier: 0, color: '#ef4444' },
    { multiplier: 1, color: '#10b981' },
    { multiplier: 1.5, color: '#10b981' },
  ],
  medium: [
    { multiplier: 0, color: '#ef4444' },
    { multiplier: 1.5, color: '#10b981' },
    { multiplier: 0, color: '#ef4444' },
    { multiplier: 2, color: '#f59e0b' },
    { multiplier: 0, color: '#ef4444' },
    { multiplier: 3, color: '#f59e0b' },
    { multiplier: 0, color: '#ef4444' },
    { multiplier: 5, color: '#8b5cf6' },
  ],
  high: [
    { multiplier: 0, color: '#ef4444' },
    { multiplier: 0, color: '#ef4444' },
    { multiplier: 0, color: '#ef4444' },
    { multiplier: 10, color: '#8b5cf6' },
    { multiplier: 0, color: '#ef4444' },
    { multiplier: 0, color: '#ef4444' },
    { multiplier: 0, color: '#ef4444' },
    { multiplier: 50, color: '#ec4899' },
  ],
};

export const useWheel = (balance: number, setBalance: React.Dispatch<React.SetStateAction<number>>) => {
  const [betAmount, setBetAmount] = useState(10);
  const [risk, setRisk] = useState<RiskLevel>('medium');
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [lastResult, setLastResult] = useState<number | null>(null);
  
  const spin = useCallback(() => {
    if (isSpinning || balance < betAmount) return;

    setBalance(balance - betAmount);
    setIsSpinning(true);
    setLastResult(null);

    const segments = SEGMENTS[risk];
    const segmentIndex = Math.floor(Math.random() * segments.length);
    const segmentAngle = 360 / segments.length;
    
    // Calculate new rotation
    // Add 5-10 full spins + the target segment angle
    const extraSpins = (5 + Math.floor(Math.random() * 5)) * 360;
    const targetAngle = extraSpins + (360 - (segmentIndex * segmentAngle + segmentAngle / 2));
    
    setRotation(prev => prev + targetAngle - (prev % 360));

    setTimeout(() => {
      setIsSpinning(false);
      const result = segments[segmentIndex].multiplier;
      setLastResult(result);
      if (result > 0) {
        setBalance(prev => prev + betAmount * result);
      }
    }, 4000); // Match CSS transition duration
  }, [isSpinning, balance, betAmount, risk, setBalance]);

  return {
    betAmount,
    setBetAmount,
    risk,
    setRisk,
    isSpinning,
    spin,
    rotation,
    lastResult,
    segments: SEGMENTS[risk],
  };
};
