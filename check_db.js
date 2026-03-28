import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'casino.db');

const db = new Database(dbPath);
const tableInfo = db.prepare("PRAGMA table_info(users)").all();
console.log(JSON.stringify(tableInfo, null, 2));
