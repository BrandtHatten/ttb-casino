import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'casino.db');

const db = new Database(dbPath);

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    password_hash TEXT,
    credits REAL DEFAULT 1000.0,
    total_wagered REAL DEFAULT 0.0,
    is_admin INTEGER DEFAULT 0,
    is_banned INTEGER DEFAULT 0,
    daily_reward_date TEXT,
    weekly_reward_date TEXT,
    interest_date TEXT,
    total_bets INTEGER DEFAULT 0,
    total_wins INTEGER DEFAULT 0,
    net_profit REAL DEFAULT 0.0,
    biggest_win REAL DEFAULT 0.0,
    blackjack_wins INTEGER DEFAULT 0,
    max_crash_multiplier REAL DEFAULT 0.0,
    max_plinko_multiplier REAL DEFAULT 0.0,
    interest_claims INTEGER DEFAULT 0,
    roulette_wins INTEGER DEFAULT 0,
    roulette_straight_wins INTEGER DEFAULT 0,
    max_roulette_win REAL DEFAULT 0.0
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    amount REAL,
    balance_after REAL,
    description TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS jackpot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    amount REAL DEFAULT 2000.0
  );

  CREATE TABLE IF NOT EXISTS user_achievements (
    user_id TEXT,
    achievement_id TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, achievement_id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  INSERT OR IGNORE INTO jackpot (id, amount) VALUES (1, 2000.0);
`);

// Migration: Add missing columns if they don't exist
const tableInfo = db.prepare("PRAGMA table_info(users)").all() as any[];
const columns = tableInfo.map(col => col.name);

if (!columns.includes('total_bets')) {
  db.exec("ALTER TABLE users ADD COLUMN total_bets INTEGER DEFAULT 0");
}
if (!columns.includes('total_wins')) {
  db.exec("ALTER TABLE users ADD COLUMN total_wins INTEGER DEFAULT 0");
}
if (!columns.includes('net_profit')) {
  db.exec("ALTER TABLE users ADD COLUMN net_profit REAL DEFAULT 0.0");
}
if (!columns.includes('biggest_win')) {
  db.exec("ALTER TABLE users ADD COLUMN biggest_win REAL DEFAULT 0.0");
}
if (!columns.includes('blackjack_wins')) {
  db.exec("ALTER TABLE users ADD COLUMN blackjack_wins INTEGER DEFAULT 0");
}
if (!columns.includes('max_crash_multiplier')) {
  db.exec("ALTER TABLE users ADD COLUMN max_crash_multiplier REAL DEFAULT 0.0");
}
if (!columns.includes('max_plinko_multiplier')) {
  db.exec("ALTER TABLE users ADD COLUMN max_plinko_multiplier REAL DEFAULT 0.0");
}
if (!columns.includes('interest_claims')) {
  db.exec("ALTER TABLE users ADD COLUMN interest_claims INTEGER DEFAULT 0");
}
if (!columns.includes('roulette_wins')) {
  db.exec("ALTER TABLE users ADD COLUMN roulette_wins INTEGER DEFAULT 0");
}
if (!columns.includes('roulette_straight_wins')) {
  db.exec("ALTER TABLE users ADD COLUMN roulette_straight_wins INTEGER DEFAULT 0");
}
if (!columns.includes('max_roulette_win')) {
  db.exec("ALTER TABLE users ADD COLUMN max_roulette_win REAL DEFAULT 0.0");
}

export const getUser = (id: string) => {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
};

export const getUserByUsername = (username: string) => {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
};

export const adjustCredits = (userId: string, delta: number, description: string) => {
  const transaction = db.transaction(() => {
    const user = db.prepare('SELECT credits, total_wagered FROM users WHERE id = ?').get(userId) as any;
    if (!user) throw new Error('User not found');

    // Round delta to cents; wins are always at least $0.01
    const effectiveDelta = delta > 0
      ? Math.max(0.01, Math.round(delta * 100) / 100)
      : Math.round(delta * 100) / 100;

    const newCredits = Math.max(0.01, Math.round((user.credits + effectiveDelta) * 100) / 100);
    if (user.credits + effectiveDelta < 0) throw new Error('Insufficient credits');

    let statsUpdate = '';
    const params: any[] = [newCredits];

    if (effectiveDelta < 0) {
      statsUpdate += ', total_wagered = total_wagered + ?, total_bets = total_bets + 1';
      params.push(Math.abs(effectiveDelta));
    } else if (description.includes('win')) {
      statsUpdate += ', total_wins = total_wins + 1, biggest_win = MAX(biggest_win, ?)';
      params.push(effectiveDelta);
    }
    
    statsUpdate += ', net_profit = net_profit + ?';
    params.push(effectiveDelta);
    params.push(userId);

    db.prepare(`UPDATE users SET credits = ? ${statsUpdate} WHERE id = ?`).run(...params);

    db.prepare('INSERT INTO transactions (user_id, amount, balance_after, description) VALUES (?, ?, ?, ?)').run(
      userId,
      effectiveDelta,
      newCredits,
      description
    );

    return { credits: newCredits };
  });

  return transaction();
};

export const getJackpot = () => {
  return (db.prepare('SELECT amount FROM jackpot WHERE id = 1').get() as any).amount;
};

export const addToJackpot = (amount: number) => {
  db.prepare('UPDATE jackpot SET amount = amount + ? WHERE id = 1').run(amount);
};

export const resetJackpot = () => {
  db.prepare('UPDATE jackpot SET amount = 2000.0 WHERE id = 1').run();
};

export const getLeaderboard = (limit: number = 10) => {
  return db.prepare('SELECT username, credits as balance FROM users ORDER BY credits DESC LIMIT ?').all(limit);
};

export const getMostWagered = (limit: number = 10) => {
  return db.prepare('SELECT username, total_wagered as totalWagered FROM users ORDER BY total_wagered DESC LIMIT ?').all(limit);
};

export const getBiggestWin = (limit: number = 10) => {
  return db.prepare('SELECT username, biggest_win as biggestWin FROM users ORDER BY biggest_win DESC LIMIT ?').all(limit);
};

export const getAchievements = (userId: string) => {
  return db.prepare('SELECT achievement_id, timestamp FROM user_achievements WHERE user_id = ?').all(userId);
};

export const awardAchievement = (userId: string, achievementId: string) => {
  try {
    db.prepare('INSERT OR IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?)').run(userId, achievementId);
    return true;
  } catch (err) {
    return false;
  }
};

export const updateStats = (userId: string, stats: Partial<{
  blackjack_wins: number,
  max_crash_multiplier: number,
  max_plinko_multiplier: number,
  interest_claims: number,
  roulette_wins: number,
  roulette_straight_wins: number,
  max_roulette_win: number
}>) => {
  const updates = Object.entries(stats).map(([key, value]) => {
    if (key.startsWith('max_')) {
      return `${key} = MAX(${key}, ?)`;
    }
    return `${key} = ${key} + ?`;
  });
  
  if (updates.length === 0) return;
  
  const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
  db.prepare(query).run(...Object.values(stats), userId);
};

export default db;
