import React, { useState, useCallback } from 'react';

export type CardSuit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type CardValue = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; // 11=J, 12=Q, 13=K, 14=A

export interface Card {
  suit: CardSuit;
  value: CardValue;
  label: string;
}

export type GameStatus = 'idle' | 'dealing' | 'war' | 'result';
export type GameResult = 'win' | 'loss' | 'tie';

const SUITS: CardSuit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const LABELS: Record<number, string> = {
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

export const useWar = (balance: number, setBalance: React.Dispatch<React.SetStateAction<number>>) => {
  const [betAmount, setBetAmount] = useState(10);
  const [status, setStatus] = useState<GameStatus>('idle');
  const [playerCard, setPlayerCard] = useState<Card | null>(null);
  const [aiCard, setAiCard] = useState<Card | null>(null);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [pot, setPot] = useState(0);
  const [history, setHistory] = useState<{ player: Card; ai: Card; result: GameResult; winAmount: number }[]>([]);

  const drawCard = (): Card => {
    const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
    const value = (Math.floor(Math.random() * 13) + 2) as CardValue;
    const label = LABELS[value] || value.toString();
    return { suit, value, label };
  };

  const playHand = useCallback(() => {
    if (status === 'dealing' || balance < betAmount) return;

    // Initial bet
    setBalance(prev => prev - betAmount);
    setPot(betAmount * 2); // Player bet + AI matching bet
    setStatus('dealing');
    setGameResult(null);
    setPlayerCard(null);
    setAiCard(null);

    // Simulate dealing delay
    setTimeout(() => {
      const pCard = drawCard();
      const aCard = drawCard();
      setPlayerCard(pCard);
      setAiCard(aCard);

      if (pCard.value > aCard.value) {
        // Player wins
        const winAmount = betAmount * 2;
        setBalance(prev => prev + winAmount);
        setGameResult('win');
        setStatus('result');
        setHistory(prev => [{ player: pCard, ai: aCard, result: 'win', winAmount }, ...prev].slice(0, 10));
      } else if (pCard.value < aCard.value) {
        // AI wins
        setGameResult('loss');
        setStatus('result');
        setHistory(prev => [{ player: pCard, ai: aCard, result: 'loss', winAmount: 0 }, ...prev].slice(0, 10));
      } else {
        // Tie -> War
        setGameResult('tie');
        setStatus('war');
      }
    }, 1000);
  }, [status, balance, betAmount, setBalance]);

  const goToWar = useCallback(() => {
    if (status !== 'war' || balance < betAmount) return;

    // Go to war: double the bet
    setBalance(prev => prev - betAmount);
    // Pot = (Initial Bets + War Bets) * 2
    // Initial Bets = betAmount * 2
    // War Bets = betAmount * 2
    // Total = (betAmount * 4) * 2 = betAmount * 8
    setPot(betAmount * 8); 
    setStatus('dealing');
    setPlayerCard(null);
    setAiCard(null);

    setTimeout(() => {
      const pCard = drawCard();
      const aCard = drawCard();
      setPlayerCard(pCard);
      setAiCard(aCard);

      if (pCard.value >= aCard.value) {
        // Player wins the war (standard casino war: player wins on tie during war)
        const winAmount = betAmount * 8; 
        setBalance(prev => prev + winAmount);
        setGameResult('win');
        setStatus('result');
        setHistory(prev => [{ player: pCard, ai: aCard, result: 'win', winAmount }, ...prev].slice(0, 10));
      } else {
        // AI wins the war
        setGameResult('loss');
        setStatus('result');
        setHistory(prev => [{ player: pCard, ai: aCard, result: 'loss', winAmount: 0 }, ...prev].slice(0, 10));
      }
    }, 1000);
  }, [status, balance, betAmount, setBalance]);

  const surrender = useCallback(() => {
    if (status !== 'war') return;
    
    // Surrender: lose half the original bet, get half back
    const refund = betAmount / 2;
    setBalance(prev => prev + refund);
    setGameResult('loss');
    setStatus('result');
    if (playerCard && aiCard) {
      setHistory(prev => [{ player: playerCard, ai: aiCard, result: 'loss', winAmount: 0 }, ...prev].slice(0, 10));
    }
  }, [status, betAmount, setBalance, playerCard, aiCard]);

  return {
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
  };
};
