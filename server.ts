import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs-extra";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import {
  getUser,
  getUserByUsername,
  adjustCredits,
  getJackpot,
  getJackpotDollars,
  addToJackpot,
  resetJackpot,
  getLeaderboard,
  getMostWagered,
  getBiggestWin,
  getAchievements,
  awardAchievement,
  updateStats,
  getFreeSpins,
  setFreeSpins,
  clearFreeSpins,
  getTodayChallenges,
  upsertDailyChallenge,
  getUserChallengeProgress,
  incrementChallengeProgress,
  markChallengeCompleted,
  markChallengeRewardClaimed,
  recordProvablyFair,
  getProvablyFairRound,
  getUserRecentRounds,
  getMostWageredThisWeek,
  getBiggestWinThisWeek,
  getMostProfitableThisWeek,
  userToClient,
  getUserTransactions,
} from "./db.js";
import db from "./db.js";
import { getRank } from "./src/lib/ranks.js";
import { CASE_ITEMS, rollItem } from "./src/lib/caseItems.js";
import { ACHIEVEMENTS } from "./src/lib/achievements.js";

dotenv.config();
import { createHash, randomBytes } from 'crypto';
import { rateLimit } from 'express-rate-limit';
import { logError } from './logger.js';

// ============ MULTIPLAYER BLACKJACK ============
interface BjCard { suit: string; rank: string; value: number; hidden: boolean; }
interface BjHand {
  cards: BjCard[]; bet: number; isFinished: boolean; isBusted: boolean;
  isBlackjack: boolean; isDoubled: boolean; isSplit: boolean;
  result: 'win' | 'loss' | 'push' | 'blackjack' | null; payout: number;
}
interface BjSeat { userId: string | null; username: string | null; hands: BjHand[]; activeHandIndex: number; hasBet: boolean; }

function createBjDeck(): BjCard[] {
  const suits = ['H','D','C','S'], ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const deck: BjCard[] = [];
  for (const suit of suits) for (const rank of ranks) {
    const value = ['J','Q','K'].includes(rank) ? 10 : rank === 'A' ? 11 : parseInt(rank);
    deck.push({ suit, rank, value, hidden: false });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function calcBjHand(cards: BjCard[]): { total: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const c of cards) { if (c.hidden) continue; total += c.value; if (c.rank === 'A') aces++; }
  let soft = false;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  if (aces > 0 && total <= 21) soft = true;
  return { total, soft };
}

class BlackjackTable {
  tableId: string;
  private io: any;
  private userSockets: Map<string, string>;
  private adjustCreditsFn: Function;
  private updateStatsFn: Function;
  private activityHistory: any[];
  private checkAchievementsFn: Function;
  private broadcastLeaderboardsFn: Function;
  private getUserFn: Function;
  private checkJackpotFn: Function;
  private broadcastLobbyFn: Function;
  private processChallengeProgressFn: Function;

  phase: 'betting' | 'playing' | 'dealerTurn' | 'results' = 'betting';
  seats: BjSeat[] = Array.from({ length: 5 }, () => ({ userId: null, username: null, hands: [], activeHandIndex: 0, hasBet: false }));
  private deck: BjCard[] = createBjDeck();
  dealerCards: BjCard[] = [];
  turnSeatIndex = 0;
  turnHandIndex = -1;
  bettingTimeLeft = 10;
  actionTimeLeft = 30;
  private timer: NodeJS.Timeout | null = null;
  private actionInterval: NodeJS.Timeout | null = null;

  constructor(tableId: string, io: any, userSockets: Map<string, string>, deps: any) {
    this.tableId = tableId; this.io = io; this.userSockets = userSockets;
    this.adjustCreditsFn = deps.adjustCredits; this.updateStatsFn = deps.updateStats;
    this.activityHistory = deps.activityHistory; this.checkAchievementsFn = deps.checkAchievements;
    this.broadcastLeaderboardsFn = deps.broadcastLeaderboards; this.getUserFn = deps.getUser;
    this.checkJackpotFn = deps.checkJackpot || (() => {});
    this.broadcastLobbyFn = deps.broadcastLobby || (() => {});
    this.processChallengeProgressFn = deps.processChallengeProgress || (() => {});
    this.startBetting();
  }

  private drawCard(): BjCard {
    if (this.deck.length < 20) this.deck = createBjDeck();
    return { ...this.deck.pop()!, hidden: false };
  }

  getState(): any {
    return {
      tableId: this.tableId,
      phase: this.phase,
      bettingTimeLeft: this.bettingTimeLeft,
      actionTimeLeft: this.actionTimeLeft,
      turnSeatIndex: this.turnSeatIndex,
      turnHandIndex: this.turnHandIndex,
      dealerCards: this.dealerCards.map((c, i) =>
        i === 1 && this.phase === 'playing' ? { suit: '?', rank: '?', value: 0, hidden: true } : c
      ),
      dealerValue: this.phase === 'playing'
        ? calcBjHand(this.dealerCards.slice(0, 1)).total
        : calcBjHand(this.dealerCards).total,
      seats: this.seats.map(s => ({ userId: s.userId, username: s.username, hasBet: s.hasBet, activeHandIndex: s.activeHandIndex, hands: s.hands.map(h => ({ ...h, bet: h.bet / 100, payout: h.payout / 100 })) }))
    };
  }

  getLobbyInfo() {
    const taken = this.seats.filter(s => s.userId !== null).length;
    return {
      tableId: this.tableId,
      phase: this.phase,
      takenSeats: taken,
      totalSeats: 5,
      seats: this.seats.map(s => ({ taken: s.userId !== null, username: s.username })),
    };
  }

  broadcast() {
    this.io.emit('blackjack:state', this.getState());
    this.broadcastLobbyFn();
  }

  private startBetting() {
    this.phase = 'betting';
    this.dealerCards = [];
    this.deck = createBjDeck();
    for (const s of this.seats) { s.hands = []; s.activeHandIndex = 0; s.hasBet = false; }
    this.bettingTimeLeft = 10;
    this.broadcast();
    if (this.timer) clearTimeout(this.timer);
    const tick = () => {
      this.bettingTimeLeft--;
      this.broadcast();
      if (this.bettingTimeLeft <= 0) { this.startPlaying(); }
      else { this.timer = setTimeout(tick, 1000); }
    };
    this.timer = setTimeout(tick, 1000);
  }

  private startPlaying() {
    if (this.timer) clearTimeout(this.timer);
    const activeSeatIndices = this.seats.map((s, i) => i).filter(i => this.seats[i].hasBet && this.seats[i].userId !== null);
    if (activeSeatIndices.length === 0) { this.startBetting(); return; }
    this.phase = 'playing';
    for (const i of activeSeatIndices) {
      this.seats[i].hands[0].cards = [this.drawCard(), this.drawCard()];
      const { total } = calcBjHand(this.seats[i].hands[0].cards);
      if (total === 21) { this.seats[i].hands[0].isBlackjack = true; this.seats[i].hands[0].isFinished = true; }
    }
    this.dealerCards = [this.drawCard(), { ...this.drawCard(), hidden: true }];
    this.turnSeatIndex = 0; this.turnHandIndex = -1;
    this.broadcast();
    this.advanceTurn();
  }

  private advanceTurn() {
    if (this.actionInterval) clearInterval(this.actionInterval);
    let nextSeat = this.turnSeatIndex, nextHand = this.turnHandIndex + 1;
    while (nextSeat < this.seats.length) {
      const seat = this.seats[nextSeat];
      if (seat.hasBet && seat.userId !== null) {
        while (nextHand < seat.hands.length) {
          if (!seat.hands[nextHand].isFinished) {
            this.turnSeatIndex = nextSeat; this.turnHandIndex = nextHand;
            this.actionTimeLeft = 30; this.broadcast();
            const snapSeat = nextSeat, snapHand = nextHand;
            this.actionInterval = setInterval(() => {
              if (this.turnSeatIndex !== snapSeat || this.turnHandIndex !== snapHand) { clearInterval(this.actionInterval!); return; }
              this.actionTimeLeft--;
              this.broadcast();
              if (this.actionTimeLeft <= 0) { clearInterval(this.actionInterval!); this.forceFinishHand(); }
            }, 1000);
            return;
          }
          nextHand++;
        }
      }
      nextSeat++; nextHand = 0;
    }
    this.runDealerTurn();
  }

  private forceFinishHand() {
    if (this.phase !== 'playing') return;
    const seat = this.seats[this.turnSeatIndex];
    if (!seat) return;
    const hand = seat.hands[this.turnHandIndex];
    if (hand && !hand.isFinished) hand.isFinished = true;
    this.broadcast();
    this.advanceTurn();
  }

  private async runDealerTurn() {
    this.phase = 'dealerTurn';
    if (this.dealerCards[1]) this.dealerCards[1].hidden = false;
    this.broadcast();
    await new Promise(r => setTimeout(r, 800));
    while (calcBjHand(this.dealerCards).total < 17) {
      this.dealerCards.push(this.drawCard());
      this.broadcast();
      await new Promise(r => setTimeout(r, 600));
    }
    this.resolveRound();
  }

  private resolveRound() {
    this.phase = 'results';
    const dVal = calcBjHand(this.dealerCards).total;
    const dBusted = dVal > 21;
    const dBlackjack = this.dealerCards.filter(c => !c.hidden).length === 2 && dVal === 21;
    for (const seat of this.seats) {
      if (!seat.hasBet || !seat.userId) continue;
      let totalPayout = 0;
      for (const hand of seat.hands) {
        const pVal = calcBjHand(hand.cards).total;
        let payout = 0, result: BjHand['result'] = 'loss';
        if (hand.isBusted) { result = 'loss'; }
        else if (hand.isBlackjack) { if (dBlackjack) { result = 'push'; payout = hand.bet; } else { result = 'blackjack'; payout = Math.round(hand.bet * 2.5); } }
        else if (dBlackjack) { result = 'loss'; }
        else if (dBusted || pVal > dVal) { result = 'win'; payout = hand.bet * 2; }
        else if (pVal === dVal) { result = 'push'; payout = hand.bet; }
        else { result = 'loss'; }
        hand.result = result; hand.payout = payout; totalPayout += payout;
        if (result === 'win' || result === 'blackjack') {
          try { this.processChallengeProgressFn(seat.userId, 'blackjack_win_count'); } catch (e) { logError('bj:challenge_progress', e, { userId: seat.userId }); }
        }
      }
      const totalBet = seat.hands.reduce((s, h) => s + h.bet, 0);
      if (totalPayout > 0) {
        this.adjustCreditsFn(seat.userId, totalPayout, 'blackjack:payout');
        const sid = this.userSockets.get(seat.userId);
        if (sid) this.io.to(sid).emit('user_data', userToClient(this.getUserFn(seat.userId)));
      }
      const net = totalPayout - totalBet;
      if (net > 0) this.updateStatsFn(seat.userId, { blackjack_wins: 1 });
      this.checkAchievementsFn(seat.userId);
      if (net !== 0) {
        const act = { id: Math.random().toString(36).substr(2, 9), username: seat.username, amount: Math.abs(net) / 100, type: net > 0 ? 'win' : 'loss', game: 'Blackjack', timestamp: Date.now() };
        this.activityHistory.unshift(act);
        if (this.activityHistory.length > 50) this.activityHistory.pop();
        this.io.emit('activity:new', act);
      }
    }
    this.broadcastLeaderboardsFn();
    this.broadcast();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.startBetting(), 5000);
  }

  joinSeat(userId: string, username: string, seatIndex: number): string | null {
    if (seatIndex < 0 || seatIndex >= 5) return 'Invalid seat';
    const seat = this.seats[seatIndex];
    if (seat.userId !== null && seat.userId !== userId) return 'Seat taken';
    this.leaveSeat(userId);
    seat.userId = userId; seat.username = username; seat.hands = []; seat.hasBet = false;
    this.broadcast(); return null;
  }

  leaveSeat(userId: string) {
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (seat.userId !== userId) continue;
      if (this.phase === 'betting' && seat.hasBet) {
        const bet = seat.hands[0]?.bet || 0;
        if (bet > 0) { try { this.adjustCreditsFn(userId, bet, 'blackjack:refund'); const sid = this.userSockets.get(userId); if (sid) this.io.to(sid).emit('user_data', userToClient(this.getUserFn(userId))); } catch (e) { logError('bj:refund', e, { userId, bet }); } }
      }
      if (this.phase === 'playing' && this.turnSeatIndex === i) {
        if (this.actionInterval) clearInterval(this.actionInterval);
        seat.hands.forEach(h => { h.isFinished = true; });
        seat.userId = null; seat.username = null; seat.hasBet = false; seat.hands = [];
        this.advanceTurn(); return;
      }
      seat.userId = null; seat.username = null; seat.hasBet = false; seat.hands = [];
      break;
    }
    this.broadcast();
  }

  placeBet(userId: string, amountDollars: number): string | null {
    if (this.phase !== 'betting') return 'Betting is closed';
    if (amountDollars < 0.01) return 'Minimum bet $0.01';
    if (amountDollars > 100000) return 'Maximum bet is $100,000';
    const betCents = Math.round(amountDollars * 100);
    const seat = this.seats.find(s => s.userId === userId);
    if (!seat) return 'Not seated';
    if (seat.hasBet) return 'Already bet';
    try {
      this.adjustCreditsFn(userId, -betCents, 'blackjack:bet');
      this.checkJackpotFn(userId, seat.username, betCents, 'blackjack-table');
      seat.hasBet = true;
      seat.hands = [{ cards: [], bet: betCents, isFinished: false, isBusted: false, isBlackjack: false, isDoubled: false, isSplit: false, result: null, payout: 0 }];
      const sid = this.userSockets.get(userId);
      if (sid) this.io.to(sid).emit('user_data', userToClient(this.getUserFn(userId)));
      this.broadcast(); return null;
    } catch (err: any) { return err.message; }
  }

  hit(userId: string): string | null {
    if (this.phase !== 'playing') return 'Not your turn';
    const seat = this.seats[this.turnSeatIndex];
    if (!seat || seat.userId !== userId) return 'Not your turn';
    const hand = seat.hands[this.turnHandIndex];
    if (!hand || hand.isFinished) return 'Hand finished';
    if (this.actionInterval) clearInterval(this.actionInterval);
    hand.cards.push(this.drawCard());
    const { total } = calcBjHand(hand.cards);
    if (total >= 21) { if (total > 21) hand.isBusted = true; hand.isFinished = true; this.broadcast(); this.advanceTurn(); }
    else { this.broadcast(); }
    return null;
  }

  stand(userId: string): string | null {
    if (this.phase !== 'playing') return 'Not your turn';
    const seat = this.seats[this.turnSeatIndex];
    if (!seat || seat.userId !== userId) return 'Not your turn';
    const hand = seat.hands[this.turnHandIndex];
    if (!hand || hand.isFinished) return 'Hand finished';
    if (this.actionInterval) clearInterval(this.actionInterval);
    hand.isFinished = true; this.broadcast(); this.advanceTurn(); return null;
  }

  double(userId: string): string | null {
    if (this.phase !== 'playing') return 'Not your turn';
    const seat = this.seats[this.turnSeatIndex];
    if (!seat || seat.userId !== userId) return 'Not your turn';
    const hand = seat.hands[this.turnHandIndex];
    if (!hand || hand.isFinished || hand.cards.length !== 2) return 'Cannot double';
    if (this.actionInterval) clearInterval(this.actionInterval);
    try {
      this.adjustCreditsFn(userId, -hand.bet, 'blackjack:double');
      this.checkJackpotFn(userId, seat.username || '', hand.bet, 'blackjack-double');
      hand.bet *= 2; hand.isDoubled = true; hand.cards.push(this.drawCard());
      const { total } = calcBjHand(hand.cards);
      if (total > 21) hand.isBusted = true;
      hand.isFinished = true;
      const sid = this.userSockets.get(userId);
      if (sid) this.io.to(sid).emit('user_data', userToClient(this.getUserFn(userId)));
      this.broadcast(); this.advanceTurn(); return null;
    } catch (err: any) { return err.message; }
  }

  split(userId: string): string | null {
    if (this.phase !== 'playing') return 'Not your turn';
    const seat = this.seats[this.turnSeatIndex];
    if (!seat || seat.userId !== userId) return 'Not your turn';
    const hand = seat.hands[this.turnHandIndex];
    if (!hand || hand.isFinished || hand.cards.length !== 2 || hand.cards[0].value !== hand.cards[1].value) return 'Cannot split';
    if (this.actionInterval) clearInterval(this.actionInterval);
    try {
      const origBet = hand.bet;
      this.adjustCreditsFn(userId, -origBet, 'blackjack:split');
      this.checkJackpotFn(userId, seat.username || '', origBet, 'blackjack-split');
      hand.isSplit = true;
      const splitCard = hand.cards.pop()!;
      hand.cards.push(this.drawCard());
      const { total: t1 } = calcBjHand(hand.cards);
      if (t1 === 21) hand.isFinished = true;
      const newHand: BjHand = { cards: [splitCard, this.drawCard()], bet: origBet, isFinished: false, isBusted: false, isBlackjack: false, isDoubled: false, isSplit: true, result: null, payout: 0 };
      const { total: t2 } = calcBjHand(newHand.cards);
      if (t2 === 21) newHand.isFinished = true;
      seat.hands.splice(this.turnHandIndex + 1, 0, newHand);
      const sid = this.userSockets.get(userId);
      if (sid) this.io.to(sid).emit('user_data', userToClient(this.getUserFn(userId)));
      if (hand.isFinished) { this.broadcast(); this.advanceTurn(); }
      else { this.broadcast(); }
      return null;
    } catch (err: any) { return err.message; }
  }
}
// ============ END BLACKJACK TABLE ============

// ============ SLOTS SERVER-SIDE RNG ============
type SlotSymType = 'HEART'|'SQUARE'|'PENTAGON'|'RECTANGLE'|'APPLE'|'PLUM'|'WATERMELON'|'GRAPE'|'BANANA'|'SCATTER'|'MULTIPLIER';
interface SlotSym { id: string; type: SlotSymType; value: number; color: string; icon: string; isNew: boolean; multiplier?: number; }
const SLOT_SYM_DEFS: Record<string, { value: number; color: string; icon: string }> = {
  HEART: { value: 10, color: 'bg-red-500', icon: 'Heart' },
  SQUARE: { value: 5, color: 'bg-purple-500', icon: 'Square' },
  PENTAGON: { value: 3, color: 'bg-green-500', icon: 'Pentagon' },
  RECTANGLE: { value: 2, color: 'bg-blue-500', icon: 'RectangleHorizontal' },
  APPLE: { value: 1, color: 'bg-red-600', icon: 'Apple' },
  PLUM: { value: 0.8, color: 'bg-purple-700', icon: 'Circle' },
  WATERMELON: { value: 0.5, color: 'bg-green-600', icon: 'Citrus' },
  GRAPE: { value: 0.4, color: 'bg-indigo-500', icon: 'Grape' },
  BANANA: { value: 0.25, color: 'bg-yellow-400', icon: 'Banana' },
  SCATTER: { value: 0, color: 'bg-pink-400', icon: 'Candy' },
  MULTIPLIER: { value: 0, color: 'bg-rainbow', icon: 'Bomb' },
};
const SLOT_ROWS = 5, SLOT_COLS = 6;
const SLOT_W: Record<string, number> = { BANANA: 20, GRAPE: 18, WATERMELON: 16, PLUM: 14, APPLE: 12, RECTANGLE: 10, PENTAGON: 8, SQUARE: 6, HEART: 4 };
const SLOT_NORMAL = Object.keys(SLOT_W);
const SLOT_TOTAL_W = Object.values(SLOT_W).reduce((a, b) => a + b, 0);
const SLOT_MV = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50, 100, 1000];
const SLOT_MW = [20, 15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 0.5, 0.1];
const SLOT_TOTAL_MW = SLOT_MW.reduce((a, b) => a + b, 0);
let slotIdCtr = 0;
function genSlotSym(type?: string, freeSpin = false): SlotSym {
  let t = type;
  if (!t) {
    const r = Math.random();
    if (r < 0.025) t = 'SCATTER';
    else if (freeSpin && r < 0.06) t = 'MULTIPLIER';
    else {
      let w = Math.random() * SLOT_TOTAL_W;
      for (const k of SLOT_NORMAL) { if (w < SLOT_W[k]) { t = k; break; } w -= SLOT_W[k]; }
      if (!t) t = 'BANANA';
    }
  }
  const def = SLOT_SYM_DEFS[t] ?? SLOT_SYM_DEFS['BANANA'];
  const sym: SlotSym = { id: `s${slotIdCtr++}`, type: t as SlotSymType, value: def.value, color: def.color, icon: def.icon, isNew: true };
  if (t === 'MULTIPLIER') {
    let w = Math.random() * SLOT_TOTAL_MW, idx = 0;
    for (let i = 0; i < SLOT_MW.length; i++) { if (w < SLOT_MW[i]) { idx = i; break; } w -= SLOT_MW[i]; }
    sym.multiplier = SLOT_MV[idx];
  }
  return sym;
}
function genSlotGrid(freeSpin = false, guaranteedScatters = 0): SlotSym[][] {
  const grid: SlotSym[][] = Array.from({ length: SLOT_ROWS }, () =>
    Array.from({ length: SLOT_COLS }, () => genSlotSym(undefined, freeSpin))
  );
  if (guaranteedScatters > 0) {
    const pos: { r: number; c: number }[] = [];
    for (let r = 0; r < SLOT_ROWS; r++) for (let c = 0; c < SLOT_COLS; c++) pos.push({ r, c });
    for (let i = pos.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pos[i], pos[j]] = [pos[j], pos[i]]; }
    for (let i = 0; i < Math.min(guaranteedScatters, pos.length); i++) { const { r, c } = pos[i]; grid[r][c] = genSlotSym('SCATTER', freeSpin); }
  }
  return grid;
}
function calcSlotOutcome(bet: number, freeSpin = false, guaranteedScatters = 0): { grid: SlotSym[][]; totalWin: number; freeSpinsTriggered: boolean; freeSpinCount: number } {
  const initialGrid = genSlotGrid(freeSpin, guaranteedScatters);
  let totalWin = 0, freeSpinsTriggered = false, freeSpinCount = 0;
  let grid = initialGrid.map(r => r.map(s => ({ ...s })));
  for (let iter = 0; iter < 100; iter++) {
    const counts: Record<string, { pos: { row: number; col: number }[] }> = {};
    const multipliers: number[] = [];
    grid.forEach((row, ri) => row.forEach((sym, ci) => {
      if (sym.type === 'MULTIPLIER') { multipliers.push(sym.multiplier ?? 2); return; }
      if (!counts[sym.type]) counts[sym.type] = { pos: [] };
      counts[sym.type].pos.push({ row: ri, col: ci });
    }));
    const wins: { type: string; payout: number; pos: { row: number; col: number }[] }[] = [];
    let scatterCount = 0;
    for (const [type, { pos }] of Object.entries(counts)) {
      if (type === 'SCATTER') {
        scatterCount = pos.length;
        if (scatterCount >= 4 || (freeSpin && scatterCount >= 3)) {
          let sp = scatterCount === 4 ? 3 * bet : scatterCount === 5 ? 5 * bet : scatterCount >= 6 ? 100 * bet : 0;
          wins.push({ type: 'SCATTER', payout: sp, pos });
        }
        continue;
      }
      if (pos.length >= 8) {
        const val = SLOT_SYM_DEFS[type]?.value ?? 0;
        const mult = pos.length >= 12 ? 10 : pos.length >= 10 ? 4 : 1;
        wins.push({ type, payout: val * mult * bet, pos });
      }
    }
    if (wins.length === 0) {
      if (multipliers.length > 0) totalWin *= multipliers.reduce((a, b) => a + b, 0);
      break;
    }
    const sw = wins.find(w => w.type === 'SCATTER');
    if (sw && !freeSpin && sw.pos.length >= 4 && !freeSpinsTriggered) { freeSpinsTriggered = true; freeSpinCount += 10 + (sw.pos.length - 4) * 5; }
    else if (sw && freeSpin && sw.pos.length >= 3) { freeSpinCount += 5 + (sw.pos.length - 3) * 5; }
    totalWin += wins.reduce((s, w) => s + w.payout, 0);
    const removed = new Set(wins.flatMap(w => w.pos.map(p => `${p.row}-${p.col}`)));
    const ng = grid.map(r => r.map(s => ({ ...s })));
    for (let c = 0; c < SLOT_COLS; c++) {
      let wi = SLOT_ROWS - 1;
      for (let r = SLOT_ROWS - 1; r >= 0; r--) { if (!removed.has(`${r}-${c}`)) { ng[wi][c] = grid[r][c]; wi--; } }
      for (let r = wi; r >= 0; r--) ng[r][c] = genSlotSym(undefined, freeSpin);
    }
    grid = ng;
  }
  return { grid: initialGrid, totalWin: Math.round(totalWin), freeSpinsTriggered, freeSpinCount };
}
// ============ END SLOTS RNG ============

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const SERVER_VERSION = Date.now().toString();
const MAX_BET = 10_000_000; // $100,000 in cents
const WHEEL_SEGMENTS: Record<string, number[]> = {
  low:    [1.2, 1.5, 1.2, 0, 1.2, 1.5, 1.2, 0, 1.2, 0.5],                          // EV = 9.5/10 = 0.95 (5% house edge)
  medium: [0, 1.5, 0, 2.5, 0, 0, 0, 1.5, 0, 3.7],                                  // EV = 9.2/10 = 0.92 (8% house edge)
  high:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 15],          // EV = 18/20 = 0.90 (10% house edge)
};
const pfGenSeed = () => randomBytes(32).toString('hex');
const pfHash = (seed: string) => createHash('sha256').update(seed).digest('hex');
const pfRoundId = () => randomBytes(16).toString('hex');

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const allowedOrigins = process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL, `http://localhost:${process.env.PORT || 3002}`]
    : ["http://localhost:3002"];
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  const PORT = parseInt(process.env.PORT || "3002");

  app.use(express.json());
  app.set('trust proxy', 1);
  const bonusLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

  // Promote admin at startup
  db.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run("PXNGN");
  db.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run(ADMIN_USERNAME);

  // --- Auth Middleware ---
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  const isAdmin = (req: any, res: any, next: any) => {
    const user = getUser(req.user.id) as any;
    if (user && user.is_admin) {
      next();
    } else {
      res.status(403).json({ error: "Admin access required" });
    }
  };

  // --- REST Routes ---
  app.post("/api/auth/register", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });

    const normalizedUsername = username.trim();
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(normalizedUsername);
    if (existing) return res.status(400).json({ error: "Username taken" });

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const id = Math.random().toString(36).substr(2, 9);
      db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, normalizedUsername, hashedPassword);
      
      // Auto-promote PXNGN or default admin
      if (normalizedUsername.toUpperCase() === "PXNGN" || normalizedUsername.toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
        db.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run(normalizedUsername);
      }

      res.status(201).json({ message: "User created" });
    } catch (err) {
      logError('POST /api/register', err);
      res.status(400).json({ error: "Username taken" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    const normalizedUsername = username.trim();
    const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(normalizedUsername) as any;

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.is_banned) {
      return res.status(403).json({ error: "Account banned" });
    }
    const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, credits: user.credits / 100, is_admin: user.is_admin } });
  });

  app.get("/api/auth/me", authenticateToken, (req: any, res) => {
    const user = getUser(req.user.id);
    res.json(userToClient(user));
  });

  app.post("/api/auth/claim-daily", bonusLimiter, authenticateToken, (req: any, res) => {
    const userId = req.user.id;
    const user = getUser(userId) as any;
    const now = new Date().toISOString().split('T')[0];

    const rank = getRank(user.total_wagered / 100); // getRank expects dollars
    const rewardCents = rank.dailyReward * 100; // dailyReward is in dollars, convert to cents

    const result = db.prepare('UPDATE users SET credits = credits + ?, daily_reward_date = ? WHERE id = ? AND (daily_reward_date IS NULL OR daily_reward_date != ?)').run(rewardCents, now, userId, now);
    if (result.changes === 0) {
      return res.status(400).json({ error: "Already claimed today" });
    }
    const updatedUser = getUser(userId);

    // Notify all sockets for this user
    const socketId = userSockets.get(userId);
    if (socketId) io.to(socketId).emit("user_data", userToClient(updatedUser));

    checkAchievements(userId);

    res.json({ message: "Daily reward claimed", user: userToClient(updatedUser) });
  });

  app.post("/api/user/gift", authenticateToken, (req: any, res) => {
    const { targetUsername, amount } = req.body; // amount in dollars from client
    const userId = req.user.id;
    const user = getUser(userId) as any;
    const amountCents = Math.round(amount * 100);

    if (!targetUsername || !amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid request" });
    }

    if (user.credits < amountCents) {
      return res.status(400).json({ error: "Insufficient credits" });
    }

    const targetUser = getUserByUsername(targetUsername) as any;
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (targetUser.id === userId) {
      return res.status(400).json({ error: "Cannot gift to yourself" });
    }

    try {
      adjustCredits(userId, -amountCents, `gift to ${targetUsername}`);
      adjustCredits(targetUser.id, amountCents, `gift from ${user.username}`);

      const updatedUser = getUser(userId);
      const updatedTarget = getUser(targetUser.id);

      const socketId = userSockets.get(userId);
      if (socketId) io.to(socketId).emit("user_data", userToClient(updatedUser));

      const targetSocketId = userSockets.get(targetUser.id);
      if (targetSocketId) io.to(targetSocketId).emit("user_data", userToClient(updatedTarget));

      checkAchievements(userId);
      checkAchievements(targetUser.id);

      res.json({ message: "Credits gifted successfully" });
    } catch (err: any) {
      logError('POST /api/gift-credits', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/user/update-username", authenticateToken, async (req: any, res) => {
    const { newUsername, password } = req.body;
    const userId = req.user.id;
    const user = getUser(userId) as any;

    if (!newUsername || !password) return res.status(400).json({ error: "Missing fields" });

    if (!(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid password" });
    }

    try {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newUsername, userId);
      const updatedUser = getUser(userId);

      const socketId = userSockets.get(userId);
      if (socketId) io.to(socketId).emit("user_data", userToClient(updatedUser));

      res.json({ message: "Username updated", user: userToClient(updatedUser) });
    } catch (err) {
      logError('POST /api/settings/username', err);
      res.status(400).json({ error: "Username already taken" });
    }
  });

  app.post("/api/user/update-password", authenticateToken, async (req: any, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    const user = getUser(userId) as any;

    if (!currentPassword || !newPassword) return res.status(400).json({ error: "Missing fields" });

    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: "Invalid current password" });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashedNewPassword, userId);

    res.json({ message: "Password updated" });
  });

  app.post("/api/user/claim-interest", bonusLimiter, authenticateToken, (req: any, res) => {
    const userId = req.user.id;
    const user = getUser(userId) as any;
    const now = new Date();
    const todayStart = new Date(now).setUTCHours(0, 0, 0, 0);
    const lastClaim = user.interest_date ? parseInt(user.interest_date) : 0;

    if (user.credits < 1000000) { // $10,000 in cents
      return res.status(400).json({ error: "Minimum $10,000 balance required" });
    }

    const interestCents = Math.round(user.credits * 0.01); // 1% of balance in cents
    const interestResult = db.prepare('UPDATE users SET credits = credits + ?, interest_date = ?, interest_claims = interest_claims + 1 WHERE id = ? AND (interest_date IS NULL OR CAST(interest_date AS INTEGER) < ?)').run(interestCents, Date.now().toString(), userId, todayStart);
    if (interestResult.changes === 0) {
      const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
      const remaining = tomorrowStart - now.getTime();
      const hours = Math.floor(remaining / (60 * 60 * 1000));
      const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
      return res.status(400).json({ error: `You can claim again in ${hours}h ${minutes}m (at midnight UTC)` });
    }
    const updatedUser = getUser(userId);

    const socketId = userSockets.get(userId);
    if (socketId) io.to(socketId).emit("user_data", userToClient(updatedUser));

    checkAchievements(userId);

    const interestDollars = interestCents / 100;
    res.json({ message: `Interest of $${interestDollars.toLocaleString()} claimed`, user: userToClient(updatedUser) });
  });

  app.post("/api/stats/claim-weekly", bonusLimiter, authenticateToken, (req: any, res) => {
    const userId = req.user.id;
    const user = getUser(userId) as any;
    
    // Simple weekly check (could be more robust)
    const now = new Date();
    const lastClaim = user.weekly_reward_date ? new Date(user.weekly_reward_date) : null;
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const weeklyResult = db.prepare('UPDATE users SET credits = credits + 1000000, weekly_reward_date = ? WHERE id = ? AND (weekly_reward_date IS NULL OR weekly_reward_date <= ?)').run(now.toISOString(), userId, oneWeekAgo.toISOString());
    if (weeklyResult.changes === 0) {
      return res.status(400).json({ error: "Weekly reward not available yet" });
    }
    const updatedUser = getUser(userId);

    const socketId = userSockets.get(userId);
    if (socketId) io.to(socketId).emit("user_data", userToClient(updatedUser));

    res.json({ message: "Weekly reward claimed", user: userToClient(updatedUser) });
  });

  app.get("/api/jackpot", (req, res) => {
    res.json({ amount: getJackpotDollars() });
  });

  app.get("/api/user/public/:username", (req, res) => {
    const user = getUserByUsername(req.params.username) as any;
    if (!user || user.is_banned) return res.status(404).json({ error: "User not found" });
    const achievements = db.prepare('SELECT achievement_id, timestamp FROM user_achievements WHERE user_id = ?').all(user.id);
    res.json({
      username: user.username,
      total_wagered: (user.total_wagered || 0) / 100,
      total_bets: user.total_bets || 0,
      total_wins: user.total_wins || 0,
      net_profit: (user.net_profit || 0) / 100,
      biggest_win: (user.biggest_win || 0) / 100,
      achievements,
    });
  });

  app.get("/api/user/history", authenticateToken, (req: any, res) => {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 25;
    const filter = (req.query.filter as string) || 'all';
    res.json(getUserTransactions(userId, page, limit, filter));
  });

  app.get("/api/provably_fair/user/recent", authenticateToken, (req: any, res) => {
    res.json(getUserRecentRounds(req.user.id, 20));
  });

  app.get("/api/provably_fair/:roundId", authenticateToken, (req: any, res) => {
    const round = getProvablyFairRound(req.params.roundId);
    if (!round) return res.status(404).json({ error: 'Round not found' });
    res.json(round);
  });

  // --- Admin Endpoints ---
  app.get("/api/admin/users", authenticateToken, isAdmin, (req, res) => {
    const users = db.prepare('SELECT id, username, credits, total_wagered, is_admin, is_banned, total_bets, total_wins, net_profit, biggest_win FROM users').all()
      .map((u: any) => ({ ...u, credits: u.credits / 100, total_wagered: u.total_wagered / 100, net_profit: u.net_profit / 100, biggest_win: u.biggest_win / 100 }));
    res.json(users);
  });

  app.post("/api/admin/credits", authenticateToken, isAdmin, (req: any, res) => {
    const { userId, amount, description } = req.body; // amount in dollars from admin UI
    const adminUsername = req.user.username;
    const amountCents = Math.round(amount * 100);
    try {
      db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(amountCents, userId);
      db.prepare('INSERT INTO transactions (user_id, amount, balance_after, description) VALUES (?, ?, (SELECT credits FROM users WHERE id = ?), ?)').run(userId, amountCents, userId, description || `Admin adjustment by ${adminUsername}`);

      const updatedUser = getUser(userId);
      const socketId = userSockets.get(userId);
      if (socketId) io.to(socketId).emit("user_data", userToClient(updatedUser));

      res.json({ message: "Credits adjusted", user: userToClient(updatedUser) });
    } catch (err: any) {
      logError('POST /api/admin/adjust-credits', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/set-credits", authenticateToken, isAdmin, (req: any, res) => {
    const { userId, amount, description } = req.body; // amount in dollars from admin UI
    const adminUsername = req.user.username;
    const amountCents = Math.round(amount * 100);
    try {
      db.transaction(() => {
        const current = (db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as any).credits;
        const delta = amountCents - current;
        db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(amountCents, userId);
        db.prepare('INSERT INTO transactions (user_id, amount, balance_after, description) VALUES (?, ?, ?, ?)').run(userId, delta, amountCents, description || `Admin set balance by ${adminUsername}`);
      })();

      const updatedUser = getUser(userId);
      const socketId = userSockets.get(userId);
      if (socketId) io.to(socketId).emit("user_data", userToClient(updatedUser));

      res.json({ message: "Credits set", user: userToClient(updatedUser) });
    } catch (err: any) {
      logError('POST /api/admin/set-credits', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/reset-stats", authenticateToken, isAdmin, (req, res) => {
    const { userId } = req.body;
    db.prepare('UPDATE users SET total_wagered = 0, total_bets = 0, total_wins = 0, net_profit = 0, biggest_win = 0 WHERE id = ?').run(userId);
    const updatedUser = getUser(userId);
    const socketId = userSockets.get(userId);
    if (socketId) io.to(socketId).emit("user_data", userToClient(updatedUser));
    res.json({ message: "Stats reset", user: userToClient(updatedUser) });
  });

  app.post("/api/admin/reset-achievements", authenticateToken, isAdmin, (req, res) => {
    const { userId } = req.body;
    db.prepare('DELETE FROM user_achievements WHERE user_id = ?').run(userId);
    
    // Notify the user
    const socketId = userSockets.get(userId);
    if (socketId) {
      io.to(socketId).emit("user_achievements", getAchievements(userId));
    }
    
    res.json({ message: "Achievements reset" });
  });

  app.post("/api/admin/ban", authenticateToken, isAdmin, (req, res) => {
    const { userId, isBanned } = req.body;
    db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(isBanned ? 1 : 0, userId);
    res.json({ message: isBanned ? "User banned" : "User unbanned" });
  });

  app.delete("/api/admin/user/:id", authenticateToken, isAdmin, (req, res) => {
    const userId = req.params.id;
    db.prepare('DELETE FROM user_achievements WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM transactions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.json({ message: "User deleted" });
  });

  app.get("/api/admin/transactions", authenticateToken, isAdmin, (req, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = 25;
    const offset = (page - 1) * limit;
    const search = req.query.search as string || "";
    const type = req.query.type as string || "all"; // all, win, loss

    let query = `
      SELECT t.*, u.username 
      FROM transactions t 
      JOIN users u ON t.user_id = u.id 
      WHERE u.username LIKE ?
    `;
    const params: any[] = [`%${search}%`];

    if (type === 'win') {
      query += " AND t.amount > 0";
    } else if (type === 'loss') {
      query += " AND t.amount < 0";
    }

    const total = db.prepare(`SELECT COUNT(*) as count FROM (${query})`).get(...params) as any;
    
    query += " ORDER BY t.timestamp DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const transactions = db.prepare(query).all(...params)
      .map((t: any) => ({ ...t, amount: t.amount / 100, balance_after: t.balance_after / 100 }));
    res.json({ transactions, total: total.count, pages: Math.ceil(total.count / limit) });
  });

  app.post("/api/admin/broadcast", authenticateToken, isAdmin, (req, res) => {
    const { message, type } = req.body;
    io.emit("broadcast", { message, type: type || "info", timestamp: new Date().toISOString() });
    res.json({ message: "Broadcast sent" });
  });

  app.post("/api/admin/jackpot", authenticateToken, isAdmin, (req, res) => {
    const { amount } = req.body; // dollars from admin UI
    const amountCents = Math.round(amount * 100);
    db.prepare('UPDATE jackpot SET amount = ? WHERE id = 1').run(amountCents);
    io.emit("jackpot:update", amount); // send dollars to client
    res.json({ message: "Jackpot updated", amount });
  });

  app.post("/api/admin/site-reset", authenticateToken, isAdmin, (req, res) => {
    const reset = db.transaction(() => {
      db.prepare('UPDATE users SET credits = 100000, total_wagered = 0, total_bets = 0, total_wins = 0, net_profit = 0, biggest_win = 0, daily_reward_date = NULL, weekly_reward_date = NULL, interest_date = NULL, interest_claims = 0').run();
      db.prepare('DELETE FROM user_achievements').run();
      db.prepare('DELETE FROM user_free_spins').run();
      db.prepare('DELETE FROM user_challenge_progress').run();
      db.prepare('DELETE FROM transactions').run();
      db.prepare('UPDATE jackpot SET amount = 200000 WHERE id = 1').run();
    });
    reset();
    io.emit("site_reset");
    res.json({ message: "Site-wide reset complete" });
  });

  app.get("/api/leaderboard", (req, res) => {
    res.json({
      mostCredits: getLeaderboard(),
      mostWagered: getMostWagered(),
      biggestWin: getBiggestWin()
    });
  });

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // --- Socket.IO ---
  const userSockets = new Map<string, string>();
  
  const broadcastOnline = () => {
    const onlineUsernames = Array.from(userSockets.entries()).map(([, sid]) => {
      const s = io.sockets.sockets.get(sid) as any;
      return s?.user?.username ?? null;
    }).filter(Boolean);
    io.emit("chat:online", onlineUsernames);
  };
  const pendingWins = new Map<string, any[]>();
  const activityHistory: any[] = [];
  const pendingPlinkoDrops = new Map<string, any>();

  // --- Mines Server-Side Game State ---
  interface ActiveMinesGame {
    betAmount: number;
    mineCount: number;
    minePositions: Set<number>;
    revealedCount: number;
    revealedTiles: Set<number>;
  }
  const activeMinesGames = new Map<string, ActiveMinesGame>();
  const minesNcr = (n: number, r: number): number => {
    if (r < 0 || r > n) return 0;
    if (r === 0 || r === n) return 1;
    if (r > n / 2) r = n - r;
    let res = 1;
    for (let i = 1; i <= r; i++) res = (res * (n - i + 1)) / i;
    return res;
  };
  const calcMinesMultiplier = (revealed: number, mines: number): number => {
    if (revealed <= 0) return 1;
    const total = 25;
    const safe = total - mines;
    if (revealed > safe) return 0;
    const denom = minesNcr(safe, revealed);
    if (denom === 0) return 0;
    return Math.max(1, (minesNcr(total, revealed) / denom) * 0.99);
  };

  // --- PVP War State ---
  const WAR_SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
  const WAR_VALUES = [
    {value:2,label:'2'},{value:3,label:'3'},{value:4,label:'4'},{value:5,label:'5'},
    {value:6,label:'6'},{value:7,label:'7'},{value:8,label:'8'},{value:9,label:'9'},
    {value:10,label:'10'},{value:11,label:'J'},{value:12,label:'Q'},{value:13,label:'K'},{value:14,label:'A'},
  ];
  const dealWarCardFixed = () => {
    const v = WAR_VALUES[Math.floor(Math.random() * WAR_VALUES.length)];
    const s = WAR_SUITS[Math.floor(Math.random() * 4)];
    return { suit: s, value: v.value, label: v.label };
  };
  let warQueue: Array<{ userId: string; socketId: string; username: string; betAmount: number }> = [];
  const warRooms = new Map<string, {
    player1: { userId: string; socketId: string; username: string; betAmount: number; card: any; warCard: any };
    player2: { userId: string; socketId: string; username: string; betAmount: number; card: any; warCard: any };
    status: 'cards_dealt' | 'war_pending' | 'done';
    warDecisions: Map<string, 'war' | 'surrender'>;
  }>();

  let leaderboardThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  const broadcastLeaderboards = () => {
    if (leaderboardThrottleTimer) return;
    leaderboardThrottleTimer = setTimeout(() => {
      leaderboardThrottleTimer = null;
      const allTime = {
        mostcredits: getLeaderboard(),
        mostwagered: getMostWagered(),
        biggestwin: getBiggestWin()
      };
      const thisWeek = {
        mostcredits: getMostProfitableThisWeek(),
        mostwagered: getMostWageredThisWeek(),
        biggestwin: getBiggestWinThisWeek()
      };
      io.emit("leaderboards_update", { allTime, thisWeek });
    }, 5000);
  };

  const checkAchievements = (userId: string) => {
    const user = getUser(userId) as any;
    if (!user) return;

    // Convert to dollars for achievement threshold checks (achievements.ts uses dollar values)
    const userDollars = userToClient(user);
    const currentAchievements = getAchievements(userId).map((a: any) => a.achievement_id);
    const newlyAwarded = [];

    for (const achievement of ACHIEVEMENTS) {
      if (!currentAchievements.includes(achievement.id)) {
        if (achievement.requirement(userDollars)) {
          awardAchievement(userId, achievement.id);
          newlyAwarded.push(achievement);
        }
      }
    }

    if (newlyAwarded.length > 0) {
      const socketId = userSockets.get(userId);
      if (socketId) {
        newlyAwarded.forEach(achievement => {
          io.to(socketId).emit("achievement_unlocked", { id: achievement.id });
        });
        // Also send updated achievements list
        io.to(socketId).emit("user_achievements", getAchievements(userId));
      }
    }
  };

  // Broadcast every 30 seconds
  const leaderboardInterval = setInterval(broadcastLeaderboards, 30000);

  // Safe helper: emit user_data only if user still exists (converts to dollars for client)
  const emitUserData = (socket: any, userId: string) => {
    const user = getUser(userId);
    if (user) socket.emit('user_data', userToClient(user));
  };
  const emitUserDataTo = (socketId: string, userId: string) => {
    const user = getUser(userId);
    if (user) io.to(socketId).emit('user_data', userToClient(user));
  };

  // Graceful shutdown
  const shutdown = () => {
    clearInterval(leaderboardInterval);
    io.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  io.use((socket: any, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication error"));

    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
      if (err) return next(new Error("Authentication error"));
      const user = getUser(decoded.id) as any;
      if (!user || user.is_banned) return next(new Error("Authentication error"));
      socket.user = user;
      next();
    });
  });

  // --- Crash Game Logic ---
  let crashMultiplier = 1.0;
  let crashState: 'waiting' | 'running' | 'crashed' = 'waiting';
  let crashBets = new Map<string, { userId: string, betAmount: number, username: string, cashedOut: boolean, payout: number, autoCashout: number }>();
  let crashHistory: number[] = [];
  const crashBetsDollars = () => Array.from(crashBets.values()).map(b => ({ ...b, betAmount: b.betAmount / 100, payout: b.payout / 100 }));
  let crashWaitTime = 8; // seconds to wait before starting
  let crashCurrentWait = 0;
  let crashPoints: { x: number, y: number }[] = [];
  let crashTickInterval: ReturnType<typeof setInterval> | null = null;

  const runCrashGame = () => {
    crashState = 'running';
    crashMultiplier = 1.0;
    crashPoints = [{ x: 0, y: 1.0 }];

    const pfSeed = pfGenSeed();
    const pfSeedHash = pfHash(pfSeed);
    const pfRound = pfRoundId();
    io.emit('crash:round_seed', { roundId: pfRound, serverSeedHash: pfSeedHash });

    // Determine crash point using a common formula: 0.99 / (1 - X) where X is a random number [0, 1)
    // This gives a house edge of ~1%.
    const crashPoint = Math.max(1.0, 0.99 / (1 - Math.random()));
    
    if (crashTickInterval) { clearInterval(crashTickInterval); crashTickInterval = null; }

    crashTickInterval = setInterval(() => {
      if (crashState !== 'running') {
        clearInterval(crashTickInterval!); crashTickInterval = null;
        return;
      }

      if (crashMultiplier >= crashPoint) {
        clearInterval(crashTickInterval!); crashTickInterval = null;
        crashState = 'crashed';
        crashHistory.unshift(Number(crashMultiplier.toFixed(2)));
        if (crashHistory.length > 20) crashHistory.pop();

        crashBets.forEach((bet, bUserId) => {
          try { recordProvablyFair(bUserId, 'crash', `${pfRound}_${bUserId}`, pfSeed, pfSeedHash, 'house', JSON.stringify({ crashPoint: Number(crashMultiplier.toFixed(2)), betAmount: bet.betAmount / 100, cashedOut: bet.cashedOut, payout: bet.payout / 100 })); } catch (e) { logError('crash:provably_fair', e, { userId: bUserId, round: pfRound }); }
        });
        io.emit('crash:round_reveal', { roundId: pfRound, serverSeed: pfSeed });
        io.emit("crash:crashed", { multiplier: crashMultiplier, history: crashHistory });
        setTimeout(startWaitingPhase, 3000);
        return;
      }

      const baseIncrement = 0.01 * Math.pow(crashMultiplier, 0.5);
      let speedFactor = 1.0;
      if (crashMultiplier > 5.0) {
        speedFactor = 1.0 + (crashMultiplier - 5.0) * 0.2;
      }
      crashMultiplier += baseIncrement * speedFactor;
      const x = crashPoints.length * 0.1;
      crashPoints.push({ x, y: crashMultiplier });

      // Handle Auto Cashouts
      crashBets.forEach((bet, bUserId) => {
        if (!bet.cashedOut && bet.autoCashout > 1 && crashMultiplier >= bet.autoCashout) {
          const payoutCents = Math.round(bet.betAmount * bet.autoCashout);
          adjustCredits(bUserId, payoutCents, "crash:win");
          bet.cashedOut = true;
          bet.payout = payoutCents;
          if (bet.autoCashout >= 3) processChallengeProgress(bUserId, 'crash_cashout_3x');

          const userSocketId = userSockets.get(bUserId);
          if (userSocketId) {
            const userSocket = io.sockets.sockets.get(userSocketId);
            if (userSocket) {
              emitUserData(userSocket, bUserId);
              userSocket.emit("crash:cashout_success", { payout: payoutCents / 100, multiplier: bet.autoCashout });
            }
          }
          io.emit("crash:bets_update", crashBetsDollars());
        }
      });

      io.emit("crash:tick", { multiplier: crashMultiplier, x });
    }, 100);

    io.emit("crash:start");
  };

  const startWaitingPhase = () => {
    crashState = 'waiting';
    crashBets.clear();
    crashCurrentWait = crashWaitTime;
    crashPoints = [];
    io.emit("crash:bets_update", []);
    
    const waitInterval = setInterval(() => {
      if (crashState !== 'waiting') {
        clearInterval(waitInterval);
        return;
      }
      
      crashCurrentWait--;
      io.emit("crash:waiting", { timeLeft: crashCurrentWait });
      
      if (crashCurrentWait <= 0) {
        clearInterval(waitInterval);
        runCrashGame();
      }
    }, 1000);
  };

  // --- Roulette Game Logic ---
  let rouletteState: 'waiting' | 'spinning' | 'result' = 'waiting';
  let rouletteBets = new Map<string, { userId: string, betAmount: number, username: string, type: string, value: any }>();
  let rouletteHistory: { number: number, color: string }[] = [];
  const rouletteBetsDollars = () => Array.from(rouletteBets.values()).map(b => ({ ...b, betAmount: b.betAmount / 100 }));
  let rouletteWaitTime = 10; // seconds to wait before starting
  let rouletteCurrentWait = 0;
  let lastRouletteResult: { number: number, color: string } | null = null;

  const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

  const runRouletteGame = () => {
    rouletteState = 'spinning';
    const resultNumber = Math.floor(Math.random() * 37);
    const isRed = RED_NUMBERS.includes(resultNumber);
    const isBlack = resultNumber !== 0 && !isRed;
    const color = resultNumber === 0 ? 'green' : isRed ? 'red' : 'black';

    io.emit("roulette:spin_start", { resultNumber });

    // Wait for animation (4 seconds)
    setTimeout(() => {
      rouletteState = 'result';
      lastRouletteResult = { number: resultNumber, color };
      rouletteHistory.unshift({ number: resultNumber, color });
      if (rouletteHistory.length > 15) rouletteHistory.pop();

      // Calculate results
      rouletteBets.forEach((bet) => {
        let win = false;
        let multiplier = 0;
        let isStraight = false;

        switch (bet.type) {
          case 'red': if (isRed) { win = true; multiplier = 2; } break;
          case 'black': if (isBlack) { win = true; multiplier = 2; } break;
          case 'green': if (resultNumber === 0) { win = true; multiplier = 36; isStraight = true; } break;
          case 'straight': if (parseInt(bet.value) === resultNumber) { win = true; multiplier = 36; isStraight = true; } break;
          case 'even': if (resultNumber !== 0 && resultNumber % 2 === 0) { win = true; multiplier = 2; } break;
          case 'odd': if (resultNumber !== 0 && resultNumber % 2 !== 0) { win = true; multiplier = 2; } break;
          case 'low': if (resultNumber >= 1 && resultNumber <= 18) { win = true; multiplier = 2; } break;
          case 'high': if (resultNumber >= 19 && resultNumber <= 36) { win = true; multiplier = 2; } break;
          case 'dozen1': if (resultNumber >= 1 && resultNumber <= 12) { win = true; multiplier = 3; } break;
          case 'dozen2': if (resultNumber >= 13 && resultNumber <= 24) { win = true; multiplier = 3; } break;
          case 'dozen3': if (resultNumber >= 25 && resultNumber <= 36) { win = true; multiplier = 3; } break;
        }

        if (win) {
          const winningsCents = Math.round(bet.betAmount * multiplier);
          adjustCredits(bet.userId, winningsCents, "roulette:win");
          updateStats(bet.userId, {
            roulette_wins: 1,
            max_roulette_win: winningsCents,
            ...(isStraight ? { roulette_straight_wins: 1 } : {})
          });
          processChallengeProgress(bet.userId, 'roulette_win_count');

          const userSocketId = userSockets.get(bet.userId);
          if (userSocketId) {
            const userSocket = io.sockets.sockets.get(userSocketId);
            if (userSocket) {
              userSocket.emit("user_data", userToClient(getUser(bet.userId)));
              userSocket.emit("roulette:win_success", { winnings: winningsCents / 100 });
            }
          }
          checkAchievements(bet.userId);
        }
      });

      io.emit("roulette:result", {
        number: resultNumber,
        color,
        history: rouletteHistory,
        bets: rouletteBetsDollars()
      });

      // Wait and restart
      setTimeout(startRouletteWaitingPhase, 5000);
    }, 4000);
  };

  const startRouletteWaitingPhase = () => {
    rouletteState = 'waiting';
    rouletteBets.clear();
    rouletteCurrentWait = rouletteWaitTime;
    io.emit("roulette:bets_update", []);
    
    const waitInterval = setInterval(() => {
      if (rouletteState !== 'waiting') {
        clearInterval(waitInterval);
        return;
      }
      
      rouletteCurrentWait--;
      io.emit("roulette:waiting", { timeLeft: rouletteCurrentWait });
      
      if (rouletteCurrentWait <= 0) {
        clearInterval(waitInterval);
        runRouletteGame();
      }
    }, 1000);
  };

  // Start the first cycle
  startWaitingPhase();
  startRouletteWaitingPhase();

  // ============ DAILY CHALLENGES ============
  const CHALLENGE_POOL = [
    { key: 'crash_3x', description: 'Cash out at 3x or higher on Crash', target_type: 'crash_cashout_3x', target_value: 1, reward: 50000 },
    { key: 'cases_5', description: 'Open 5 Cases', target_type: 'cases_open_count', target_value: 5, reward: 30000 },
    { key: 'bj_win', description: 'Win a hand at Blackjack', target_type: 'blackjack_win_count', target_value: 1, reward: 20000 },
    { key: 'plinko_5x', description: 'Hit a 5x multiplier or higher on Plinko', target_type: 'plinko_hit_5x', target_value: 1, reward: 40000 },
    { key: 'slots_fs', description: 'Trigger Free Spins in Slots', target_type: 'slots_free_spins', target_value: 1, reward: 35000 },
    { key: 'roulette_win', description: 'Win a Roulette bet', target_type: 'roulette_win_count', target_value: 1, reward: 15000 },
    { key: 'mines_3', description: 'Reveal 3 or more gems in a single Mines game', target_type: 'mines_gems_revealed', target_value: 3, reward: 25000 },
    { key: 'wheel_2x', description: 'Land a 2x or higher multiplier on the Wheel', target_type: 'wheel_hit_2x', target_value: 1, reward: 17500 },
  ];

  const seedDailyChallenges = () => {
    const today = new Date().toISOString().split('T')[0];
    const dayHash = createHash('md5').update(today).digest('hex');
    const indices: number[] = [];
    for (let i = 0; indices.length < 3 && i < 64; i++) {
      const idx = parseInt(dayHash.substring(i * 2, i * 2 + 2), 16) % CHALLENGE_POOL.length;
      if (!indices.includes(idx)) indices.push(idx);
    }
    for (const idx of indices) {
      const c = CHALLENGE_POOL[idx];
      upsertDailyChallenge(`${today}_${c.key}`, c.description, c.target_type, c.target_value, c.reward, today);
    }
  };
  seedDailyChallenges();

  const msUntilMidnight = () => {
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return midnight.getTime() - now.getTime();
  };
  const scheduleMidnightReset = () => {
    setTimeout(() => { seedDailyChallenges(); io.emit('challenges:reset'); scheduleMidnightReset(); }, msUntilMidnight());
  };
  scheduleMidnightReset();

  const processChallengeProgress = (userId: string, targetType: string, value: number = 1) => {
    try {
      const challenges = getTodayChallenges();
      for (const challenge of challenges) {
        if (challenge.target_type !== targetType) continue;
        const row = incrementChallengeProgress(userId, challenge.id, value);
        if (!row) continue;
        if (row.progress >= challenge.target_value && row.completed < 1) {
          markChallengeCompleted(userId, challenge.id);
          adjustCredits(userId, challenge.reward, 'challenge:reward'); // reward already in cents from db
          markChallengeRewardClaimed(userId, challenge.id);
          const sid = userSockets.get(userId);
          if (sid) {
            io.to(sid).emit('user_data', userToClient(getUser(userId)));
            io.to(sid).emit('challenge:completed', { challengeId: challenge.id, reward: challenge.reward / 100, description: challenge.description });
          }
        } else {
          const sid = userSockets.get(userId);
          if (sid) io.to(sid).emit('challenge:progress', { challengeId: challenge.id, progress: row.progress, target: challenge.target_value });
        }
      }
    } catch (e) { logError('challenge:progress', e, { userId }); }
  };

  // ============ END DAILY CHALLENGES ============

  // --- Jackpot Helper ---
  let lastEmittedJackpot = 0;
  const checkJackpot = (userId: string, username: string, betCents: number, game: string = 'unknown') => {
    addToJackpot(Math.round(betCents * 0.01)); // 1% of bet in cents
    const newJackpot = getJackpot(); // cents
    if (Math.abs(newJackpot - lastEmittedJackpot) >= 100) { // threshold in cents (~$1)
      lastEmittedJackpot = newJackpot;
      io.emit("jackpot:update", getJackpotDollars());
    }
    if (Math.random() < 0.0002) {
      const wonAmountDollars = newJackpot / 100;
      adjustCredits(userId, newJackpot, "jackpot:win");
      resetJackpot();
      io.emit("jackpot:winner", { username, amount: wonAmountDollars });
      io.emit("jackpot:update", getJackpotDollars());
    }
  };

  // --- Multiplayer Blackjack Tables ---
  const bjTables: BlackjackTable[] = [];
  const playerTableMap = new Map<string, string>(); // userId → tableId
  const broadcastLobby = () => io.emit('blackjack:lobby', bjTables.map(t => t.getLobbyInfo()));
  const bjDeps: any = { adjustCredits, updateStats, activityHistory, checkAchievements, broadcastLeaderboards, getUser, checkJackpot, broadcastLobby, processChallengeProgress };
  for (const id of ['1', '2', '3']) bjTables.push(new BlackjackTable(id, io, userSockets, bjDeps));

  // --- Socket Rate Limiter ---
  // Prevents bots from spamming game events; limit: 20 actions per 2 seconds per user
  const socketRateLimits = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of socketRateLimits.entries()) {
      if (now > entry.resetAt) socketRateLimits.delete(key);
    }
  }, 30000);
  const socketRateLimit = (userId: string, action: string, limit = 20, windowMs = 2000): boolean => {
    const key = `${userId}:${action}`;
    const now = Date.now();
    const entry = socketRateLimits.get(key);
    if (!entry || now > entry.resetAt) {
      socketRateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count++;
    return true;
  };

  // Helper: log error and forward to client
  const socketError = (socket: any, err: any, context: string) => {
    logError(context, err, { userId: socket.user?.id, username: socket.user?.username });
    socket.emit('error', err.message || 'An error occurred');
  };

  io.on("connection", (socket: any) => {
    const userId = socket.user.id;

    // 1. Kick older session if exists
    const oldSocketId = userSockets.get(userId);
    if (oldSocketId) {
      io.to(oldSocketId).emit("session:kicked");
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) oldSocket.disconnect();
    }

    // 2. Register new socket
    userSockets.set(userId, socket.id);
    broadcastOnline();

    // 3. Initial Data
    socket.emit("server:version", SERVER_VERSION);
    socket.emit("user_data", userToClient(socket.user));
    socket.emit("user_achievements", getAchievements(userId));
    socket.emit("challenges:data", getUserChallengeProgress(userId).map((c: any) => ({ ...c, reward: c.reward / 100 })));
    const savedFs = getFreeSpins(userId);
    if (savedFs && savedFs.count > 0) {
      socket.emit("slots:free_spins_restored", { count: savedFs.count, betAmount: savedFs.bet_amount / 100 });
    }
    socket.emit("activity:history", activityHistory);
    socket.emit("jackpot:update", getJackpotDollars());
    broadcastLeaderboards();
    
    // Initial Crash Data
    socket.emit("crash:sync", {
      state: crashState,
      multiplier: crashMultiplier,
      history: crashHistory,
      timeLeft: crashCurrentWait,
      points: crashPoints,
      bets: crashBetsDollars()
    });
    const initActiveBet = crashBets.get(userId);
    if (initActiveBet && !initActiveBet.cashedOut) {
      socket.emit("crash:bet_restored", { betAmount: initActiveBet.betAmount / 100 });
    }

    socket.on("crash:join", () => {
      socket.emit("crash:sync", {
        state: crashState,
        multiplier: crashMultiplier,
        history: crashHistory,
        timeLeft: crashCurrentWait,
        points: crashPoints,
        bets: crashBetsDollars()
      });
      const myActiveBet = crashBets.get(userId);
      if (myActiveBet && !myActiveBet.cashedOut) {
        socket.emit("crash:bet_restored", { betAmount: myActiveBet.betAmount / 100 });
      }
      if (crashState === 'crashed') {
        socket.emit("crash:crashed", { multiplier: crashMultiplier, history: crashHistory });
      }
    });

    socket.on("challenges:get", () => {
      socket.emit("challenges:data", getUserChallengeProgress(userId).map((c: any) => ({ ...c, reward: c.reward / 100 })));
    });

    // --- Crash Handlers ---
    socket.on("crash:cancel_bet", () => {
      if (crashState !== 'waiting') return socket.emit("error", "Game already in progress");
      const bet = crashBets.get(userId);
      if (!bet) return socket.emit("error", "No active bet to cancel");

      try {
        adjustCredits(userId, bet.betAmount, "crash:cancel_bet");
        crashBets.delete(userId);

        socket.emit("user_data", userToClient(getUser(userId)));
        io.emit("crash:bets_update", crashBetsDollars());
      } catch (err: any) {
        socketError(socket, err, 'crash:cancel_bet');
      }
    });

    socket.on("crash:bet", (data: { betAmount: number, autoCashout?: number }) => {
      if (!socketRateLimit(userId, 'crash:bet', 5, 2000)) return socket.emit("error", "Too many requests");
      if (crashState !== 'waiting') return socket.emit("error", "Game already in progress");
      if (crashBets.has(userId)) return socket.emit("error", "Already placed a bet");

      const { betAmount, autoCashout } = data; // betAmount in dollars from client
      if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      if (betAmount > 100000) return socket.emit("error", "Maximum bet is $100,000");
      const betCents = Math.round(betAmount * 100);

      try {
        adjustCredits(userId, -betCents, "crash:bet");
        checkJackpot(userId, socket.user.username, betCents, 'crash');
        crashBets.set(userId, {
          userId,
          betAmount: betCents,
          username: socket.user.username,
          cashedOut: false,
          payout: 0,
          autoCashout: autoCashout || 0
        });

        socket.emit("user_data", userToClient(getUser(userId)));
        io.emit("crash:bets_update", crashBetsDollars());
        checkAchievements(userId);
      } catch (err: any) {
        socketError(socket, err, 'crash:bet');
      }
    });

// --- Plinko Logic ---
const MULTIPLIERS: Record<number, Record<string, number[]>> = {
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

function generatePlinkoPath(rows: number) {
  let offset = 0;
  const path = [];
  for (let i = 0; i < rows; i++) {
    let rightChance = 0.5;
    // Stronger bias towards center
    if (offset < 0) rightChance = 0.55;
    else if (offset > 0) rightChance = 0.45;
    
    const goRight = Math.random() < rightChance;
    path.push(goRight ? 1 : -1);
    offset += (goRight ? 1 : -1);
  }
  const slot = (offset + rows) / 2;
  return { path, slot };
}

    // --- Case Opening Handlers ---
    socket.on("case:open", (data: { betAmount: number, count: number }) => {
      if (!socketRateLimit(userId, 'case:open')) return socket.emit("error", "Too many requests");
      let { betAmount, count } = data; // betAmount in dollars from client
      if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      if (betAmount > 100000) return socket.emit("error", "Maximum bet is $100,000");
      count = Math.max(1, Math.min(5, count)); // Clamp count to 1-5
      const betCents = Math.round(betAmount * 100);
      const totalBetCents = betCents * count;

      try {
        const user = getUser(userId) as any;
        if (user.credits < totalBetCents) return socket.emit("error", "Insufficient credits");

        // Deduct bet
        adjustCredits(userId, -totalBetCents, "case:bet");
        checkJackpot(userId, socket.user.username, totalBetCents, 'cases');

        const results = [];
        let totalWinningsCents = 0;

        for (let i = 0; i < count; i++) {
          const item = rollItem();
          const winAmountCents = Math.round(betCents * item.multiplier);
          totalWinningsCents += winAmountCents;
          results.push({ item, winAmount: winAmountCents / 100 }); // dollars for client
        }

        if (totalWinningsCents > 0) {
          adjustCredits(userId, totalWinningsCents, "case:win");
        }

        const pfRound = pfRoundId(); const pfSeed = pfGenSeed();
        try { recordProvablyFair(userId, 'cases', pfRound, pfSeed, pfHash(pfSeed), `${userId}_${Date.now()}`, JSON.stringify({ results, totalWinnings: totalWinningsCents / 100, betAmount, count })); } catch (e) { logError('cases:provably_fair', e, { userId, round: pfRound }); }

        processChallengeProgress(userId, 'cases_open_count', count);

        const updatedUser = getUser(userId) as any;

        socket.emit("case:result", {
          results,
          totalWinnings: totalWinningsCents / 100, // dollars for client
          newCredits: updatedUser.credits / 100 // dollars for client
        });

        // Queue activity — broadcast after frontend animation completes via activity:reveal
        const netCents = totalWinningsCents - totalBetCents;
        if (netCents !== 0) {
          const activity = {
            id: Math.random().toString(36).substr(2, 9),
            username: socket.user.username,
            amount: Math.abs(netCents) / 100, // dollars for client
            type: netCents > 0 ? "win" : "loss",
            game: 'Cases',
            timestamp: Date.now()
          };
          const existing = pendingWins.get(userId) || [];
          existing.push(activity);
          pendingWins.set(userId, existing);
        }

      } catch (err: any) {
        socketError(socket, err, 'case:open');
      }
    });

    // --- Plinko Handlers ---
    socket.on("plinko:drop", (data: { betAmount: number, risk: string, rows: number }) => {
      if (!socketRateLimit(userId, 'plinko:drop')) return socket.emit("error", "Too many requests");
      const { betAmount, risk, rows } = data; // betAmount in dollars from client
      if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      if (betAmount > 100000) return socket.emit("error", "Maximum bet is $100,000");
      const betCents = Math.round(betAmount * 100);

      try {
        const user = getUser(userId) as any;
        if (user.credits < betCents) return socket.emit("error", "Insufficient credits");

        // Deduct bet
        adjustCredits(userId, -betCents, "plinko:bet");
        checkJackpot(userId, socket.user.username, betCents, 'plinko');

        // Generate result
        const { path, slot } = generatePlinkoPath(rows);
        const multiplier = MULTIPLIERS[rows]?.[risk]?.[slot] || 0;
        const winningsCents = Math.round(betCents * multiplier);

        const pfRound = pfRoundId(); const pfSeed = pfGenSeed();
        try { recordProvablyFair(userId, 'plinko', pfRound, pfSeed, pfHash(pfSeed), `${userId}_${Date.now()}`, JSON.stringify({ multiplier, winAmount: winningsCents / 100, betAmount })); } catch (e) { logError('plinko:provably_fair', e, { userId, round: pfRound }); }

        if (multiplier >= 5) processChallengeProgress(userId, 'plinko_hit_5x');

        const dropId = Math.random().toString(36).substr(2, 9);
        pendingPlinkoDrops.set(dropId, {
          userId,
          winnings: winningsCents,
          betAmount: betCents,
          net: winningsCents - betCents,
          multiplier,
          username: socket.user.username
        });

        socket.emit("user_data", userToClient(getUser(userId)));

        // Emit result (dollars for client)
        socket.emit("plinko:result", {
          id: dropId,
          path,
          slot,
          multiplier,
          winnings: winningsCents / 100,
          newCredits: (getUser(userId) as any).credits / 100,
          risk,
          rows,
          betAmount
        });
      } catch (err: any) {
        socketError(socket, err, 'plinko:drop');
      }
    });

    socket.on("plinko:landed", (data: { id: string }) => {
      try {
        const pendingDrop = pendingPlinkoDrops.get(data.id);
        if (!pendingDrop || pendingDrop.userId !== userId) return;

        pendingPlinkoDrops.delete(data.id);

        if (pendingDrop.winnings > 0) {
          adjustCredits(userId, pendingDrop.winnings, "plinko:win"); // winnings in cents
          updateStats(userId, { max_plinko_multiplier: pendingDrop.multiplier });
        }

        socket.emit("user_data", userToClient(getUser(userId)));

        checkAchievements(userId);

        // Activity Feed (dollars for client)
        if (pendingDrop.net !== 0) {
          const activity = {
            id: Math.random().toString(36).substr(2, 9),
            username: pendingDrop.username,
            type: pendingDrop.net > 0 ? 'win' : 'loss',
            amount: Math.abs(pendingDrop.net) / 100,
            game: 'Plinko',
            timestamp: Date.now()
          };
          activityHistory.unshift(activity);
          if (activityHistory.length > 50) activityHistory.pop();
          io.emit("activity:new", activity);
        }

        broadcastLeaderboards();
      } catch (err: any) {
        logError('plinko:landed', err, { userId });
      }
    });

    socket.on("plinko:drop-multi", (data: { betAmount: number, risk: string, rows: number, count: number }) => {
      const { betAmount, risk, rows, count } = data; // betAmount in dollars
      if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      if (betAmount > 100000) return socket.emit("error", "Maximum bet is $100,000");
      if (count < 1 || count > 10) return socket.emit("error", "Invalid count (max 10)");
      const betCents = Math.round(betAmount * 100);
      const totalBetCents = betCents * count;

      try {
        const user = getUser(userId) as any;
        if (user.credits < totalBetCents) return socket.emit("error", "Insufficient credits");

        // Deduct total bet
        adjustCredits(userId, -totalBetCents, "plinko:bet-multi");
        checkJackpot(userId, socket.user.username, totalBetCents, 'plinko');

        const results = [];

        for (let i = 0; i < count; i++) {
          const { path, slot } = generatePlinkoPath(rows);
          const multiplier = MULTIPLIERS[rows]?.[risk]?.[slot] || 0;
          const winningsCents = Math.round(betCents * multiplier);

          const dropId = Math.random().toString(36).substr(2, 9);
          pendingPlinkoDrops.set(dropId, {
            userId,
            winnings: winningsCents,
            betAmount: betCents,
            net: winningsCents - betCents,
            multiplier,
            username: socket.user.username
          });

          results.push({
            id: dropId,
            path,
            slot,
            multiplier,
            winnings: winningsCents / 100, // dollars for client
            risk,
            rows,
            betAmount // dollars for client
          });
        }

        const updatedUser = getUser(userId) as any;
        socket.emit("user_data", userToClient(updatedUser));

        // Emit results
        socket.emit("plinko:result-multi", {
          results,
          newCredits: updatedUser.credits / 100
        });
      } catch (err: any) {
        socketError(socket, err, 'plinko:drop-multi');
      }
    });

    socket.on("crash:cashout", () => {
      if (crashState !== 'running') return socket.emit("error", "Game not running");
      const bet = crashBets.get(userId);
      if (!bet || bet.cashedOut) return socket.emit("error", "No active bet or already cashed out");

      const payoutCents = Math.round(bet.betAmount * crashMultiplier);
      bet.cashedOut = true;
      bet.payout = payoutCents;

      adjustCredits(userId, payoutCents, "crash:win");
      updateStats(userId, { max_crash_multiplier: crashMultiplier });
      if (crashMultiplier >= 3) processChallengeProgress(userId, 'crash_cashout_3x');

      socket.emit("user_data", userToClient(getUser(userId)));
      io.emit("crash:bets_update", crashBetsDollars());
      socket.emit("crash:cashout_success", { payout: payoutCents / 100, multiplier: crashMultiplier });

      checkAchievements(userId);

      // Record activity (amounts in dollars for client)
      const netCents = payoutCents - bet.betAmount;
      const winActivity = {
        id: Math.random().toString(36).substr(2, 9),
        username: socket.user.username,
        amount: netCents / 100,
        type: "win",
        game: 'Crash',
        timestamp: Date.now(),
      };
      activityHistory.unshift(winActivity);
      if (activityHistory.length > 50) activityHistory.pop();
      io.emit("activity:new", winActivity);
      broadcastLeaderboards();
    });

    // --- Game Handlers ---
    socket.on("slots:spin", async (data: { betAmount: number; featureBuy?: boolean }) => {
      if (!socketRateLimit(userId, 'slots:spin')) return socket.emit("error", "Too many requests");
      const { betAmount, featureBuy = false } = data; // betAmount in dollars from client
      try {
        const user = getUser(userId) as any;
        if (!user) return socket.emit("error", "User not found");

        let isFreeSpin = false;
        let effectiveBetCents: number;

        if (betAmount === 0) {
          // Free spin — must have server-tracked free spins
          const fs = getFreeSpins(userId);
          if (!fs || fs.count <= 0) return socket.emit("error", "No free spins available");
          isFreeSpin = true;
          effectiveBetCents = fs.bet_amount; // already in cents
          if (fs.count - 1 <= 0) clearFreeSpins(userId);
          else setFreeSpins(userId, fs.count - 1, fs.bet_amount);
        } else {
          if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
          if (betAmount > 100000) return socket.emit("error", "Maximum bet is $100,000");
          effectiveBetCents = Math.round(betAmount * 100);
          adjustCredits(userId, -effectiveBetCents, "slots:bet");
          checkJackpot(userId, socket.user.username, effectiveBetCents, 'slots');
        }

        // Server generates grid and computes full outcome (tumble cascade) — bet in cents
        const outcome = calcSlotOutcome(effectiveBetCents, isFreeSpin, featureBuy ? 4 : 0);

        const pfRound = pfRoundId();
        const pfSeed = pfGenSeed();
        const pfSeedHash = pfHash(pfSeed);
        try { recordProvablyFair(userId, 'slots', pfRound, pfSeed, pfSeedHash, `${userId}_${Date.now()}`, JSON.stringify({ totalWin: outcome.totalWin / 100, betAmount: effectiveBetCents / 100, isFreeSpin })); } catch (e) { logError('slots:provably_fair', e, { userId, round: pfRound }); }

        if (outcome.totalWin > 0) {
          adjustCredits(userId, outcome.totalWin, isFreeSpin ? "slots:freespin_win" : "slots:win");
        }

        if (outcome.freeSpinsTriggered) processChallengeProgress(userId, 'slots_free_spins');

        // Store triggered free spins server-side (bet_amount in cents)
        if (outcome.freeSpinsTriggered || outcome.freeSpinCount > 0) {
          const existingFs = getFreeSpins(userId);
          const newCount = (existingFs?.count ?? 0) + outcome.freeSpinCount;
          const newBet = existingFs?.bet_amount || effectiveBetCents;
          setFreeSpins(userId, newCount, newBet);
        }
        const savedFsAfter = getFreeSpins(userId);
        const remainingFreeSpins = savedFsAfter?.count ?? 0;

        socket.emit("user_data", userToClient(getUser(userId)));
        socket.emit("slots:result", {
          grid: outcome.grid,
          totalWin: outcome.totalWin / 100, // dollars for client
          freeSpinsTriggered: outcome.freeSpinsTriggered,
          freeSpinCount: outcome.freeSpinCount,
          remainingFreeSpins,
          roundId: pfRound,
        });

        // Record activity (dollars for client)
        const netCents = outcome.totalWin - (isFreeSpin ? 0 : effectiveBetCents);
        if (netCents !== 0) {
          const act = {
            id: Math.random().toString(36).substr(2, 9),
            username: socket.user.username,
            amount: Math.abs(netCents) / 100,
            type: netCents > 0 ? "win" : "loss",
            game: 'Slots',
            timestamp: Date.now(),
          };
          activityHistory.unshift(act);
          if (activityHistory.length > 50) activityHistory.pop();
          io.emit("activity:new", act);
        }

        broadcastLeaderboards();
      } catch (err: any) {
        socketError(socket, err, 'slots:spin');
      }
    });

    socket.on("blackjack:bet", (data: { amount: number }) => {
      const { amount } = data; // dollars from client
      const amountCents = Math.round(amount * 100);
      try {
        adjustCredits(userId, -amountCents, "blackjack:bet");
        checkJackpot(userId, socket.user.username, amountCents, 'blackjack');
        socket.emit("user_data", userToClient(getUser(userId)));
        broadcastLeaderboards();
        checkAchievements(userId);
      } catch (err: any) {
        socketError(socket, err, 'blackjack:bet');
      }
    });

    // wins:reveal is intentionally disabled — slots outcomes are now server-authoritative via slots:spin
    socket.on("wins:reveal", () => { /* no-op: exploit patched */ });

    socket.on("activity:reveal", () => {
      const pending = pendingWins.get(userId) || [];
      pendingWins.delete(userId);
      for (const activity of pending) {
        activityHistory.unshift(activity);
        if (activityHistory.length > 50) activityHistory.pop();
        io.emit("activity:new", activity);
      }
      // Check achievements after animation completes (all games that use pendingWins)
      checkAchievements(userId);
    });

    socket.on("roulette:bet", (data: { amount: number, type: string, value: any }) => {
      if (!socketRateLimit(userId, 'roulette:bet', 30, 2000)) return socket.emit("error", "Too many requests");
      if (rouletteState !== 'waiting') return socket.emit("error", "Betting is closed");
      const { amount, type, value } = data; // amount in dollars from client
      if (amount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      if (amount > 100000) return socket.emit("error", "Maximum bet is $100,000");
      const amountCents = Math.round(amount * 100);

      try {
        const user = getUser(userId) as any;
        if (!user) return socket.emit("error", "User not found");
        if (user.credits < amountCents) return socket.emit("error", "Insufficient credits");

        const betKey = `${userId}_${type}_${value}`;
        const existingBet = rouletteBets.get(betKey);

        adjustCredits(userId, -amountCents, "roulette:bet");
        checkJackpot(userId, socket.user.username, amountCents, 'roulette');

        if (existingBet) {
          existingBet.betAmount += amountCents;
        } else {
          rouletteBets.set(betKey, {
            userId,
            betAmount: amountCents,
            username: socket.user.username,
            type,
            value
          });
        }

        socket.emit("user_data", userToClient(getUser(userId)));
        io.emit("roulette:bets_update", rouletteBetsDollars());
        checkAchievements(userId);
      } catch (err: any) {
        socketError(socket, err, 'roulette:bet');
      }
    });

    socket.on("roulette:remove_bet", (data: { type: string, value: any }) => {
      if (rouletteState !== 'waiting') return socket.emit("error", "Betting is closed");
      const { type, value } = data;
      const betKey = `${userId}_${type}_${value}`;

      const bet = rouletteBets.get(betKey);
      if (!bet) return socket.emit("error", "Bet not found");
      if (bet.userId !== userId) return socket.emit("error", "Unauthorized");

      try {
        adjustCredits(userId, bet.betAmount, "roulette:refund");
        rouletteBets.delete(betKey);

        socket.emit("user_data", userToClient(getUser(userId)));
        io.emit("roulette:bets_update", rouletteBetsDollars());
      } catch (err: any) {
        socketError(socket, err, 'roulette:remove_bet');
      }
    });

    socket.on("roulette:join", () => {
      socket.emit("roulette:sync", {
        state: rouletteState,
        timeLeft: rouletteCurrentWait,
        history: rouletteHistory,
        bets: rouletteBetsDollars(),
        lastResult: lastRouletteResult
      });
    });

    socket.on("chat:message", (text: string) => {
      if (!socketRateLimit(userId, 'chat:message', 5, 3000)) return socket.emit("error", "Slow down — too many messages");
      if (typeof text !== 'string' || text.trim().length === 0 || text.length > 500) return;
      const message = {
        id: Math.random().toString(36).substr(2, 9),
        username: socket.user.username,
        text: text.trim().slice(0, 500),
        timestamp: Date.now(),
      };
      io.emit("chat:new", message);
    });

    // --- Multiplayer Blackjack Handlers ---
    const getMyBjTable = () => bjTables.find(t => t.tableId === playerTableMap.get(userId));

    socket.on("bj:sync", (data?: { tableId?: string }) => {
      socket.emit('blackjack:lobby', bjTables.map(t => t.getLobbyInfo()));
      const tid = data?.tableId ?? playerTableMap.get(userId);
      if (tid) {
        const table = bjTables.find(t => t.tableId === tid);
        if (table) socket.emit('blackjack:state', table.getState());
      }
    });
    socket.on("bj:sit", (data: { tableId: string; seatIndex: number }) => {
      const table = bjTables.find(t => t.tableId === data.tableId);
      if (!table) return socket.emit('error', 'Invalid table');
      // Leave previous table if different
      const prevTableId = playerTableMap.get(userId);
      if (prevTableId && prevTableId !== data.tableId) {
        bjTables.find(t => t.tableId === prevTableId)?.leaveSeat(userId);
        playerTableMap.delete(userId);
      }
      const err = table.joinSeat(userId, socket.user.username, data.seatIndex);
      if (err) socket.emit('error', err);
      else { playerTableMap.set(userId, data.tableId); broadcastLobby(); }
    });
    socket.on("bj:leave", () => {
      const table = getMyBjTable();
      if (table) { table.leaveSeat(userId); playerTableMap.delete(userId); broadcastLobby(); }
    });
    socket.on("bj:bet", (data: { amount: number }) => {
      if (!socketRateLimit(userId, 'bj:bet', 5, 2000)) return socket.emit("error", "Too many requests");
      const table = getMyBjTable();
      if (!table) return socket.emit('error', 'Not seated at a table');
      const err = table.placeBet(userId, data.amount);
      if (err) socket.emit('error', err);
      else checkAchievements(userId);
    });
    socket.on("bj:hit", () => { const err = getMyBjTable()?.hit(userId); if (err) socket.emit('error', err); });
    socket.on("bj:stand", () => { const err = getMyBjTable()?.stand(userId); if (err) socket.emit('error', err); });
    socket.on("bj:double", () => { const err = getMyBjTable()?.double(userId); if (err) socket.emit('error', err); });
    socket.on("bj:split", () => { const err = getMyBjTable()?.split(userId); if (err) socket.emit('error', err); });

    // --- Mines Handlers ---
    socket.on("mines:start", (data: { betAmount: number, mineCount: number }) => {
      if (!socketRateLimit(userId, 'mines:start')) return socket.emit("error", "Too many requests");
      try {
        const { betAmount } = data; // dollars from client
        const mc = Math.min(24, Math.max(1, Math.floor(data.mineCount || 3)));
        if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
        if (betAmount > 100000) return socket.emit("error", "Maximum bet is $100,000");
        const betCents = Math.round(betAmount * 100);
        const user = getUser(userId) as any;
        if (!user || user.credits < betCents) return socket.emit("error", "Insufficient credits");

        activeMinesGames.delete(userId); // cancel any existing game
        const positions = new Set<number>();
        while (positions.size < mc) positions.add(Math.floor(Math.random() * 25));

        adjustCredits(userId, -betCents, "mines:bet");
        checkJackpot(userId, socket.user.username, betCents, 'mines');
        activeMinesGames.set(userId, { betAmount: betCents, mineCount: mc, minePositions: positions, revealedCount: 0, revealedTiles: new Set() });

        socket.emit("user_data", userToClient(getUser(userId)));
        socket.emit("mines:started", { mineCount: mc });
      } catch (err: any) {
        socketError(socket, err, 'mines:start');
      }
    });

    socket.on("mines:reveal", (data: { id: number }) => {
      try {
        const game = activeMinesGames.get(userId);
        if (!game) return socket.emit("error", "No active game");
        const id = Number(data.id);
        if (id < 0 || id >= 25 || game.revealedTiles.has(id)) return;

        if (game.minePositions.has(id)) {
          activeMinesGames.delete(userId);
          // Send boom event first so the animation plays, then queue activity
          socket.emit("mines:boom", { id, minePositions: Array.from(game.minePositions) });
          socket.emit("user_data", userToClient(getUser(userId)));
          const activity = { id: Math.random().toString(36).substr(2,9), username: socket.user.username, amount: game.betAmount / 100, type: 'loss', game: 'Mines', timestamp: Date.now() };
          const existingA = pendingWins.get(userId) || [];
          existingA.push(activity);
          pendingWins.set(userId, existingA);
        } else {
          game.revealedTiles.add(id);
          game.revealedCount++;
          const multiplier = calcMinesMultiplier(game.revealedCount, game.mineCount);
          const allSafeRevealed = game.revealedCount === 25 - game.mineCount;
          if (allSafeRevealed) {
            activeMinesGames.delete(userId);
            const winAmountCents = Math.round(game.betAmount * multiplier);
            adjustCredits(userId, winAmountCents, "mines:win");
            updateStats(userId, { mines_wins: 1 });
            if (game.revealedCount >= 3) processChallengeProgress(userId, 'mines_gems_revealed', game.revealedCount);
            socket.emit("user_data", userToClient(getUser(userId)));
            socket.emit("mines:safe", { id, multiplier, winAmount: winAmountCents / 100, gameOver: true, minePositions: Array.from(game.minePositions) });
            const netCents = winAmountCents - game.betAmount;
            const act = { id: Math.random().toString(36).substr(2,9), username: socket.user.username, amount: Math.abs(netCents) / 100, type: 'win', game: 'Mines', timestamp: Date.now() };
            const existingB = pendingWins.get(userId) || [];
            existingB.push(act);
            pendingWins.set(userId, existingB);
            broadcastLeaderboards();
          } else {
            socket.emit("mines:safe", { id, multiplier, gameOver: false });
          }
        }
      } catch (err: any) {
        socketError(socket, err, 'mines:reveal');
      }
    });

    socket.on("mines:cashout", () => {
      try {
        const game = activeMinesGames.get(userId);
        if (!game || game.revealedCount === 0) return socket.emit("error", "Reveal at least one tile before cashing out");
        const multiplier = calcMinesMultiplier(game.revealedCount, game.mineCount);
        const winAmountCents = Math.round(game.betAmount * multiplier);
        activeMinesGames.delete(userId);
        adjustCredits(userId, winAmountCents, "mines:win");
        updateStats(userId, { mines_wins: 1 });
        if (game.revealedCount >= 3) processChallengeProgress(userId, 'mines_gems_revealed', game.revealedCount);
        socket.emit("user_data", userToClient(getUser(userId)));
        socket.emit("mines:cashout_result", { winAmount: winAmountCents / 100, multiplier, minePositions: Array.from(game.minePositions) });
        const netCents = winAmountCents - game.betAmount;
        const activity = { id: Math.random().toString(36).substr(2,9), username: socket.user.username, amount: Math.abs(netCents) / 100, type: 'win', game: 'Mines', timestamp: Date.now() };
        const existingM = pendingWins.get(userId) || [];
        existingM.push(activity);
        pendingWins.set(userId, existingM);
        broadcastLeaderboards();
      } catch (err: any) {
        socketError(socket, err, 'mines:cashout');
      }
    });

    socket.on("mines:lost", (data: { id: number, betAmount: number }) => {
      try {
        /* no-op: mine hits are now handled server-side in mines:reveal */
        socket.emit("user_data", userToClient(getUser(userId)));
        checkAchievements(userId);
      } catch (err: any) {
        socketError(socket, err, 'mines:lost');
      }
    });

    // --- PVP War Handlers ---
    socket.on("war:pvp_queue", (data: { betAmount: number }) => {
      if (!socketRateLimit(userId, 'war:pvp_queue', 5, 2000)) return socket.emit("error", "Too many requests");
      try {
        const { betAmount } = data; // dollars from client
        if (betAmount <= 0) return socket.emit("error", "Invalid bet");
        if (betAmount > 100000) return socket.emit("error", "Maximum bet is $100,000");
        const betCents = Math.round(betAmount * 100);
        const user = getUser(userId) as any;
        if (!user || user.credits < betCents) return socket.emit("error", "Insufficient credits");

        // Remove any existing queue entry for this user
        warQueue = warQueue.filter(p => p.userId !== userId);

        warQueue.push({ userId, socketId: socket.id, username: socket.user.username, betAmount: betCents });
        socket.emit("war:pvp_queued", { position: warQueue.length });

        // Try to match two players
        if (warQueue.length >= 2) {
          const p1 = warQueue.shift()!;
          const p2 = warQueue.shift()!;
          const roomId = `war_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;

          // Deduct bets
          adjustCredits(p1.userId, -p1.betAmount, "war:pvp_bet");
          adjustCredits(p2.userId, -p2.betAmount, "war:pvp_bet");
          checkJackpot(p1.userId, p1.username, p1.betAmount, 'war');
          checkJackpot(p2.userId, p2.username, p2.betAmount, 'war');

          const card1 = dealWarCardFixed();
          const card2 = dealWarCardFixed();

          warRooms.set(roomId, {
            player1: { ...p1, card: card1, warCard: null },
            player2: { ...p2, card: card2, warCard: null },
            status: 'cards_dealt',
            warDecisions: new Map(),
          });

          // Notify both players they matched
          const s1 = io.sockets.sockets.get(p1.socketId) as any;
          const s2 = io.sockets.sockets.get(p2.socketId) as any;
          if (s1) s1.emit("war:pvp_matched", { roomId, opponent: { username: p2.username } });
          if (s2) s2.emit("war:pvp_matched", { roomId, opponent: { username: p1.username } });

          // Send updated balances
          if (s1) s1.emit("user_data", userToClient(getUser(p1.userId)));
          if (s2) s2.emit("user_data", userToClient(getUser(p2.userId)));

          // Deal cards after short delay (animation)
          setTimeout(() => {
            const room = warRooms.get(roomId);
            if (!room) return;
            const s1 = io.sockets.sockets.get(room.player1.socketId) as any;
            const s2 = io.sockets.sockets.get(room.player2.socketId) as any;
            if (s1) s1.emit("war:pvp_cards", { yourCard: card1, opponentCard: card2, roomId });
            if (s2) s2.emit("war:pvp_cards", { yourCard: card2, opponentCard: card1, roomId });

            // Determine result
            if (card1.value !== card2.value) {
              const p1Wins = card1.value > card2.value;
              setTimeout(() => {
                const room = warRooms.get(roomId);
                if (!room) return;
                const winAmt1 = p1Wins ? p1.betAmount * 2 : 0;
                const winAmt2 = !p1Wins ? p2.betAmount * 2 : 0;
                if (winAmt1 > 0) adjustCredits(p1.userId, winAmt1, "war:pvp_win");
                if (winAmt2 > 0) adjustCredits(p2.userId, winAmt2, "war:pvp_win");
                if (p1Wins) updateStats(p1.userId, { war_wins: 1 });
                else updateStats(p2.userId, { war_wins: 1 });

                const emitResult = (playerId: string, pSocketId: string, won: boolean, betAmtCents: number, winAmountCents: number) => {
                  const netCents = won ? betAmtCents : -betAmtCents;
                  const activity = { id: Math.random().toString(36).substr(2,9), username: won ? p1Wins ? p1.username : p2.username : (!p1Wins ? p1.username : p2.username), amount: Math.abs(netCents) / 100, type: netCents > 0 ? 'win' : 'loss', game: 'War PVP', timestamp: Date.now() };
                  activityHistory.unshift(activity); if (activityHistory.length > 50) activityHistory.pop(); io.emit("activity:new", activity);
                  const s = io.sockets.sockets.get(pSocketId) as any;
                  if (s) { s.emit("war:pvp_result", { result: won ? 'win' : 'lose', winAmount: winAmountCents / 100, betAmount: betAmtCents / 100 }); s.emit("user_data", userToClient(getUser(playerId))); }
                  checkAchievements(playerId);
                };

                emitResult(p1.userId, p1.socketId, p1Wins, p1.betAmount, winAmt1);
                emitResult(p2.userId, p2.socketId, !p1Wins, p2.betAmount, winAmt2);
                broadcastLeaderboards();
                warRooms.delete(roomId);
              }, 1200);
            } else {
              // Tie — wait for war decisions
              room.status = 'war_pending';
              const s1 = io.sockets.sockets.get(room.player1.socketId) as any;
              const s2 = io.sockets.sockets.get(room.player2.socketId) as any;
              if (s1) s1.emit("war:pvp_tie", { roomId });
              if (s2) s2.emit("war:pvp_tie", { roomId });
            }
          }, 800);
        }
      } catch (err: any) {
        socketError(socket, err, 'war:pvp_queue');
      }
    });

    socket.on("war:pvp_leave_queue", () => {
      warQueue = warQueue.filter(p => p.userId !== userId);
    });

    socket.on("war:pvp_decision", (data: { roomId: string; decision: 'war' | 'surrender' }) => {
      try {
        const { roomId, decision } = data;
        const room = warRooms.get(roomId);
        if (!room || room.status !== 'war_pending') return;
        if (userId !== room.player1.userId && userId !== room.player2.userId) return;

        room.warDecisions.set(userId, decision);

        // Once both players decided
        if (room.warDecisions.size === 2) {
          const d1 = room.warDecisions.get(room.player1.userId);
          const d2 = room.warDecisions.get(room.player2.userId);

          if (d1 === 'surrender' || d2 === 'surrender') {
            // Handle surrenders
            const s1 = io.sockets.sockets.get(room.player1.socketId) as any;
            const s2 = io.sockets.sockets.get(room.player2.socketId) as any;

            const resolve = (p: typeof room.player1, pSocket: any, pDecision: string, opponentDecision: string) => {
              if (pDecision === 'surrender') {
                // Lose half bet — already deducted, refund half
                const refundCents = Math.round(p.betAmount / 2);
                adjustCredits(p.userId, refundCents, "war:pvp_surrender");
                if (pSocket) { pSocket.emit("war:pvp_result", { result: 'surrender', winAmount: refundCents / 100, betAmount: p.betAmount / 100 }); pSocket.emit("user_data", userToClient(getUser(p.userId))); }
              } else {
                // Opponent surrendered — we win our original bet back (already deducted)
                adjustCredits(p.userId, p.betAmount * 2, "war:pvp_win");
                updateStats(p.userId, { war_wins: 1 });
                if (pSocket) { pSocket.emit("war:pvp_result", { result: 'win', winAmount: (p.betAmount * 2) / 100, betAmount: p.betAmount / 100 }); pSocket.emit("user_data", userToClient(getUser(p.userId))); }
                checkAchievements(p.userId);
              }
            };
            resolve(room.player1, s1, d1!, d2!);
            resolve(room.player2, s2, d2!, d1!);
            broadcastLeaderboards();
            warRooms.delete(roomId);
          } else {
            // Both go to war — deduct second bet and deal war cards
            const user1 = getUser(room.player1.userId) as any;
            const user2 = getUser(room.player2.userId) as any;
            if (!user1 || user1.credits < room.player1.betAmount) {
              const s1 = io.sockets.sockets.get(room.player1.socketId) as any;
              if (s1) s1.emit("war:pvp_result", { result: 'surrender', winAmount: 0, betAmount: room.player1.betAmount });
              return;
            }
            if (!user2 || user2.credits < room.player2.betAmount) {
              const s2 = io.sockets.sockets.get(room.player2.socketId) as any;
              if (s2) s2.emit("war:pvp_result", { result: 'surrender', winAmount: 0, betAmount: room.player2.betAmount });
              return;
            }

            adjustCredits(room.player1.userId, -room.player1.betAmount, "war:pvp_war_bet");
            adjustCredits(room.player2.userId, -room.player2.betAmount, "war:pvp_war_bet");
            checkJackpot(room.player1.userId, room.player1.username, room.player1.betAmount, 'war');
            checkJackpot(room.player2.userId, room.player2.username, room.player2.betAmount, 'war');

            const s1 = io.sockets.sockets.get(room.player1.socketId) as any;
            const s2 = io.sockets.sockets.get(room.player2.socketId) as any;
            if (s1) s1.emit("user_data", userToClient(getUser(room.player1.userId)));
            if (s2) s2.emit("user_data", userToClient(getUser(room.player2.userId)));

            const warCard1 = dealWarCardFixed();
            const warCard2 = dealWarCardFixed();
            room.player1.warCard = warCard1;
            room.player2.warCard = warCard2;
            room.status = 'done';

            setTimeout(() => {
              const s1 = io.sockets.sockets.get(room.player1.socketId) as any;
              const s2 = io.sockets.sockets.get(room.player2.socketId) as any;
              if (s1) s1.emit("war:pvp_war_cards", { yourCard: warCard1, opponentCard: warCard2, roomId });
              if (s2) s2.emit("war:pvp_war_cards", { yourCard: warCard2, opponentCard: warCard1, roomId });

              setTimeout(() => {
                const p1Wins = warCard1.value > warCard2.value || (warCard1.value === warCard2.value && Math.random() < 0.5);
                const win1Cents = room.player1.betAmount * 8;
                const win2Cents = room.player2.betAmount * 8;
                if (p1Wins) { adjustCredits(room.player1.userId, win1Cents, "war:pvp_war_win"); updateStats(room.player1.userId, { war_wins: 1 }); }
                else { adjustCredits(room.player2.userId, win2Cents, "war:pvp_war_win"); updateStats(room.player2.userId, { war_wins: 1 }); }

                const s1 = io.sockets.sockets.get(room.player1.socketId) as any;
                const s2 = io.sockets.sockets.get(room.player2.socketId) as any;
                if (s1) { s1.emit("war:pvp_result", { result: p1Wins ? 'win' : 'lose', winAmount: p1Wins ? win1Cents / 100 : 0, betAmount: (room.player1.betAmount * 2) / 100 }); s1.emit("user_data", userToClient(getUser(room.player1.userId))); }
                if (s2) { s2.emit("war:pvp_result", { result: !p1Wins ? 'win' : 'lose', winAmount: !p1Wins ? win2Cents / 100 : 0, betAmount: (room.player2.betAmount * 2) / 100 }); s2.emit("user_data", userToClient(getUser(room.player2.userId))); }

                checkAchievements(room.player1.userId);
                checkAchievements(room.player2.userId);
                broadcastLeaderboards();
                warRooms.delete(roomId);
              }, 1200);
            }, 800);
          }
        }
      } catch (err: any) {
        socketError(socket, err, 'war:pvp_decision');
      }
    });

    // --- Wheel Handlers ---
    socket.on("wheel:spin", (data: { betAmount: number; risk: string }) => {
      if (!socketRateLimit(userId, 'wheel:spin')) return socket.emit("error", "Too many requests");
      try {
        const { betAmount, risk } = data; // dollars from client
        if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
        if (betAmount > 100000) return socket.emit("error", "Maximum bet is $100,000");
        const betCents = Math.round(betAmount * 100);
        const user = getUser(userId) as any;
        if (!user || user.credits < betCents) return socket.emit("error", "Insufficient credits");

        const segments = WHEEL_SEGMENTS[risk] ?? WHEEL_SEGMENTS.medium;
        const segmentIndex = Math.floor(Math.random() * segments.length);
        const multiplier = segments[segmentIndex];
        const winAmountCents = Math.round(betCents * multiplier);
        const won = multiplier > 0;

        adjustCredits(userId, -betCents, "wheel:bet");
        checkJackpot(userId, socket.user.username, betCents, 'wheel');
        if (won && winAmountCents > 0) {
          adjustCredits(userId, winAmountCents, "wheel:win");
          updateStats(userId, { max_wheel_multiplier: multiplier });
        }
        if (multiplier >= 2) processChallengeProgress(userId, 'wheel_hit_2x');

        const pfRound = pfRoundId(); const pfSeed = pfGenSeed();
        try { recordProvablyFair(userId, 'wheel', pfRound, pfSeed, pfHash(pfSeed), `${userId}_${Date.now()}`, JSON.stringify({ multiplier, betAmount, winAmount: winAmountCents / 100 })); } catch (e) { logError('wheel:provably_fair', e, { userId, round: pfRound }); }

        const netCents = won ? winAmountCents - betCents : -betCents;
        const activity = {
          id: Math.random().toString(36).substr(2, 9),
          username: socket.user.username,
          amount: Math.abs(netCents) / 100, // dollars for client
          type: netCents > 0 ? 'win' : 'loss',
          game: 'Wheel',
          timestamp: Date.now(),
        };
        const existing = pendingWins.get(userId) || [];
        existing.push(activity);
        pendingWins.set(userId, existing);

        socket.emit("user_data", userToClient(getUser(userId)));
        socket.emit("wheel:outcome", { segmentIndex, multiplier, winAmount: winAmountCents / 100, won });
        broadcastLeaderboards();
      } catch (err: any) {
        socketError(socket, err, 'wheel:spin');
      }
    });

    socket.on("wheel:result", () => { /* no-op: outcome is server-authoritative via wheel:spin */ });

    socket.on("disconnect", () => {
      const myTable = bjTables.find(t => t.tableId === playerTableMap.get(userId));
      if (myTable) { myTable.leaveSeat(userId); playerTableMap.delete(userId); broadcastLobby(); }
      if (userSockets.get(userId) === socket.id) {
        userSockets.delete(userId);
      }
      activeMinesGames.delete(userId); // forfeit any active mines game on disconnect
      for (const [dropId, drop] of pendingPlinkoDrops.entries()) { if (drop.userId === userId) pendingPlinkoDrops.delete(dropId); }
      // Remove from war queue
      warQueue = warQueue.filter(p => p.userId !== userId);
      // Notify opponent if in a war room
      for (const [roomId, room] of warRooms.entries()) {
        const isP1 = room.player1.userId === userId;
        const isP2 = room.player2.userId === userId;
        if (isP1 || isP2) {
          const opponentSocketId = isP1 ? room.player2.socketId : room.player1.socketId;
          const opponentUserId = isP1 ? room.player2.userId : room.player1.userId;
          const os = io.sockets.sockets.get(opponentSocketId) as any;
          if (os) os.emit("war:pvp_opponent_left");
          // Refund both players their bets if game was in progress
          if (room.status !== 'done') {
            const opponentBet = isP1 ? room.player2.betAmount : room.player1.betAmount;
            const disconnectorBet = isP1 ? room.player1.betAmount : room.player2.betAmount;
            adjustCredits(opponentUserId, opponentBet, "war:pvp_refund");
            if (os) os.emit("user_data", userToClient(getUser(opponentUserId)));
            // Refund disconnecting player too — their credits are corrected for next login
            try { adjustCredits(userId, disconnectorBet, "war:pvp_refund"); } catch (e) { logError('war:pvp_refund', e, { userId, amount: disconnectorBet }); }
          }
          warRooms.delete(roomId);
          break;
        }
      }
      broadcastOnline();
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

process.on('uncaughtException', (err) => {
  logError('process:uncaughtException', err);
});

process.on('unhandledRejection', (reason) => {
  logError('process:unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
});

startServer();
