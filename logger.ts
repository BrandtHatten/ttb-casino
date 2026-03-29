import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.join(__dirname, 'casino-errors.log');

export function logError(context: string, err: any, meta?: Record<string, any>) {
  const timestamp = new Date().toISOString();
  const message = err?.message || String(err);
  const stack = err?.stack ? `\n  Stack: ${err.stack}` : '';
  const metaStr = meta && Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : '';
  const line = `[${timestamp}] [${context}] ${message}${metaStr}${stack}\n`;

  process.stderr.write(`[ERROR] [${context}] ${message}${metaStr}\n`);

  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // If the log file is inaccessible, ignore silently
  }
}
