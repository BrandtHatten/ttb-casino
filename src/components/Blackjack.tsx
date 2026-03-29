import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Users, ArrowLeft, Clock, Spade } from 'lucide-react';
import { cn } from '../lib/utils';
import { Socket } from 'socket.io-client';

interface BjCard { suit: string; rank: string; value: number; hidden: boolean; }
interface BjHand {
  cards: BjCard[]; bet: number; isFinished: boolean; isBusted: boolean;
  isBlackjack: boolean; isDoubled: boolean; isSplit: boolean;
  result: 'win' | 'loss' | 'push' | 'blackjack' | null; payout: number;
}
interface BjSeat { userId: string | null; username: string | null; hasBet: boolean; activeHandIndex: number; hands: BjHand[]; }
interface BjState {
  tableId: string;
  phase: 'betting' | 'playing' | 'dealerTurn' | 'results';
  bettingTimeLeft: number; actionTimeLeft: number;
  turnSeatIndex: number; turnHandIndex: number;
  dealerCards: BjCard[]; dealerValue: number;
  seats: BjSeat[];
}
interface TableLobbyInfo {
  tableId: string;
  phase: string;
  takenSeats: number;
  totalSeats: number;
  seats: Array<{ taken: boolean; username: string | null }>;
}

interface BlackjackProps { socket: Socket | null; user: any; }

function calcHandDisplay(cards: BjCard[]): number {
  let total = 0, aces = 0;
  for (const c of cards) { if (c.hidden) continue; total += c.value; if (c.rank === 'A') aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

const SUIT_SYMBOLS: Record<string, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
const RED_SUITS = new Set(['H', 'D']);

function Card({ card, small }: { card: BjCard; small?: boolean }) {
  if (card.hidden) {
    return (
      <div className={cn("rounded-lg bg-gradient-to-br from-indigo-600 to-purple-800 border border-white/20 shadow-lg flex items-center justify-center shrink-0", small ? "w-8 h-12" : "w-10 h-14 md:w-20 md:h-28")}>
        <Shield className={cn("text-white/40", small ? "w-3 h-3" : "w-5 h-5")} />
      </div>
    );
  }
  const isRed = RED_SUITS.has(card.suit);
  const sym = SUIT_SYMBOLS[card.suit] || card.suit;
  return (
    <div className={cn("rounded-lg bg-white border border-gray-200 shadow-lg flex flex-col justify-between shrink-0", small ? "p-0.5 w-8 h-12" : "p-0.5 md:p-2 w-10 h-14 md:w-20 md:h-28")}>
      <span className={cn("font-bold leading-none", isRed ? "text-red-500" : "text-gray-900", small ? "text-[8px]" : "text-[10px] md:text-base")}>{card.rank}</span>
      <span className={cn("text-center leading-none", isRed ? "text-red-500" : "text-gray-900", small ? "text-xs" : "text-sm md:text-3xl")}>{sym}</span>
      <span className={cn("font-bold leading-none self-end rotate-180", isRed ? "text-red-500" : "text-gray-900", small ? "text-[8px]" : "text-[10px] md:text-base")}>{card.rank}</span>
    </div>
  );
}

function HandDisplay({ hand, isActive, small }: { hand: BjHand; isActive?: boolean; small?: boolean }) {
  const val = calcHandDisplay(hand.cards);
  return (
    <div className={cn("flex flex-col items-center gap-1", small ? "" : "gap-2")}>
      <div className="flex items-center gap-1">
        <span className={cn("bg-black/40 px-1.5 py-0.5 rounded font-mono text-white border border-white/10", small ? "text-[9px]" : "text-xs")}>{val}</span>
        {hand.result && (
          <span className={cn("px-1.5 py-0.5 rounded font-bold uppercase", small ? "text-[8px]" : "text-[10px]",
            hand.result === 'win' || hand.result === 'blackjack' ? "bg-green-500/20 text-green-400" :
            hand.result === 'loss' ? "bg-red-500/20 text-red-400" : "bg-gray-500/20 text-gray-400"
          )}>
            {hand.result === 'blackjack' ? 'BJ' : hand.result}
          </span>
        )}
        {hand.payout > 0 && !small && (
          <span className="text-[10px] font-bold text-yellow-400">+${hand.payout.toLocaleString()}</span>
        )}
      </div>
      <div className={cn("flex", small ? "-space-x-2" : "-space-x-2 md:-space-x-4")}>
        {hand.cards.map((c, i) => <Card key={i} card={c} small={small} />)}
      </div>
      {!small && <div className="text-xs text-white/50 font-mono">${hand.bet.toLocaleString()}</div>}
    </div>
  );
}

function BlackjackLobby({ lobby, onJoin }: { lobby: TableLobbyInfo[]; onJoin: (tableId: string) => void }) {
  const phaseLabel = (phase: string) => {
    if (phase === 'betting') return 'Betting Open';
    if (phase === 'playing') return 'In Progress';
    if (phase === 'dealerTurn') return 'Dealer Turn';
    if (phase === 'results') return 'Round Over';
    return phase;
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#0f1923] p-6 gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-black text-white uppercase tracking-tighter mb-2">Blackjack</h1>
        <p className="text-white/40 text-sm">Choose a table to join</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        {lobby.map((table) => {
          const isFull = table.takenSeats >= table.totalSeats;
          const isEmpty = table.takenSeats === 0;
          return (
            <motion.div
              key={table.tableId}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "relative rounded-2xl border p-5 flex flex-col gap-4 transition-all",
                isFull
                  ? "border-red-500/20 bg-red-500/5 opacity-60"
                  : "border-white/10 bg-white/5 cursor-pointer hover:border-blue-500/50 hover:bg-blue-500/5"
              )}
              onClick={() => !isFull && onJoin(table.tableId)}
            >
              {/* Table header */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-white uppercase tracking-wider">Table {table.tableId}</span>
                {isFull ? (
                  <span className="px-2 py-0.5 bg-red-500/20 border border-red-500/30 rounded-full text-[10px] font-black text-red-400 uppercase">Full</span>
                ) : (
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-black uppercase border",
                    table.phase === 'betting' ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' : 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400'
                  )}>
                    {phaseLabel(table.phase)}
                  </span>
                )}
              </div>

              {/* Seat grid */}
              <div className="grid grid-cols-5 gap-1">
                {table.seats.map((seat, i) => (
                  <div key={i} className={cn(
                    "h-8 rounded-lg flex items-center justify-center border text-[9px] font-black",
                    seat.taken
                      ? "bg-blue-500/20 border-blue-500/30 text-blue-300"
                      : "bg-white/5 border-white/10 text-white/20"
                  )}>
                    {seat.taken ? seat.username?.[0]?.toUpperCase() : i + 1}
                  </div>
                ))}
              </div>

              {/* Seat count */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-white/50">
                  <Users className="w-3.5 h-3.5" />
                  <span className="text-xs font-bold">{table.takenSeats}/{table.totalSeats} seated</span>
                </div>
                {!isFull && (
                  <span className="text-xs font-black text-blue-400">Join →</span>
                )}
              </div>

              {isFull && (
                <div className="absolute inset-0 rounded-2xl flex items-center justify-center bg-black/40">
                  <span className="text-sm font-black text-red-400 uppercase tracking-widest">Table Full</span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <p className="text-white/20 text-xs">5 seats per table · New round every 20s</p>
    </div>
  );
}

export default function Blackjack({ socket, user }: BlackjackProps) {
  const [state, setState] = useState<BjState | null>(null);
  const [lobby, setLobby] = useState<TableLobbyInfo[] | null>(null);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [betInput, setBetInput] = useState('10');
  const [mySeatIndex, setMySeatIndex] = useState<number | null>(null);
  const [sessionNet, setSessionNet] = useState(0);
  const prevPhaseRef = useRef<string | null>(null);
  const activeTableIdRef = useRef<string | null>(null);
  useEffect(() => { activeTableIdRef.current = activeTableId; }, [activeTableId]);

  useEffect(() => {
    if (!socket) return;
    // Get initial lobby
    socket.emit('bj:sync');

    socket.on('blackjack:lobby', (tables: TableLobbyInfo[]) => {
      setLobby(tables);
    });

    socket.on('blackjack:state', (s: BjState) => {
      if (s.tableId !== activeTableIdRef.current) return;
      setState(s);
      const myIdx = s.seats.findIndex(seat => seat.userId === user?.id);
      setMySeatIndex(myIdx >= 0 ? myIdx : null);
      if (s.phase === 'results' && prevPhaseRef.current !== 'results' && myIdx >= 0) {
        const net = s.seats[myIdx].hands.reduce((acc, hand) => acc + hand.payout - hand.bet, 0);
        setSessionNet(prev => prev + net);
      }
      prevPhaseRef.current = s.phase;
    });

    return () => {
      socket.off('blackjack:lobby');
      socket.off('blackjack:state');
    };
  }, [socket, user?.id]);

  // Leave table on unmount
  useEffect(() => {
    return () => {
      if (socket && activeTableIdRef.current) socket.emit('bj:leave');
    };
  }, [socket]);

  const joinTable = useCallback((tableId: string) => {
    setActiveTableId(tableId);
    activeTableIdRef.current = tableId;
    setState(null);
    prevPhaseRef.current = null;
    setMySeatIndex(null);
    socket?.emit('bj:sync', { tableId });
  }, [socket]);

  const leaveTable = useCallback(() => {
    socket?.emit('bj:leave');
    setActiveTableId(null);
    activeTableIdRef.current = null;
    setState(null);
    setMySeatIndex(null);
    prevPhaseRef.current = null;
    socket?.emit('bj:sync'); // refresh lobby
  }, [socket]);

  const sitDown = useCallback((seatIndex: number) => {
    if (!socket || !activeTableId) return;
    if (mySeatIndex === seatIndex) { socket.emit('bj:leave'); }
    else { socket.emit('bj:sit', { tableId: activeTableId, seatIndex }); }
  }, [socket, mySeatIndex, activeTableId]);

  const placeBet = useCallback(() => {
    if (!socket) return;
    const amount = parseFloat(betInput);
    if (isNaN(amount) || amount < 0.01) return;
    socket.emit('bj:bet', { amount });
  }, [socket, betInput]);

  // --- Lobby ---
  if (!activeTableId) {
    if (!lobby) {
      return (
        <div className="flex-1 flex items-center justify-center bg-[#0f1923] text-white/40 text-sm font-bold uppercase tracking-widest">
          Connecting...
        </div>
      );
    }
    return <BlackjackLobby lobby={lobby} onJoin={joinTable} />;
  }

  // --- Game (waiting for first state) ---
  if (!state) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0f1923] text-white/40 text-sm font-bold uppercase tracking-widest">
        Joining Table {activeTableId}...
      </div>
    );
  }

  const mySeat = mySeatIndex !== null ? state.seats[mySeatIndex] : null;
  const myActiveHands = mySeat?.hands || [];
  const isMyTurn = state.phase === 'playing' && mySeatIndex === state.turnSeatIndex;
  const myCurrentHand = isMyTurn ? myActiveHands[state.turnHandIndex] : null;
  const canDouble = myCurrentHand && !myCurrentHand.isFinished && myCurrentHand.cards.length === 2 && !myCurrentHand.isDoubled;
  const canSplit = myCurrentHand && !myCurrentHand.isFinished && myCurrentHand.cards.length === 2 && myCurrentHand.cards[0].value === myCurrentHand.cards[1].value;
  const alreadyBet = mySeat?.hasBet ?? false;

  const phaseLabel = state.phase === 'betting' ? `Place Bets — ${state.bettingTimeLeft}s`
    : state.phase === 'playing' ? (isMyTurn ? `Your Turn — ${state.actionTimeLeft}s` : `Player ${state.turnSeatIndex + 1}'s Turn`)
    : state.phase === 'dealerTurn' ? 'Dealer Drawing...'
    : 'Round Over';

  return (
    <div className="flex flex-col lg:flex-row w-full h-full bg-[#0f1923] text-white overflow-hidden">

      {/* Left Panel — Controls */}
      <div className="w-full lg:w-72 bg-[#1a2c38] flex flex-col p-2 lg:p-4 border-t lg:border-t-0 lg:border-r border-white/5 shrink-0 order-2 lg:order-1 gap-2 lg:gap-3 max-h-[45vh] lg:max-h-none overflow-y-auto">

        {/* Back to lobby */}
        <button
          onClick={leaveTable}
          className="flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors font-bold uppercase tracking-widest mb-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Tables
          <span className="ml-auto text-[10px] text-white/20">Table {activeTableId}</span>
        </button>

        {/* Phase Badge */}
        <div className={cn("text-center py-2 px-3 rounded-lg font-black text-xs uppercase tracking-widest",
          state.phase === 'betting' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
          : isMyTurn ? 'bg-green-500/20 text-green-400 border border-green-500/30 animate-pulse'
          : state.phase === 'results' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
          : 'bg-white/5 text-white/50 border border-white/5'
        )}>
          {phaseLabel}
        </div>

        {/* Bet Input */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-white/40 uppercase tracking-widest">Bet Amount</label>
          <div className="flex bg-[#0f1923] rounded-lg border border-white/5 overflow-hidden h-10">
            <input
              type="number" value={betInput}
              onChange={e => setBetInput(e.target.value)}
              disabled={state.phase !== 'betting' || alreadyBet}
              className="flex-1 bg-transparent px-3 text-sm font-mono text-white focus:outline-none disabled:opacity-50"
            />
            <button onClick={() => setBetInput(v => (parseFloat(v) / 2).toFixed(2))} disabled={state.phase !== 'betting' || alreadyBet} className="px-2 text-xs text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30 border-l border-white/5">½</button>
            <button onClick={() => setBetInput(v => (parseFloat(v) * 2).toFixed(2))} disabled={state.phase !== 'betting' || alreadyBet} className="px-2 text-xs text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30 border-l border-white/5">2x</button>
          </div>
        </div>

        {/* Place Bet Button */}
        {state.phase === 'betting' && mySeat && !alreadyBet && (
          <button
            onClick={placeBet}
            disabled={parseFloat(betInput) < 0.01 || (user?.credits ?? 0) < parseFloat(betInput)}
            className="w-full h-11 bg-blue-500 hover:bg-blue-400 disabled:bg-white/5 disabled:text-white/20 text-white rounded-lg font-black text-sm uppercase tracking-widest transition-all"
          >
            Place Bet ${parseFloat(betInput || '0').toLocaleString()}
          </button>
        )}
        {state.phase === 'betting' && mySeat && alreadyBet && (
          <div className="text-center py-2.5 text-sm font-bold text-green-400 bg-green-500/10 rounded-lg border border-green-500/20">
            Bet placed! Waiting...
          </div>
        )}

        {/* Action Buttons */}
        {isMyTurn && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => socket?.emit('bj:hit')} className="h-12 bg-[#2f4553] hover:bg-[#3d5a6c] text-white font-black rounded-lg transition-colors text-sm uppercase tracking-widest">Hit</button>
            <button onClick={() => socket?.emit('bj:stand')} className="h-12 bg-[#2f4553] hover:bg-[#3d5a6c] text-white font-black rounded-lg transition-colors text-sm uppercase tracking-widest">Stand</button>
            <button onClick={() => socket?.emit('bj:double')} disabled={!canDouble || (user?.credits ?? 0) < (myCurrentHand?.bet ?? 0)} className="h-12 bg-[#2f4553] hover:bg-[#3d5a6c] disabled:opacity-30 disabled:cursor-not-allowed text-white font-black rounded-lg transition-colors text-sm uppercase tracking-widest">Double</button>
            <button onClick={() => socket?.emit('bj:split')} disabled={!canSplit || (user?.credits ?? 0) < (myCurrentHand?.bet ?? 0)} className="h-12 bg-[#2f4553] hover:bg-[#3d5a6c] disabled:opacity-30 disabled:cursor-not-allowed text-white font-black rounded-lg transition-colors text-sm uppercase tracking-widest">Split</button>
          </div>
        )}

        {/* Seat Status */}
        {!mySeat && state.phase === 'betting' && (
          <div className="text-center text-xs text-white/40 font-medium">Click a seat to join</div>
        )}
        {!mySeat && state.phase !== 'betting' && (
          <div className="text-center text-xs text-white/40 font-medium">Join for next round</div>
        )}

        {/* Leave seat */}
        {mySeat && (state.phase === 'betting' || state.phase === 'results') && (
          <button
            onClick={() => socket?.emit('bj:leave')}
            className="w-full h-9 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded-lg font-bold text-xs uppercase tracking-widest transition-all border border-white/5"
          >
            Leave Seat
          </button>
        )}

        {/* Session Net */}
        <div className="bg-[#0f1923] rounded-xl px-3 py-2 flex items-center justify-between border border-white/5">
          <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Session Net</span>
          <span className={cn("text-sm font-mono font-black", sessionNet >= 0 ? "text-green-400" : "text-red-400")}>
            {sessionNet >= 0 ? '+' : ''}${sessionNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Payout info */}
        <div className="mt-auto pt-2 border-t border-white/5 space-y-1">
          <div className="text-[9px] text-white/20 font-bold uppercase tracking-widest">Payouts</div>
          <div className="text-[10px] text-white/30 space-y-0.5">
            <div className="flex justify-between"><span>Blackjack</span><span className="text-white/50">2.5:1</span></div>
            <div className="flex justify-between"><span>Win</span><span className="text-white/50">1:1</span></div>
            <div className="flex justify-between"><span>Push</span><span className="text-white/50">Back</span></div>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="flex-1 flex flex-col items-center justify-between p-2 md:p-6 order-1 lg:order-2 overflow-y-auto overflow-x-hidden">

        {/* Dealer */}
        <div className="flex flex-col items-center gap-2 w-full">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Dealer</span>
            {state.dealerCards.length > 0 && (
              <span className="bg-black/40 px-2 py-0.5 rounded text-white text-xs font-mono border border-white/10">{state.dealerValue}</span>
            )}
          </div>
          <div className="flex -space-x-2 md:-space-x-4 min-h-[3.5rem] md:min-h-[7rem] items-center justify-center">
            <AnimatePresence>
              {state.dealerCards.map((card, i) => (
                <motion.div key={`d-${i}`} initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                  <Card card={card} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Phase indicator */}
        <div className="w-full max-w-lg border-t border-dashed border-white/10 relative flex items-center justify-center my-1">
          <span className="absolute bg-[#0f1923] px-3 text-[9px] font-bold text-white/20 uppercase tracking-widest">{state.phase}</span>
        </div>

        {/* Seats */}
        <div className="flex gap-2 md:gap-3 w-full justify-center flex-wrap">
          {state.seats.map((seat, i) => {
            const isMe = seat.userId === user?.id;
            const isActiveTurn = state.phase === 'playing' && state.turnSeatIndex === i;
            const isEmpty = seat.userId === null;

            return (
              <div
                key={i}
                onClick={() => { if (isEmpty || isMe) sitDown(i); }}
                className={cn(
                  "flex flex-col items-center gap-1 md:gap-1.5 rounded-xl p-1.5 md:p-3 border transition-all min-w-[70px] md:min-w-[120px]",
                  isMe ? "border-blue-500/50 bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.2)]" :
                  isActiveTurn ? "border-yellow-500/50 bg-yellow-500/5 animate-pulse" :
                  isEmpty && (state.phase === 'betting' || !seat.userId) ? "border-white/10 bg-white/5 cursor-pointer hover:border-white/30 hover:bg-white/10" :
                  "border-white/5 bg-white/[0.02]",
                )}
              >
                <div className="text-[9px] font-black text-white/30 uppercase tracking-widest">Seat {i + 1}</div>

                {isEmpty ? (
                  <div className="text-[10px] text-white/20 font-medium py-4">
                    {state.phase === 'betting' ? 'Click to sit' : 'Empty'}
                  </div>
                ) : (
                  <>
                    <div className={cn("text-[10px] font-black truncate max-w-[80px] md:max-w-[100px]", isMe ? "text-blue-400" : "text-white/70")}>
                      {isMe ? 'You' : seat.username}
                    </div>
                    {state.phase === 'betting' && (
                      <div className={cn("text-[9px] font-bold rounded px-1.5 py-0.5", seat.hasBet ? "text-green-400 bg-green-500/10" : "text-white/30 bg-white/5")}>
                        {seat.hasBet ? `$${seat.hands[0]?.bet.toLocaleString() ?? 0}` : 'No bet'}
                      </div>
                    )}
                    {(state.phase === 'playing' || state.phase === 'dealerTurn' || state.phase === 'results') && seat.hands.length > 0 && (
                      <div className="flex gap-1 flex-wrap justify-center">
                        {seat.hands.map((hand, hi) => (
                          <div key={hi} className={cn("relative", state.phase === 'playing' && isActiveTurn && state.turnHandIndex === hi ? "ring-2 ring-yellow-400 ring-offset-1 ring-offset-transparent rounded" : "")}>
                            <HandDisplay hand={hand} small={!isMe} />
                          </div>
                        ))}
                      </div>
                    )}
                    {isActiveTurn && isMe && (
                      <div className="text-[9px] font-black text-yellow-400 animate-pulse uppercase tracking-widest">Your Turn!</div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
