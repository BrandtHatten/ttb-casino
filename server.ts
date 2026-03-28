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
  updateStats
} from "./db.js";
import db from "./db.js";
import { getRank } from "./src/lib/ranks.js";
import { CASE_ITEMS, rollItem } from "./src/lib/caseItems.js";
import { ACHIEVEMENTS } from "./src/lib/achievements.js";

dotenv.config();

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
  private io: any;
  private userSockets: Map<string, string>;
  private adjustCreditsFn: Function;
  private updateStatsFn: Function;
  private activityHistory: any[];
  private checkAchievementsFn: Function;
  private broadcastLeaderboardsFn: Function;
  private getUserFn: Function;
  private checkJackpotFn: Function;

  phase: 'betting' | 'playing' | 'dealerTurn' | 'results' = 'betting';
  seats: BjSeat[] = Array.from({ length: 5 }, () => ({ userId: null, username: null, hands: [], activeHandIndex: 0, hasBet: false }));
  private deck: BjCard[] = createBjDeck();
  dealerCards: BjCard[] = [];
  turnSeatIndex = 0;
  turnHandIndex = -1;
  bettingTimeLeft = 20;
  actionTimeLeft = 30;
  private timer: NodeJS.Timeout | null = null;
  private actionInterval: NodeJS.Timeout | null = null;

  constructor(io: any, userSockets: Map<string, string>, deps: any) {
    this.io = io; this.userSockets = userSockets;
    this.adjustCreditsFn = deps.adjustCredits; this.updateStatsFn = deps.updateStats;
    this.activityHistory = deps.activityHistory; this.checkAchievementsFn = deps.checkAchievements;
    this.broadcastLeaderboardsFn = deps.broadcastLeaderboards; this.getUserFn = deps.getUser;
    this.checkJackpotFn = deps.checkJackpot || (() => {});
    this.startBetting();
  }

  private drawCard(): BjCard {
    if (this.deck.length < 20) this.deck = createBjDeck();
    return { ...this.deck.pop()!, hidden: false };
  }

  getState(): any {
    return {
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

  broadcast() { this.io.emit('blackjack:state', this.getState()); }

  private startBetting() {
    this.phase = 'betting';
    this.dealerCards = [];
    this.deck = createBjDeck();
    for (const s of this.seats) { s.hands = []; s.activeHandIndex = 0; s.hasBet = false; }
    this.bettingTimeLeft = 20;
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
        else if (hand.isBlackjack) { if (dBlackjack) { result = 'push'; payout = hand.bet; } else { result = 'blackjack'; payout = Math.floor(hand.bet * 2.5); } }
        else if (dBlackjack) { result = 'loss'; }
        else if (dBusted || pVal > dVal) { result = 'win'; payout = hand.bet * 2; }
        else if (pVal === dVal) { result = 'push'; payout = hand.bet; }
        else { result = 'loss'; }
        hand.result = result; hand.payout = payout; totalPayout += payout;
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-casino-key";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const SERVER_VERSION = Date.now().toString();

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const PORT = parseInt(process.env.PORT || "3002");

  app.use(express.json());

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
      res.status(400).json({ error: "Username taken" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    console.log(`Login attempt for username: ${username}`);
    const normalizedUsername = username.trim();
    const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(normalizedUsername) as any;

    if (!user) {
      console.log(`User not found: ${normalizedUsername}`);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      console.log(`Invalid password for user: ${username}`);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.is_banned) {
      console.log(`Banned user attempt: ${username}`);
      return res.status(403).json({ error: "Account banned" });
    }

    console.log(`Login successful for user: ${username}`);
    const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, credits: user.credits, is_admin: user.is_admin } });
  });

  app.get("/api/auth/me", authenticateToken, (req: any, res) => {
    const user = getUser(req.user.id);
    res.json(user);
  });

  app.post("/api/auth/claim-daily", authenticateToken, (req: any, res) => {
    const userId = req.user.id;
    const user = getUser(userId) as any;
    const now = new Date().toISOString().split('T')[0];

    if (user.daily_reward_date === now) {
      return res.status(400).json({ error: "Already claimed today" });
    }

    const rank = getRank(user.total_wagered);
    const reward = rank.dailyReward;

    db.prepare('UPDATE users SET credits = credits + ?, daily_reward_date = ? WHERE id = ?').run(reward, now, userId);
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

  app.post("/api/user/claim-interest", authenticateToken, (req: any, res) => {
    const userId = req.user.id;
    const user = getUser(userId) as any;
    const now = new Date();
    const todayStart = new Date(now).setUTCHours(0, 0, 0, 0);
    const lastClaim = user.interest_date ? parseInt(user.interest_date) : 0;

    if (user.credits < 10000) {
      return res.status(400).json({ error: "Minimum $10,000 balance required" });
    }

    if (lastClaim >= todayStart) {
      const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
      const remaining = tomorrowStart - now.getTime();
      const hours = Math.floor(remaining / (60 * 60 * 1000));
      const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
      return res.status(400).json({ error: `You can claim again in ${hours}h ${minutes}m (at midnight UTC)` });
    }

    const interest = Math.floor(user.credits * 0.01);
    db.prepare('UPDATE users SET credits = credits + ?, interest_date = ?, interest_claims = interest_claims + 1 WHERE id = ?').run(interest, Date.now().toString(), userId);
    const updatedUser = getUser(userId);

    const socketId = userSockets.get(userId);
    if (socketId) io.to(socketId).emit("user_data", updatedUser);
    
    checkAchievements(userId);

    res.json({ message: `Interest of $${interest.toLocaleString()} claimed`, user: updatedUser });
  });

  app.post("/api/stats/claim-weekly", authenticateToken, (req: any, res) => {
    const userId = req.user.id;
    const user = getUser(userId) as any;
    
    // Simple weekly check (could be more robust)
    const now = new Date();
    const lastClaim = user.weekly_reward_date ? new Date(user.weekly_reward_date) : null;
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    if (lastClaim && lastClaim > oneWeekAgo) {
      return res.status(400).json({ error: "Weekly reward not available yet" });
    }

    db.prepare('UPDATE users SET credits = credits + 10000, weekly_reward_date = ? WHERE id = ?').run(now.toISOString(), userId);
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

  // --- Admin Endpoints ---
  app.get("/api/admin/users", authenticateToken, isAdmin, (req, res) => {
    const users = db.prepare('SELECT id, username, credits, total_wagered, is_admin, is_banned, total_bets, total_wins, net_profit, biggest_win FROM users').all();
    res.json(users);
  });

  app.post("/api/admin/credits", authenticateToken, isAdmin, (req, res) => {
    const { userId, amount, description } = req.body;
    try {
      db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(amount, userId);
      db.prepare('INSERT INTO transactions (user_id, amount, balance_after, description) VALUES (?, ?, (SELECT credits FROM users WHERE id = ?), ?)').run(userId, amount, userId, description || "Admin adjustment");
      
      const updatedUser = getUser(userId);
      const socketId = userSockets.get(userId);
      if (socketId) io.to(socketId).emit("user_data", updatedUser);
      
      res.json({ message: "Credits adjusted", user: updatedUser });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/set-credits", authenticateToken, isAdmin, (req, res) => {
    const { userId, amount, description } = req.body;
    try {
      const currentCredits = (db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as any).credits;
      const delta = amount - currentCredits;
      
      db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(amount, userId);
      db.prepare('INSERT INTO transactions (user_id, amount, balance_after, description) VALUES (?, ?, ?, ?)').run(userId, delta, amount, description || "Admin set balance");
      
      const updatedUser = getUser(userId);
      const socketId = userSockets.get(userId);
      if (socketId) io.to(socketId).emit("user_data", updatedUser);
      
      res.json({ message: "Credits set", user: updatedUser });
    } catch (err: any) {
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
    console.log("Resetting achievements for user:", userId);
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
      db.prepare('UPDATE users SET credits = 1000, total_wagered = 0, total_bets = 0, total_wins = 0, net_profit = 0, biggest_win = 0').run();
      db.prepare('DELETE FROM user_achievements').run();
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

  const broadcastLeaderboards = () => {
    const data = {
      allTime: {
        mostcredits: getLeaderboard(),
        mostwagered: getMostWagered(),
        biggestwin: getBiggestWin()
      },
      thisWeek: {
        mostcredits: getLeaderboard(), // Simplified for now
        mostwagered: getMostWagered(), // Simplified for now
        biggestwin: getBiggestWin()    // Simplified for now
      }
    };
    io.emit("leaderboards_update", data);
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
          io.to(socketId).emit("achievement_unlocked", achievement);
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

  const runCrashGame = () => {
    crashState = 'running';
    crashMultiplier = 1.0;
    crashPoints = [{ x: 0, y: 1.0 }];
    
    // Determine crash point using a common formula: 0.99 / (1 - X) where X is a random number [0, 1)
    // This gives a house edge of ~1%.
    const crashPoint = Math.max(1.0, 0.99 / (1 - Math.random()));
    
    const tick = () => {
      if (crashState !== 'running') return;

      if (crashMultiplier >= crashPoint) {
        crashState = 'crashed';
        crashHistory.unshift(Number(crashMultiplier.toFixed(2)));
        if (crashHistory.length > 20) crashHistory.pop();
        
        io.emit("crash:crashed", { multiplier: crashMultiplier, history: crashHistory });
        
        // Wait and restart
        setTimeout(startWaitingPhase, 3000); // Show "Crashed" for 3 seconds
        return;
      }

      // Increase multiplier
      // We tick every 100ms
      const baseIncrement = 0.01 * Math.pow(crashMultiplier, 0.5);
      let speedFactor = 1.0;
      
      if (crashMultiplier > 5.0) {
        // Constantly get faster after 5.0x
        // Speed increases by 20% for every 1.0x above 5.0x
        speedFactor = 1.0 + (crashMultiplier - 5.0) * 0.2;
      }
      
      crashMultiplier += baseIncrement * speedFactor;
      const x = crashPoints.length * 0.1;
      crashPoints.push({ x, y: crashMultiplier });

      // Handle Auto Cashouts
      crashBets.forEach((bet, bUserId) => {
        if (!bet.cashedOut && bet.autoCashout > 1 && crashMultiplier >= bet.autoCashout) {
          const payout = Math.floor(bet.betAmount * bet.autoCashout);
          bet.cashedOut = true;
          bet.payout = payout;
          adjustCredits(bUserId, payout, "crash:win");
          
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
      setTimeout(tick, 100);
    };

    io.emit("crash:start");
    tick();
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
          case 'green': if (resultNumber === 0) { win = true; multiplier = 14; } break;
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
          const winnings = Math.floor(bet.betAmount * multiplier);
          adjustCredits(bet.userId, winnings, "roulette:win");
          updateStats(bet.userId, { 
            roulette_wins: 1,
            max_roulette_win: winnings,
            ...(isStraight ? { roulette_straight_wins: 1 } : {})
          });
          
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

  // --- Jackpot Helper ---
  const checkJackpot = (userId: string, username: string, betAmount: number, game: string = 'unknown') => {
    addToJackpot(betAmount * 0.01);
    const newJackpot = getJackpot();
    console.log(`[jackpot] ${game} bet $${betAmount} by ${username} → pool now $${newJackpot.toFixed(2)}`);
    io.emit("jackpot:update", newJackpot);
    if (Math.random() < 0.0002) {
      console.log(`JACKPOT HIT: ${username} wins $${newJackpot} (from ${game})`);
      adjustCredits(userId, newJackpot, "jackpot:win");
      resetJackpot();
      io.emit("jackpot:winner", { username, amount: newJackpot });
      io.emit("jackpot:update", getJackpot());
    }
  };

  // --- Multiplayer Blackjack Table ---
  const bjTable = new BlackjackTable(io, userSockets, { adjustCredits, updateStats, activityHistory, checkAchievements, broadcastLeaderboards, getUser, checkJackpot });

  io.on("connection", (socket: any) => {
    const userId = socket.user.id;

    // 1. Kick older session if exists
    const oldSocketId = userSockets.get(userId);
    if (oldSocketId) {
      io.to(oldSocketId).emit("kick", "Logged in from another location");
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) oldSocket.disconnect();
    }

    // 2. Register new socket
    userSockets.set(userId, socket.id);
    broadcastOnline();
    console.log(`User connected: ${socket.user.username}`);

    // 3. Initial Data
    socket.emit("server:version", SERVER_VERSION);
    socket.emit("user_data", socket.user);
    socket.emit("user_achievements", getAchievements(userId));
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

    socket.on("crash:join", () => {
      socket.emit("crash:sync", {
        state: crashState,
        multiplier: crashMultiplier,
        history: crashHistory,
        timeLeft: crashCurrentWait,
        points: crashPoints,
        bets: Array.from(crashBets.values())
      });
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
        socket.emit("error", err.message);
      }
    });

    socket.on("crash:bet", (data: { betAmount: number, autoCashout?: number }) => {
      if (crashState !== 'waiting') return socket.emit("error", "Game already in progress");
      if (crashBets.has(userId)) return socket.emit("error", "Already placed a bet");
      
      const { betAmount, autoCashout } = data;
      if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      
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
        socket.emit("error", err.message);
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
      let { betAmount, count } = data;
      if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      
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

        const updatedUser = getUser(userId) as any;
        checkAchievements(userId);
        
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
        socket.emit("error", err.message);
      }
    });

    // --- Plinko Handlers ---
    socket.on("plinko:drop", (data: { betAmount: number, risk: string, rows: number }) => {
      const { betAmount, risk, rows } = data;
      if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      
      try {
        const user = getUser(userId) as any;
        if (user.credits < betAmount) return socket.emit("error", "Insufficient credits");
        
        // Deduct bet
        adjustCredits(userId, -betAmount, "plinko:bet");
        checkJackpot(userId, socket.user.username, betAmount, 'plinko');
        checkAchievements(userId);

        // Generate result
        const { path, slot } = generatePlinkoPath(rows);
        const multiplier = MULTIPLIERS[rows]?.[risk]?.[slot] || 0;
        const winnings = Math.floor(betAmount * multiplier);
        
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
        socket.emit("error", err.message || "Failed to place bet");
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
        console.error("Error processing plinko landing:", err);
      }
    });

    socket.on("plinko:drop-multi", (data: { betAmount: number, risk: string, rows: number, count: number }) => {
      const { betAmount, risk, rows, count } = data;
      const totalBet = betAmount * count;
      if (betAmount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      if (count < 1 || count > 10) return socket.emit("error", "Invalid count (max 10)");
      
      try {
        const user = getUser(userId) as any;
        if (user.credits < totalBet) return socket.emit("error", "Insufficient credits");
        
        // Deduct total bet
        adjustCredits(userId, -totalBet, "plinko:bet-multi");
        checkJackpot(userId, socket.user.username, totalBet, 'plinko');
        checkAchievements(userId);
        
        const results = [];
        let totalWinnings = 0;
        
        for (let i = 0; i < count; i++) {
          const { path, slot } = generatePlinkoPath(rows);
          const multiplier = MULTIPLIERS[rows]?.[risk]?.[slot] || 0;
          const winnings = Math.floor(betAmount * multiplier);
          
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
        socket.emit("error", err.message || "Failed to place multi-bet");
      }
    });

    socket.on("crash:cashout", () => {
      if (crashState !== 'running') return socket.emit("error", "Game not running");
      const bet = crashBets.get(userId);
      if (!bet || bet.cashedOut) return socket.emit("error", "No active bet or already cashed out");

      const payout = Math.floor(bet.betAmount * crashMultiplier);
      bet.cashedOut = true;
      bet.payout = payout;

      adjustCredits(userId, payout, "crash:win");
      updateStats(userId, { max_crash_multiplier: crashMultiplier });
      
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
    socket.on("slots:spin", async (data: { betAmount: number }) => {
      const { betAmount } = data;
      try {
        // 1. Deduct Bet
        adjustCredits(userId, -betAmount, "slots:bet");

        // 2. Jackpot contribution + win check
        checkJackpot(userId, socket.user.username, betAmount, 'slots');

        // 4. Game Logic (Simplified for now, should be more robust)
        // In a real app, we'd run the full grid generation and win calculation here
        // For this demo, we'll just emit a "request_result" and let the client handle some parts 
        // OR we can implement a basic server-side result.
        
        // Let's just send a success and the updated balance for now
        const user = getUser(userId) as any;
        socket.emit("user_data", user);
        socket.emit("slots:result", { success: true });
        broadcastLeaderboards();

      } catch (err: any) {
        socket.emit("error", err.message);
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
        socket.emit("error", err.message);
      }
    });

    socket.on("wins:reveal", (data: { amount: number, betAmount?: number, game?: string }) => {
      const { amount, betAmount = 0, game = "slots" } = data;
      const net = amount - betAmount;

      if (amount > 0) {
        adjustCredits(userId, amount, `${game}:win`);
        if (game.toLowerCase() === 'blackjack') {
          updateStats(userId, { blackjack_wins: 1 });
        }
      }

      // Record activity if it's not a wash
      if (net !== 0) {
        const activityType = net > 0 ? "win" : "loss";
        const displayAmount = Math.abs(net);

        const winActivity = {
          id: Math.random().toString(36).substr(2, 9),
          username: socket.user.username,
          amount: displayAmount,
          type: activityType,
          game: game.charAt(0).toUpperCase() + game.slice(1),
          timestamp: Date.now(),
        };
        
        activityHistory.unshift(winActivity);
        if (activityHistory.length > 50) activityHistory.pop();
        
        io.emit("activity:new", winActivity);
        
        const user = getUser(userId) as any;
        socket.emit("user_data", user);
        broadcastLeaderboards();
        checkAchievements(userId);
      }
    });

    socket.on("activity:reveal", () => {
      const pending = pendingWins.get(userId) || [];
      pendingWins.delete(userId);
      for (const activity of pending) {
        activityHistory.unshift(activity);
        if (activityHistory.length > 50) activityHistory.pop();
        io.emit("activity:new", activity);
      }
    });

    socket.on("roulette:bet", (data: { amount: number, type: string, value: any }) => {
      if (rouletteState !== 'waiting') return socket.emit("error", "Betting is closed");
      const { amount, type, value } = data;
      if (amount < 0.01) return socket.emit("error", "Minimum bet is $0.01");
      
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
        socket.emit("error", err.message || "Failed to place bet");
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
        socket.emit("error", err.message || "Failed to remove bet");
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
      const message = {
        id: Math.random().toString(36).substr(2, 9),
        username: socket.user.username,
        text,
        timestamp: Date.now(),
      };
      io.emit("chat:new", message);
    });

    // --- Multiplayer Blackjack Handlers ---
    socket.on("bj:sync", () => { socket.emit('blackjack:state', bjTable.getState()); });
    socket.on("bj:sit", (data: { seatIndex: number }) => {
      const err = bjTable.joinSeat(userId, socket.user.username, data.seatIndex);
      if (err) socket.emit('error', err);
    });
    socket.on("bj:leave", () => { bjTable.leaveSeat(userId); });
    socket.on("bj:bet", (data: { amount: number }) => {
      const err = bjTable.placeBet(userId, data.amount);
      if (err) socket.emit('error', err);
      else checkAchievements(userId);
    });
    socket.on("bj:hit", () => { const err = bjTable.hit(userId); if (err) socket.emit('error', err); });
    socket.on("bj:stand", () => { const err = bjTable.stand(userId); if (err) socket.emit('error', err); });
    socket.on("bj:double", () => { const err = bjTable.double(userId); if (err) socket.emit('error', err); });
    socket.on("bj:split", () => { const err = bjTable.split(userId); if (err) socket.emit('error', err); });

    socket.on("disconnect", () => {
      bjTable.leaveSeat(userId);
      if (userSockets.get(userId) === socket.id) {
        userSockets.delete(userId);
      }
      broadcastOnline();
      console.log(`User disconnected: ${socket.user.username}`);
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

startServer();
