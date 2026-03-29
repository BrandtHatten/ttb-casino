import React, { useState, useCallback } from 'react';

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

export const useWheel = (
  balance: number,
  setBalance: React.Dispatch<React.SetStateAction<number>>,
  turboMode: boolean = false,
  socket: any = null
) => {
  const [betAmount, setBetAmount] = useState(10);
  const [risk, setRisk] = useState<RiskLevel>('medium');
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [lastResult, setLastResult] = useState<number | null>(null);

  const spinDuration = turboMode ? 500 : 4000;

  const spin = useCallback(async () => {
    if (isSpinning || balance < betAmount || !socket) return;

    setIsSpinning(true);
    setLastResult(null);

    const result = await new Promise<{ segmentIndex: number; multiplier: number; winAmount: number; won: boolean } | null>((resolve) => {
      const onOutcome = (data: any) => { socket.off('error', onError); resolve(data); };
      const onError = () => { socket.off('wheel:outcome', onOutcome); resolve(null); };
      socket.once('wheel:outcome', onOutcome);
      socket.once('error', onError);
      socket.emit('wheel:spin', { betAmount, risk });
    });

    if (!result) {
      setIsSpinning(false);
      return;
    }

    const segments = SEGMENTS[risk];
    const segmentAngle = 360 / segments.length;
    const extraSpins = (5 + Math.floor(Math.random() * 5)) * 360;
    const targetAngle = extraSpins + (360 - (result.segmentIndex * segmentAngle + segmentAngle / 2));
    setRotation(prev => prev + targetAngle - (prev % 360));

    setTimeout(() => {
      setIsSpinning(false);
      setLastResult(result.multiplier);
      socket.emit('activity:reveal');
    }, spinDuration);
  }, [isSpinning, balance, betAmount, risk, socket, spinDuration]);

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
    spinDuration,
  };
};
