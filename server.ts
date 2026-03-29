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
  getMostProfitableThisWeek
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
      seats: this.seats.map(s => ({ userId: s.userId, username: s.username, hasBet: s.hasBet, activeHandIndex: s.activeHandIndex, hands: s.hands }))
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
        else if (hand.isBlackjack) { if (dBlackjack) { result = 'push'; payout = hand.bet; } else { result = 'blackjack'; payout = Math.round(hand.bet * 2.5 * 100) / 100; } }
        else if (dBlackjack) { result = 'loss'; }
        else if (dBusted || pVal > dVal) { result = 'win'; payout = hand.bet * 2; }
        else if (pVal === dVal) { result = 'push'; payout = hand.bet; }
        else { result = 'loss'; }
        hand.result = result; hand.payout = payout; totalPayout += payout;
        if (result === 'win' || result === 'blackjack') {
          try { this.processChallengeProgressFn(seat.userId, 'blackjack_win_count'); } catch {}
        }
      }
      const totalBet = seat.hands.reduce((s, h) => s + h.bet, 0);
      if (totalPayout > 0) {
        this.adjustCreditsFn(seat.userId, totalPayout, 'blackjack:payout');
        const sid = this.userSockets.get(seat.userId);
        if (sid) this.io.to(sid).emit('user_data', this.getUserFn(seat.userId));
      }
      const net = totalPayout - totalBet;
      if (net > 0) this.updateStatsFn(seat.userId, { blackjack_wins: 1 });
      this.checkAchievementsFn(seat.userId);
      if (net !== 0) {
        const act = { id: Math.random().toString(36).substr(2, 9), username: seat.username, amount: Math.abs(net), type: net > 0 ? 'win' : 'loss', game: 'Blackjack', timestamp: Date.now() };
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
        if (bet > 0) { try { this.adjustCreditsFn(userId, bet, 'blackjack:refund'); const sid = this.userSockets.get(userId); if (sid) this.io.to(sid).emit('user_data', this.getUserFn(userId)); } catch {} }
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

  placeBet(userId: string, amount: number): string | null {
    if (this.phase !== 'betting') return 'Betting is closed';
    if (amount < 0.01) return 'Minimum bet $0.01';
    if (amount > 100000) return 'Maximum bet is $100,000';
    const seat = this.seats.find(s => s.userId === userId);
    if (!seat) return 'Not seated';
    if (seat.hasBet) return 'Already bet';
    try {
      this.adjustCreditsFn(userId, -amount, 'blackjack:bet');
      this.checkJackpotFn(userId, seat.username, amount, 'blackjack-table');
      seat.hasBet = true;
      seat.hands = [{ cards: [], bet: amount, isFinished: false, isBusted: false, isBlackjack: false, isDoubled: false, isSplit: false, result: null, payout: 0 }];
      const sid = this.userSockets.get(userId);
      if (sid) this.io.to(sid).emit('user_data', this.getUserFn(userId));
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
      if (sid) this.io.to(sid).emit('user_data', this.getUserFn(userId));
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
      if (sid) this.io.to(sid).emit('user_data', this.getUserFn(userId));
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
  return { grid: initialGrid, totalWin: Math.round(totalWin * 100) / 100, freeSpinsTriggered, freeSpinCount };
}
// ============ END SLOTS RNG ============

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-casino-key";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const SERVER_VERSION = Date.now().toString();
const MAX_BET = 100000;
const WHEEL_SEGMENTS: Record<string, number[]> = {
  low:    [1, 1.5, 1, 0, 1, 1.5, 1, 0, 1, 1.5],
  medium: [0, 1.5, 0, 2, 0, 3, 0, 5],
  high:   [0, 0, 0, 10, 0, 0, 0, 50],
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
    res.json({ token, user: { id: user.id, username: user.username, credits: user.credits, is_admin: user.is_admin } });
  });

  app.get("/api/auth/me", authenticateToken, (req: any, res) => {
    const user = getUser(req.user.id);
    res.json(user);
  });

  app.post("/api/auth/claim-daily", bonusLimiter, authenticateToken, (req: any, res) => {
    const userId = req.user.id;
    const user = getUser(userId) as any;
    const now = new Date().toISOString().split('T')[0];

    const rank = getRank(user.total_wagered);
    const reward = rank.dailyReward;

    const result = db.prepare('UPDATE users SET credits = credits + ?, daily_reward_date = ? WHERE id = ? AND (daily_reward_date IS NULL OR daily_reward_date != ?)').run(reward, now, userId, now);
    if (result.changes === 0) {
      return res.status(400).json({ error: "Already claimed today" });
    }
    const updatedUser = getUser(userId);
    
    // Notify all sockets for this user
    const socketId = userSockets.get(userId);
    if (socketId) io.to(socketId).emit("user_data", updatedUser);
    
    checkAchievements(userId);

    res.json({ message: "Daily reward claimed", user: updatedUser });
  });

  app.post("/api/user/gift", authenticateToken, (req: any, res) => {
    const { targetUsername, amount } = req.body;
    const userId = req.user.id;
    const user = getUser(userId) as any;

    if (!targetUsername || !amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid request" });
    }

    if (user.credits < amount) {
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
      adjustCredits(userId, -amount, `gift to ${targetUsername}`);
      adjustCredits(targetUser.id, amount, `gift from ${user.username}`);

      const updatedUser = getUser(userId);
      const updatedTarget = getUser(targetUser.id);

      const socketId = userSockets.get(userId);
      if (socketId) io.to(socketId).emit("user_data", updatedUser);

      const targetSocketId = userSockets.get(targetUser.id);
      if (targetSocketId) io.to(targetSocketId).emit("user_data", updatedTarget);

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
      if (socketId) io.to(socketId).emit("user_data", updatedUser);

      res.json({ message: "Username updated", user: updatedUser });
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

    if (user.credits < 10000) {
      return res.status(400).json({ error: "Minimum $10,000 balance required" });
    }

    const interest = Math.round(user.credits * 0.01 * 100) / 100;
    const interestResult = db.prepare('UPDATE users SET credits = credits + ?, interest_date = ?, interest_claims = interest_claims + 1 WHERE id = ? AND (interest_date IS NULL OR CAST(interest_date AS INTEGER) < ?)').run(interest, Date.now().toString(), userId, todayStart);
    if (interestResult.changes === 0) {
      const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
      const remaining = tomorrowStart - now.getTime();
      const hours = Math.floor(remaining / (60 * 60 * 1000));
      const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
      return res.status(400).json({ error: `You can claim again in ${hours}h ${minutes}m (at midnight UTC)` });
    }
    const updatedUser = getUser(userId);

    const socketId = userSockets.get(userId);
    if (socketId) io.to(socketId).emit("user_data", updatedUser);
    
    checkAchievements(userId);

    res.json({ message: `Interest of $${interest.toLocaleString()} claimed`, user: updatedUser });
  });

  app.post("/api/stats/claim-weekly", bonusLimiter, authenticateToken, (req: any, res) => {
    const userId = req.user.id;
    const user = getUser(userId) as any;
    
    // Simple weekly check (could be more robust)
    const now = new Date();
    const lastClaim = user.weekly_reward_date ? new Date(user.weekly_reward_date) : null;
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const weeklyResult = db.prepare('UPDATE users SET credits = credits + 10000, weekly_reward_date = ? WHERE id = ? AND (weekly_reward_date IS NULL OR weekly_reward_date <= ?)').run(now.toISOString(), userId, oneWeekAgo.toISOString());
    if (weeklyResult.changes === 0) {
      return res.status(400).json({ error: "Weekly reward not available yet" });
    }
    const updatedUser = getUser(userId);

    const socketId = userSockets.get(userId);
    if (socketId) io.to(socketId).emit("user_data", updatedUser);

    res.json({ message: "Weekly reward claimed", user: updatedUser });
  });

  app.get("/api/jackpot", (req, res) => {
    res.json({ amount: getJackpot() });
  });

  app.get("/api/user/public/:username", (req, res) => {
    const user = getUserByUsername(req.params.username) as any;
    if (!user || user.is_banned) return res.status(404).json({ error: "User not found" });
    const achievements = db.prepare('SELECT achievement_id, timestamp FROM user_achievements WHERE user_id = ?').all(user.id);
    res.json({
      username: user.username,
      total_wagered: user.total_wagered || 0,
      total_bets: user.total_bets || 0,
      total_wins: user.total_wins || 0,
      net_profit: user.net_profit || 0,
      biggest_win: user.biggest_win || 0,
      achievements,
    });
  });

  app.get("/api/user/history", authenticateToken, (req: any, res) => {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;
    const filter = (req.query.filter as string) || 'all';
    let where = 'WHERE user_id = ?';
    const params: any[] = [userId];
    if (filter === 'wins') where += ' AND amount > 0';
    else if (filter === 'losses') where += ' AND amount < 0';
    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM transactions ${where}`).get(...params) as any).cnt;
    const transactions = db.prepare(`SELECT * FROM transactions ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    res.json({ transactions, total, pages: Math.ceil(total / limit), page });
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
    const users = db.prepare('SELECT id, username, credits, total_wagered, is_admin, is_banned, total_bets, total_wins, net_profit, biggest_win FROM users').all();
    res.json(users);
  });

  app.post("/api/admin/credits", authenticateToken, isAdmin, (req: any, res) => {
    const { userId, amount, description } = req.body;
    const adminUsername = req.user.username;
    try {
      db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(amount, userId);
      db.prepare('INSERT INTO transactions (user_id, amount, balance_after, description) VALUES (?, ?, (SELECT credits FROM users WHERE id = ?), ?)').run(userId, amount, userId, description || `Admin adjustment by ${adminUsername}`);
      
      const updatedUser = getUser(userId);
      const socketId = userSockets.get(userId);
      if (socketId) io.to(socketId).emit("user_data", updatedUser);
      
      res.json({ message: "Credits adjusted", user: updatedUser });
    } catch (err: any) {
      logError('POST /api/admin/adjust-credits', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/set-credits", authenticateToken, isAdmin, (req: any, res) => {
    const { userId, amount, description } = req.body;
    const adminUsername = req.user.username;
    try {
      db.transaction(() => {
        const current = (db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as any).credits;
        const delta = amount - current;
        db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(amount, userId);
        db.prepare('INSERT INTO transactions (user_id, amount, balance_after, description) VALUES (?, ?, ?, ?)').run(userId, delta, amount, description || `Admin set balance by ${adminUsername}`);
      })();
      
      const updatedUser = getUser(userId);
      const socketId = userSockets.get(userId);
      if (socketId) io.to(socketId).emit("user_data", updatedUser);
      
      res.json({ message: "Credits set", user: updatedUser });
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
    if (socketId) io.to(socketId).emit("user_data", updatedUser);
    res.json({ message: "Stats reset", user: updatedUser });
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

    const transactions = db.prepare(query).all(...params);
    res.json({ transactions, total: total.count, pages: Math.ceil(total.count / limit) });
  });

  app.post("/api/admin/broadcast", authenticateToken, isAdmin, (req, res) => {
    const { message, type } = req.body;
    io.emit("broadcast", { message, type: type || "info", timestamp: new Date().toISOString() });
    res.json({ message: "Broadcast sent" });
  });

  app.post("/api/admin/jackpot", authenticateToken, isAdmin, (req, res) => {
    const { amount } = req.body;
    db.prepare('UPDATE jackpot SET amount = ? WHERE id = 1').run(amount);
    io.emit("jackpot:update", amount);
    res.json({ message: "Jackpot updated", amount });
  });

  app.post("/api/admin/site-reset", authenticateToken, isAdmin, (req, res) => {
    const reset = db.transaction(() => {
      db.prepare('UPDATE users SET credits = 1000, total_wagered = 0, total_bets = 0, total_wins = 0, net_profit = 0, biggest_win = 0, daily_reward_date = NULL, weekly_reward_date = NULL, interest_date = NULL, interest_claims = 0').run();
      db.prepare('DELETE FROM user_achievements').run();
      db.prepare('DELETE FROM user_free_spins').run();
      db.prepare('DELETE FROM user_challenge_progress').run();
      db.prepare('DELETE FROM transactions').run();
      db.prepare('UPDATE jackpot SET amount = 2000 WHERE id = 1').run();
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

    const currentAchievements = getAchievements(userId).map((a: any) => a.achievement_id);
    const newlyAwarded = [];

    for (const achievement of ACHIEVEMENTS) {
      if (!currentAchievements.includes(achievement.id)) {
        if (achievement.requirement(user)) {
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
  setInterval(broadcastLeaderboards, 30000);

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
          try { recordProvablyFair(bUserId, 'crash', `${pfRound}_${bUserId}`, pfSeed, pfSeedHash, 'house', JSON.stringify({ crashPoint: Number(crashMultiplier.toFixed(2)), betAmount: bet.betAmount, cashedOut: bet.cashedOut, payout: bet.payout })); } catch {}
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
          const payout = Math.round(bet.betAmount * bet.autoCashout * 100) / 100;
          adjustCredits(bUserId, payout, "crash:win");
          bet.cashedOut = true;
          bet.payout = payout;
          if (bet.autoCashout >= 3) processChallengeProgress(bUserId, 'crash_cashout_3x');

          const userSocketId = userSockets.get(bUserId);
          if (userSocketId) {
            const userSocket = io.sockets.sockets.get(userSocketId);
            if (userSocket) {
              const updatedUser = getUser(bUserId) as any;
              userSocket.emit("user_data", updatedUser);
              userSocket.emit("crash:cashout_success", { payout, multiplier: bet.autoCashout });
            }
          }
          io.emit("crash:bets_update", Array.from(crashBets.values()));
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
          const winnings = Math.round(bet.betAmount * multiplier * 100) / 100;
          adjustCredits(bet.userId, winnings, "roulette:win");
          updateStats(bet.userId, {
            roulette_wins: 1,
            max_roulette_win: winnings,
            ...(isStraight ? { roulette_straight_wins: 1 } : {})
          });
          processChallengeProgress(bet.userId, 'roulette_win_count');
          
          const userSocketId = userSockets.get(bet.userId);
          if (userSocketId) {
            const userSocket = io.sockets.sockets.get(userSocketId);
            if (userSocket) {
              const updatedUser = getUser(bet.userId) as any;
              userSocket.emit("user_data", updatedUser);
              userSocket.emit("roulette:win_success", { winnings });
            }
          }
          checkAchievements(bet.userId);
        }
      });

      io.emit("roulette:result", { 
        number: resultNumber, 
        color, 
        history: rouletteHistory,
        bets: Array.from(rouletteBets.values())
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
    { key: 'crash_3x', description: 'Cash out at 3x or higher on Crash', target_type: 'crash_cashout_3x', target_value: 1, reward: 500 },
    { key: 'cases_5', description: 'Open 5 Cases', target_type: 'cases_open_count', target_value: 5, reward: 300 },
    { key: 'bj_win', description: 'Win a hand at Blackjack', target_type: 'blackjack_win_count', target_value: 1, reward: 200 },
    { key: 'plinko_5x', description: 'Hit a 5x multiplier or higher on Plinko', target_type: 'plinko_hit_5x', target_value: 1, reward: 400 },
    { key: 'slots_fs', description: 'Trigger Free Spins in Slots', target_type: 'slots_free_spins', target_value: 1, reward: 350 },
    { key: 'roulette_win', description: 'Win a Roulette bet', target_type: 'roulette_win_count', target_value: 1, reward: 150 },
    { key: 'mines_3', description: 'Reveal 3 or more gems in a single Mines game', target_type: 'mines_gems_revealed', target_value: 3, reward: 250 },
    { key: 'wheel_2x', description: 'Land a 2x or higher multiplier on the Wheel', target_type: 'wheel_hit_2x', target_value: 1, reward: 175 },
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
          adjustCredits(userId, challenge.reward, 'challenge:reward');
          markChallengeRewardClaimed(userId, challenge.id);
          const updatedUser = getUser(userId) as any;
          const sid = userSockets.get(userId);
          if (sid) {
            io.to(sid).emit('user_data', updatedUser);
            io.to(sid).emit('challenge:completed', { challengeId: challenge.id, reward: challenge.reward, description: challenge.description });
          }
        } else {
          const sid = userSockets.get(userId);
          if (sid) io.to(sid).emit('challenge:progress', { challengeId: challenge.id, progress: row.progress, target: challenge.target_value });
        }
      }
    } catch {}
  };

  // ============ END DAILY CHALLENGES ============

  // --- Jackpot Helper ---
  let lastEmittedJackpot = 0;
  const checkJackpot = (userId: string, username: string, betAmount: number, game: string = 'unknown') => {
    addToJackpot(betAmount * 0.01);
    const newJackpot = getJackpot();
    if (Math.abs(newJackpot - lastEmittedJackpot) >= 1) {
      lastEmittedJackpot = newJackpot;
      io.emit("jackpot:update", newJackpot);
    }
    if (Math.random() < 0.0002) {
      adjustCredits(userId, newJackpot, "jackpot:win");
      resetJackpot();
      io.emit("jackpot:winner", { username, amount: newJackpot });
      io.emit("jackpot:update", getJackpot());
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
    socket.emit("user_data", socket.user);
    socket.emit("user_achievements", getAchievements(userId));
    socket.emit("challenges:data", getUserChallengeProgress(userId));
    const savedFs = getFreeSpins(userId);
    if (savedFs && savedFs.count > 0) {
      socket.emit("slots:free_spins_restored", { count: savedFs.count, betAmount: savedFs.bet_amount });
    }
    socket.emit("activity:history", activityHistory);
    socket.emit("jackpot:update", getJackpot());
    broadcastLeaderboards();
    
    // Initial Crash Data
    socket.emit("crash:sync", {
      state: crashState,
      multiplier: crashMultiplier,
      history: crashHistory,
      timeLeft: crashCurrentWait,
      points: crashPoints,
      bets: Array.from(crashBets.values())
    });
    const initActiveBet = crashBets.get(userId);
    if (initActiveBet && !initActiveBet.cashedOut) {
      socket.emit("crash:bet_restored", { betAmount: initActiveBet.betAmount });
    }

    socket.on("crash:join", () => {
      socket.emit("crash:sync", {
        state: crashState,
        multiplier: crashMultiplier,
        history: crashHistory,
        timeLeft: crashCurrentWait,
        points: crashPoints,
        bets: Array.from(crashBets.values())
      });
      const myActiveBet = crashBets.get(userId);
      if (myActiveBet && !myActiveBet.cashedOut) {
        socket.emit("crash:bet_restored", { betAmount: myActiveBet.betAmount });
      }
      if (crashState === 'crashed') {
        socket.emit("crash:crashed", { multiplier: crashMultiplier, history: crashHistory });
      }
    });

    socket.on("challenges:get", () => {
      socket.emit("challenges:data", getUserChallengeProgress(userId));
    });

    // --- Crash Handlers ---
    socket.on("crash:cancel_bet", () => {
      if (crashState !== 'waiting') return socket.emit("error", "Game already in progress");
      const bet = crashBets.get(userId);
      if (!bet) return socket.emit("error", "No active bet to cancel");
      
      try {
        adjustCredits(userId, bet.betAmount, "crash:cancel_bet");
        crashBets.delete(userId);
        
        const updatedUser = getUser(userId) as any;
        socket.emit("user_data", updatedUser);
        io.emit("crash:bets_update", Array.from(crashBets.values()));
      } catch (err: any) {
        socketError(socket, err, 'crash:cancel_bet');
      }
    });

    socket.on("crash:bet", (data: { betAmount: number, autoCashout?: number }) => {
      if (!socketRateLimit(userId, 'crash:bet', 5, 2000)) return socket.emit("error", "Too many requests");
      if (crashState !== 'waiting') return socket.emit("error", "Game already in progress");
      if (crashBets.has(userId)) return socket.emit("error", "Already placed a bet");
      
      const { betAmount, autoCashout } = data;
      if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      if (betAmount > MAX_BET) return socket.emit("error", "Maximum bet is $100,000");

      try {
        adjustCredits(userId, -betAmount, "crash:bet");
        checkJackpot(userId, socket.user.username, betAmount, 'crash');
        crashBets.set(userId, {
          userId, 
          betAmount, 
          username: socket.user.username, 
          cashedOut: false, 
          payout: 0,
          autoCashout: autoCashout || 0
        });
        
        const updatedUser = getUser(userId) as any;
        socket.emit("user_data", updatedUser);
        io.emit("crash:bets_update", Array.from(crashBets.values()));
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
      let { betAmount, count } = data;
      if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      if (betAmount > MAX_BET) return socket.emit("error", "Maximum bet is $100,000");
      count = Math.max(1, Math.min(5, count)); // Clamp count to 1-5
      const totalBet = betAmount * count;

      try {
        const user = getUser(userId) as any;
        if (user.credits < totalBet) return socket.emit("error", "Insufficient credits");
        
        // Deduct bet
        adjustCredits(userId, -totalBet, "case:bet");
        checkJackpot(userId, socket.user.username, totalBet, 'cases');

        const results = [];
        let totalWinnings = 0;

        for (let i = 0; i < count; i++) {
          const item = rollItem();
          const winAmount = betAmount * item.multiplier;
          totalWinnings += winAmount;
          results.push({ item, winAmount });
        }

        if (totalWinnings > 0) {
          adjustCredits(userId, totalWinnings, "case:win");
        }

        const pfRound = pfRoundId(); const pfSeed = pfGenSeed();
        try { recordProvablyFair(userId, 'cases', pfRound, pfSeed, pfHash(pfSeed), `${userId}_${Date.now()}`, JSON.stringify({ results, totalWinnings, betAmount, count })); } catch {}

        processChallengeProgress(userId, 'cases_open_count', count);

        const updatedUser = getUser(userId) as any;

        socket.emit("case:result", {
          results,
          totalWinnings,
          newCredits: updatedUser.credits
        });

        // Queue activity — broadcast after frontend animation completes via activity:reveal
        const net = totalWinnings - totalBet;
        if (net !== 0) {
          const activity = {
            id: Math.random().toString(36).substr(2, 9),
            username: socket.user.username,
            amount: Math.abs(net),
            type: net > 0 ? "win" : "loss",
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
      const { betAmount, risk, rows } = data;
      if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      if (betAmount > MAX_BET) return socket.emit("error", "Maximum bet is $100,000");

      try {
        const user = getUser(userId) as any;
        if (user.credits < betAmount) return socket.emit("error", "Insufficient credits");

        // Deduct bet
        adjustCredits(userId, -betAmount, "plinko:bet");
        checkJackpot(userId, socket.user.username, betAmount, 'plinko');

        // Generate result
        const { path, slot } = generatePlinkoPath(rows);
        const multiplier = MULTIPLIERS[rows]?.[risk]?.[slot] || 0;
        const winnings = Math.round(betAmount * multiplier * 100) / 100;

        const pfRound = pfRoundId(); const pfSeed = pfGenSeed();
        try { recordProvablyFair(userId, 'plinko', pfRound, pfSeed, pfHash(pfSeed), `${userId}_${Date.now()}`, JSON.stringify({ multiplier, winAmount: winnings, betAmount })); } catch {}

        if (multiplier >= 5) processChallengeProgress(userId, 'plinko_hit_5x');

        const dropId = Math.random().toString(36).substr(2, 9);
        pendingPlinkoDrops.set(dropId, {
          userId,
          winnings,
          betAmount,
          net: winnings - betAmount,
          multiplier,
          username: socket.user.username
        });
        
        const updatedUser = getUser(userId) as any;
        socket.emit("user_data", updatedUser);
        
        // Emit result
        socket.emit("plinko:result", {
          id: dropId,
          path,
          slot,
          multiplier,
          winnings,
          newCredits: updatedUser.credits,
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
          adjustCredits(userId, pendingDrop.winnings, "plinko:win");
          updateStats(userId, { max_plinko_multiplier: pendingDrop.multiplier });
        }

        const updatedUser = getUser(userId) as any;
        socket.emit("user_data", updatedUser);
        
        checkAchievements(userId);

        // Activity Feed
        if (pendingDrop.net !== 0) {
          const activity = {
            id: Math.random().toString(36).substr(2, 9),
            username: pendingDrop.username,
            type: pendingDrop.net > 0 ? 'win' : 'loss',
            amount: Math.abs(pendingDrop.net),
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
      const { betAmount, risk, rows, count } = data;
      const totalBet = betAmount * count;
      if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      if (betAmount > MAX_BET) return socket.emit("error", "Maximum bet is $100,000");
      if (count < 1 || count > 10) return socket.emit("error", "Invalid count (max 10)");
      
      try {
        const user = getUser(userId) as any;
        if (user.credits < totalBet) return socket.emit("error", "Insufficient credits");
        
        // Deduct total bet
        adjustCredits(userId, -totalBet, "plinko:bet-multi");
        checkJackpot(userId, socket.user.username, totalBet, 'plinko');
        
        const results = [];
        let totalWinnings = 0;
        
        for (let i = 0; i < count; i++) {
          const { path, slot } = generatePlinkoPath(rows);
          const multiplier = MULTIPLIERS[rows]?.[risk]?.[slot] || 0;
          const winnings = Math.round(betAmount * multiplier * 100) / 100;
          
          const dropId = Math.random().toString(36).substr(2, 9);
          pendingPlinkoDrops.set(dropId, {
            userId,
            winnings,
            betAmount,
            net: winnings - betAmount,
            multiplier,
            username: socket.user.username
          });
          
          results.push({
            id: dropId,
            path,
            slot,
            multiplier,
            winnings,
            risk,
            rows,
            betAmount
          });
        }
        
        const updatedUser = getUser(userId) as any;
        socket.emit("user_data", updatedUser);
        
        // Emit results
        socket.emit("plinko:result-multi", {
          results,
          newCredits: updatedUser.credits
        });
      } catch (err: any) {
        socketError(socket, err, 'plinko:drop-multi');
      }
    });

    socket.on("crash:cashout", () => {
      if (crashState !== 'running') return socket.emit("error", "Game not running");
      const bet = crashBets.get(userId);
      if (!bet || bet.cashedOut) return socket.emit("error", "No active bet or already cashed out");

      const payout = Math.round(bet.betAmount * crashMultiplier * 100) / 100;
      bet.cashedOut = true;
      bet.payout = payout;

      adjustCredits(userId, payout, "crash:win");
      updateStats(userId, { max_crash_multiplier: crashMultiplier });
      if (crashMultiplier >= 3) processChallengeProgress(userId, 'crash_cashout_3x');

      const updatedUser = getUser(userId) as any;
      socket.emit("user_data", updatedUser);
      io.emit("crash:bets_update", Array.from(crashBets.values()));
      socket.emit("crash:cashout_success", { payout, multiplier: crashMultiplier });

      checkAchievements(userId);

      // Record activity
      const winActivity = {
        id: Math.random().toString(36).substr(2, 9),
        username: socket.user.username,
        amount: payout - bet.betAmount,
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
      const { betAmount, featureBuy = false } = data;
      try {
        const user = getUser(userId) as any;
        if (!user) return socket.emit("error", "User not found");

        let isFreeSpin = false;
        let effectiveBet = betAmount;

        if (betAmount === 0) {
          // Free spin — must have server-tracked free spins
          const fs = getFreeSpins(userId);
          if (!fs || fs.count <= 0) return socket.emit("error", "No free spins available");
          isFreeSpin = true;
          effectiveBet = fs.bet_amount;
          if (fs.count - 1 <= 0) clearFreeSpins(userId);
          else setFreeSpins(userId, fs.count - 1, fs.bet_amount);
        } else {
          if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
          if (betAmount > MAX_BET) return socket.emit("error", "Maximum bet is $100,000");
          adjustCredits(userId, -betAmount, "slots:bet");
          checkJackpot(userId, socket.user.username, betAmount, 'slots');
        }

        // Server generates grid and computes full outcome (tumble cascade)
        const outcome = calcSlotOutcome(effectiveBet, isFreeSpin, featureBuy ? 4 : 0);

        const pfRound = pfRoundId();
        const pfSeed = pfGenSeed();
        const pfSeedHash = pfHash(pfSeed);
        try { recordProvablyFair(userId, 'slots', pfRound, pfSeed, pfSeedHash, `${userId}_${Date.now()}`, JSON.stringify({ totalWin: outcome.totalWin, betAmount: effectiveBet, isFreeSpin })); } catch {}

        if (outcome.totalWin > 0) {
          adjustCredits(userId, outcome.totalWin, isFreeSpin ? "slots:freespin_win" : "slots:win");
        }

        if (outcome.freeSpinsTriggered) processChallengeProgress(userId, 'slots_free_spins');

        // Store triggered free spins server-side
        if (outcome.freeSpinsTriggered || outcome.freeSpinCount > 0) {
          const existingFs = getFreeSpins(userId);
          const newCount = (existingFs?.count ?? 0) + outcome.freeSpinCount;
          // Use effectiveBet (not betAmount which is 0 during free spins) so re-triggered
          // free spins inherit the original bet amount instead of storing 0
          const newBet = existingFs?.bet_amount || effectiveBet;
          setFreeSpins(userId, newCount, newBet);
        }
        const savedFsAfter = getFreeSpins(userId);
        const remainingFreeSpins = savedFsAfter?.count ?? 0;

        const updatedUser = getUser(userId) as any;
        socket.emit("user_data", updatedUser);
        socket.emit("slots:result", {
          grid: outcome.grid,
          totalWin: outcome.totalWin,
          freeSpinsTriggered: outcome.freeSpinsTriggered,
          freeSpinCount: outcome.freeSpinCount,
          remainingFreeSpins,
          roundId: pfRound,
        });

        // Record activity
        const net = outcome.totalWin - (isFreeSpin ? 0 : betAmount);
        if (net !== 0) {
          const act = {
            id: Math.random().toString(36).substr(2, 9),
            username: socket.user.username,
            amount: Math.abs(net),
            type: net > 0 ? "win" : "loss",
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
      const { amount } = data;
      try {
        adjustCredits(userId, -amount, "blackjack:bet");
        checkJackpot(userId, socket.user.username, amount, 'blackjack');
        const user = getUser(userId) as any;
        socket.emit("user_data", user);
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
      const { amount, type, value } = data;
      if (amount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      if (amount > MAX_BET) return socket.emit("error", "Maximum bet is $100,000");
      
      try {
        const user = getUser(userId) as any;
        if (!user) return socket.emit("error", "User not found");
        if (user.credits < amount) return socket.emit("error", "Insufficient credits");
        
        const betKey = `${userId}_${type}_${value}`;
        const existingBet = rouletteBets.get(betKey);

        adjustCredits(userId, -amount, "roulette:bet");
        checkJackpot(userId, socket.user.username, amount, 'roulette');

        if (existingBet) {
          existingBet.betAmount += amount;
        } else {
          rouletteBets.set(betKey, {
            userId,
            betAmount: amount,
            username: socket.user.username,
            type,
            value
          });
        }

        const updatedUser = getUser(userId) as any;
        socket.emit("user_data", updatedUser);
        io.emit("roulette:bets_update", Array.from(rouletteBets.values()));
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

        const updatedUser = getUser(userId) as any;
        socket.emit("user_data", updatedUser);
        io.emit("roulette:bets_update", Array.from(rouletteBets.values()));
      } catch (err: any) {
        socketError(socket, err, 'roulette:remove_bet');
      }
    });

    socket.on("roulette:join", () => {
      socket.emit("roulette:sync", {
        state: rouletteState,
        timeLeft: rouletteCurrentWait,
        history: rouletteHistory,
        bets: Array.from(rouletteBets.values()),
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
        const { betAmount } = data;
        const mc = Math.min(24, Math.max(1, Math.floor(data.mineCount || 3)));
        if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
        if (betAmount > MAX_BET) return socket.emit("error", "Maximum bet is $100,000");
        const user = getUser(userId) as any;
        if (!user || user.credits < betAmount) return socket.emit("error", "Insufficient credits");

        activeMinesGames.delete(userId); // cancel any existing game
        const positions = new Set<number>();
        while (positions.size < mc) positions.add(Math.floor(Math.random() * 25));

        adjustCredits(userId, -betAmount, "mines:bet");
        checkJackpot(userId, socket.user.username, betAmount, 'mines');
        activeMinesGames.set(userId, { betAmount, mineCount: mc, minePositions: positions, revealedCount: 0, revealedTiles: new Set() });

        const updatedUser = getUser(userId) as any;
        socket.emit("user_data", updatedUser);
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
          socket.emit("user_data", getUser(userId));
          const activity = { id: Math.random().toString(36).substr(2,9), username: socket.user.username, amount: game.betAmount, type: 'loss', game: 'Mines', timestamp: Date.now() };
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
            const winAmount = Math.round(game.betAmount * multiplier * 100) / 100;
            adjustCredits(userId, winAmount, "mines:win");
            updateStats(userId, { mines_wins: 1 });
            if (game.revealedCount >= 3) processChallengeProgress(userId, 'mines_gems_revealed', game.revealedCount);
            const updatedUser = getUser(userId) as any;
            socket.emit("user_data", updatedUser);
            socket.emit("mines:safe", { id, multiplier, winAmount, gameOver: true, minePositions: Array.from(game.minePositions) });
            const net = winAmount - game.betAmount;
            const act = { id: Math.random().toString(36).substr(2,9), username: socket.user.username, amount: Math.abs(net), type: 'win', game: 'Mines', timestamp: Date.now() };
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
        const winAmount = Math.round(game.betAmount * multiplier * 100) / 100;
        activeMinesGames.delete(userId);
        adjustCredits(userId, winAmount, "mines:win");
        updateStats(userId, { mines_wins: 1 });
        if (game.revealedCount >= 3) processChallengeProgress(userId, 'mines_gems_revealed', game.revealedCount);
        const updatedUser = getUser(userId) as any;
        socket.emit("user_data", updatedUser);
        socket.emit("mines:cashout_result", { winAmount, multiplier, minePositions: Array.from(game.minePositions) });
        const net = winAmount - game.betAmount;
        const activity = { id: Math.random().toString(36).substr(2,9), username: socket.user.username, amount: Math.abs(net), type: 'win', game: 'Mines', timestamp: Date.now() };
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
        const updatedUser = getUser(userId) as any;
        socket.emit("user_data", updatedUser);
        checkAchievements(userId);
      } catch (err: any) {
        socketError(socket, err, 'mines:lost');
      }
    });

    // --- PVP War Handlers ---
    socket.on("war:pvp_queue", (data: { betAmount: number }) => {
      if (!socketRateLimit(userId, 'war:pvp_queue', 5, 2000)) return socket.emit("error", "Too many requests");
      try {
        const { betAmount } = data;
        if (betAmount <= 0) return socket.emit("error", "Invalid bet");
        if (betAmount > MAX_BET) return socket.emit("error", "Maximum bet is $100,000");
        const user = getUser(userId) as any;
        if (!user || user.credits < betAmount) return socket.emit("error", "Insufficient credits");

        // Remove any existing queue entry for this user
        warQueue = warQueue.filter(p => p.userId !== userId);

        warQueue.push({ userId, socketId: socket.id, username: socket.user.username, betAmount });
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
          if (s1) s1.emit("user_data", getUser(p1.userId));
          if (s2) s2.emit("user_data", getUser(p2.userId));

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

                const emitResult = (playerId: string, pSocketId: string, won: boolean, betAmt: number, winAmount: number) => {
                  const net = won ? betAmt : -betAmt;
                  const activity = { id: Math.random().toString(36).substr(2,9), username: won ? p1Wins ? p1.username : p2.username : (!p1Wins ? p1.username : p2.username), amount: Math.abs(net), type: net > 0 ? 'win' : 'loss', game: 'War PVP', timestamp: Date.now() };
                  activityHistory.unshift(activity); if (activityHistory.length > 50) activityHistory.pop(); io.emit("activity:new", activity);
                  const s = io.sockets.sockets.get(pSocketId) as any;
                  if (s) { s.emit("war:pvp_result", { result: won ? 'win' : 'lose', winAmount, betAmount: betAmt }); s.emit("user_data", getUser(playerId)); }
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
                const refund = Math.round(p.betAmount / 2 * 100) / 100;
                adjustCredits(p.userId, refund, "war:pvp_surrender");
                if (pSocket) { pSocket.emit("war:pvp_result", { result: 'surrender', winAmount: refund, betAmount: p.betAmount }); pSocket.emit("user_data", getUser(p.userId)); }
              } else {
                // Opponent surrendered — we win our original bet back (already deducted)
                adjustCredits(p.userId, p.betAmount * 2, "war:pvp_win");
                updateStats(p.userId, { war_wins: 1 });
                if (pSocket) { pSocket.emit("war:pvp_result", { result: 'win', winAmount: p.betAmount * 2, betAmount: p.betAmount }); pSocket.emit("user_data", getUser(p.userId)); }
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
            if (s1) s1.emit("user_data", getUser(room.player1.userId));
            if (s2) s2.emit("user_data", getUser(room.player2.userId));

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
                const win1 = room.player1.betAmount * 8;
                const win2 = room.player2.betAmount * 8;
                if (p1Wins) { adjustCredits(room.player1.userId, win1, "war:pvp_war_win"); updateStats(room.player1.userId, { war_wins: 1 }); }
                else { adjustCredits(room.player2.userId, win2, "war:pvp_war_win"); updateStats(room.player2.userId, { war_wins: 1 }); }

                const s1 = io.sockets.sockets.get(room.player1.socketId) as any;
                const s2 = io.sockets.sockets.get(room.player2.socketId) as any;
                if (s1) { s1.emit("war:pvp_result", { result: p1Wins ? 'win' : 'lose', winAmount: p1Wins ? win1 : 0, betAmount: room.player1.betAmount * 2 }); s1.emit("user_data", getUser(room.player1.userId)); }
                if (s2) { s2.emit("war:pvp_result", { result: !p1Wins ? 'win' : 'lose', winAmount: !p1Wins ? win2 : 0, betAmount: room.player2.betAmount * 2 }); s2.emit("user_data", getUser(room.player2.userId)); }

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
        const { betAmount, risk } = data;
        if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
        if (betAmount > MAX_BET) return socket.emit("error", "Maximum bet is $100,000");
        const user = getUser(userId) as any;
        if (!user || user.credits < betAmount) return socket.emit("error", "Insufficient credits");

        const segments = WHEEL_SEGMENTS[risk] ?? WHEEL_SEGMENTS.medium;
        const segmentIndex = Math.floor(Math.random() * segments.length);
        const multiplier = segments[segmentIndex];
        const winAmount = Math.round(betAmount * multiplier * 100) / 100;
        const won = multiplier > 0;

        adjustCredits(userId, -betAmount, "wheel:bet");
        checkJackpot(userId, socket.user.username, betAmount, 'wheel');
        if (won && winAmount > 0) {
          adjustCredits(userId, winAmount, "wheel:win");
          updateStats(userId, { max_wheel_multiplier: multiplier });
        }
        if (multiplier >= 2) processChallengeProgress(userId, 'wheel_hit_2x');

        const pfRound = pfRoundId(); const pfSeed = pfGenSeed();
        try { recordProvablyFair(userId, 'wheel', pfRound, pfSeed, pfHash(pfSeed), `${userId}_${Date.now()}`, JSON.stringify({ multiplier, betAmount, winAmount })); } catch {}

        const net = won ? winAmount - betAmount : -betAmount;
        const activity = {
          id: Math.random().toString(36).substr(2, 9),
          username: socket.user.username,
          amount: Math.abs(net),
          type: net > 0 ? 'win' : 'loss',
          game: 'Wheel',
          timestamp: Date.now(),
        };
        const existing = pendingWins.get(userId) || [];
        existing.push(activity);
        pendingWins.set(userId, existing);

        const updatedUser = getUser(userId) as any;
        socket.emit("user_data", updatedUser);
        socket.emit("wheel:outcome", { segmentIndex, multiplier, winAmount, won });
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
            if (os) os.emit("user_data", getUser(opponentUserId));
            // Refund disconnecting player too — their credits are corrected for next login
            try { adjustCredits(userId, disconnectorBet, "war:pvp_refund"); } catch {}
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
