import chalk from 'chalk';
import { getDb } from '../db/schema.js';
import 'dotenv/config';

const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVEL_ORDER[process.env.LOG_LEVEL || 'info'] ?? 1;

function timestamp() {
  return new Date().toLocaleTimeString('vi-VN');
}

function saveToDb(level, module, message, meta) {
  try {
    getDb().prepare(
      'INSERT INTO logs (level, module, message, meta) VALUES (?, ?, ?, ?)'
    ).run(level, module || '', message, meta ? JSON.stringify(meta) : null);
  } catch {}
}

export const logger = {
  debug(module, message, meta) {
    if (currentLevel > 0) return;
    console.log(chalk.gray(`[${timestamp()}] [DEBUG] [${module}] ${message}`));
    saveToDb('debug', module, message, meta);
  },
  info(module, message, meta) {
    if (currentLevel > 1) return;
    console.log(chalk.cyan(`[${timestamp()}] [INFO]  [${module}] ${message}`));
    saveToDb('info', module, message, meta);
  },
  warn(module, message, meta) {
    if (currentLevel > 2) return;
    console.log(chalk.yellow(`[${timestamp()}] [WARN]  [${module}] ${message}`));
    saveToDb('warn', module, message, meta);
  },
  error(module, message, meta) {
    console.log(chalk.red(`[${timestamp()}] [ERROR] [${module}] ${message}`));
    if (meta instanceof Error) console.error(meta);
    saveToDb('error', module, message, meta instanceof Error ? { stack: meta.stack } : meta);
  },
};
