import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { logError } from './logger.js';

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
    max_roulette_win REAL DEFAULT 0.0,
    mines_wins INTEGER DEFAULT 0,
    war_wins INTEGER DEFAULT 0,
    max_wheel_multiplier REAL DEFAULT 0.0
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

// Indexes for common query patterns
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_transactions_user_ts ON transactions(user_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_ua_user_id ON user_achievements(user_id);
  CREATE INDEX IF NOT EXISTS idx_ucp_user_date ON user_challenge_progress(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_pf_user_ts ON provably_fair(user_id, timestamp DESC);
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
if (!columns.includes('mines_wins')) {
  db.exec("ALTER TABLE users ADD COLUMN mines_wins INTEGER DEFAULT 0");
}
if (!columns.includes('war_wins')) {
  db.exec("ALTER TABLE users ADD COLUMN war_wins INTEGER DEFAULT 0");
}
if (!columns.includes('max_wheel_multiplier')) {
  db.exec("ALTER TABLE users ADD COLUMN max_wheel_multiplier REAL DEFAULT 0.0");
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

db.exec(`
  CREATE TABLE IF NOT EXISTS user_free_spins (
    user_id TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0,
    bet_amount REAL DEFAULT 0.0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS daily_challenges (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_value REAL NOT NULL,
    reward REAL NOT NULL,
    date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_challenge_progress (
    user_id TEXT NOT NULL,
    challenge_id TEXT NOT NULL,
    progress REAL DEFAULT 0,
    completed INTEGER DEFAULT 0,
    reward_claimed INTEGER DEFAULT 0,
    date TEXT NOT NULL,
    PRIMARY KEY (user_id, challenge_id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS provably_fair (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    game TEXT NOT NULL,
    round_id TEXT NOT NULL UNIQUE,
    server_seed TEXT NOT NULL,
    server_seed_hash TEXT NOT NULL,
    client_seed TEXT NOT NULL,
    outcome_data TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

export const getFreeSpins = (userId: string) => {
  return db.prepare('SELECT count, bet_amount FROM user_free_spins WHERE user_id = ?').get(userId) as { count: number; bet_amount: number } | undefined;
};
export const setFreeSpins = (userId: string, count: number, betAmount: number) => {
  db.prepare('INSERT OR REPLACE INTO user_free_spins (user_id, count, bet_amount) VALUES (?, ?, ?)').run(userId, count, betAmount);
};
export const clearFreeSpins = (userId: string) => {
  db.prepare('DELETE FROM user_free_spins WHERE user_id = ?').run(userId);
};

export const getTodayChallenges = () => {
  const today = new Date().toISOString().split('T')[0];
  return db.prepare('SELECT * FROM daily_challenges WHERE date = ?').all(today) as any[];
};
export const upsertDailyChallenge = (id: string, description: string, targetType: string, targetValue: number, reward: number, date: string) => {
  db.prepare('INSERT OR IGNORE INTO daily_challenges (id, description, target_type, target_value, reward, date) VALUES (?, ?, ?, ?, ?, ?)').run(id, description, targetType, targetValue, reward, date);
};
export const getUserChallengeProgress = (userId: string) => {
  const today = new Date().toISOString().split('T')[0];
  return db.prepare(`
    SELECT dc.*, COALESCE(ucp.progress, 0) as user_progress, COALESCE(ucp.completed, 0) as completed, COALESCE(ucp.reward_claimed, 0) as reward_claimed
    FROM daily_challenges dc
    LEFT JOIN user_challenge_progress ucp ON dc.id = ucp.challenge_id AND ucp.user_id = ? AND ucp.date = ?
    WHERE dc.date = ?
  `).all(userId, today, today) as any[];
};
export const incrementChallengeProgress = (userId: string, challengeId: string, amount: number) => {
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO user_challenge_progress (user_id, challenge_id, progress, completed, reward_claimed, date) VALUES (?, ?, ?, 0, 0, ?)
    ON CONFLICT(user_id, challenge_id) DO UPDATE SET progress = progress + ?
  `).run(userId, challengeId, amount, today, amount);
  return db.prepare('SELECT progress, completed FROM user_challenge_progress WHERE user_id = ? AND challenge_id = ?').get(userId, challengeId) as { progress: number; completed: number } | undefined;
};
export const markChallengeCompleted = (userId: string, challengeId: string) => {
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO user_challenge_progress (user_id, challenge_id, progress, completed, reward_claimed, date) VALUES (?, ?, 0, 1, 0, ?)
    ON CONFLICT(user_id, challenge_id) DO UPDATE SET completed = 1
  `).run(userId, challengeId, today);
};
export const markChallengeRewardClaimed = (userId: string, challengeId: string) => {
  db.prepare('UPDATE user_challenge_progress SET reward_claimed = 1 WHERE user_id = ? AND challenge_id = ?').run(userId, challengeId);
};

export const recordProvablyFair = (userId: string, game: string, roundId: string, serverSeed: string, serverSeedHash: string, clientSeed: string, outcomeData: string) => {
  try {
    db.prepare('INSERT OR IGNORE INTO provably_fair (user_id, game, round_id, server_seed, server_seed_hash, client_seed, outcome_data) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, game, roundId, serverSeed, serverSeedHash, clientSeed, outcomeData);
  } catch (e) { logError('db:recordProvablyFair', e, { userId, game, roundId }); }
};
export const getProvablyFairRound = (roundId: string) => {
  return db.prepare('SELECT * FROM provably_fair WHERE round_id = ?').get(roundId) as any;
};
export const getUserRecentRounds = (userId: string, limit = 20) => {
  return db.prepare('SELECT * FROM provably_fair WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?').all(userId, limit) as any[];
};

export const updateStats = (userId: string, stats: Partial<{
  blackjack_wins: number,
  max_crash_multiplier: number,
  max_plinko_multiplier: number,
  interest_claims: number,
  roulette_wins: number,
  roulette_straight_wins: number,
  max_roulette_win: number,
  mines_wins: number,
  war_wins: number,
  max_wheel_multiplier: number
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

export const getMostWageredThisWeek = (limit = 10) => {
  return db.prepare(`
    SELECT u.username, SUM(ABS(t.amount)) as totalWagered
    FROM transactions t
    JOIN users u ON t.user_id = u.id
    WHERE t.amount < 0 AND t.timestamp >= datetime('now', '-7 days')
    GROUP BY t.user_id
    ORDER BY totalWagered DESC
    LIMIT ?
  `).all(limit);
};

export const getBiggestWinThisWeek = (limit = 10) => {
  return db.prepare(`
    SELECT u.username, MAX(t.amount) as biggestWin
    FROM transactions t
    JOIN users u ON t.user_id = u.id
    WHERE t.amount > 0 AND t.timestamp >= datetime('now', '-7 days')
    GROUP BY t.user_id
    ORDER BY biggestWin DESC
    LIMIT ?
  `).all(limit);
};

export const getMostProfitableThisWeek = (limit = 10) => {
  return db.prepare(`
    SELECT u.username, SUM(t.amount) as balance
    FROM transactions t
    JOIN users u ON t.user_id = u.id
    WHERE t.timestamp >= datetime('now', '-7 days')
    GROUP BY t.user_id
    HAVING SUM(t.amount) > 0
    ORDER BY balance DESC
    LIMIT ?
  `).all(limit);
};

export default db;
