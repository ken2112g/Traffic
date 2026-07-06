#!/usr/bin/env node
/**
 * Run one action with one account for testing.
 * Browser is visible by default so you can watch it.
 *
 * Usage:
 *   node scripts/run-once.js --platform pinterest --username abc@gmail.com --action like
 *   node scripts/run-once.js --id <account-id> --action follow --url https://pinterest.com/targetuser/
 *   node scripts/run-once.js --username abc@gmail.com --action like --headless
 */

import 'dotenv/config';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { getDb } from '../src/db/schema.js';

function parseArgs(argv) {
  const args  = argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      flags[key] = (args[i + 1] && !args[i + 1].startsWith('--')) ? args[++i] : true;
    }
  }
  return flags;
}

function buildDefaultUrl(platform, username) {
  if (platform === 'instagram') return `https://www.instagram.com/${username}/`;
  if (platform === 'tiktok')    return `https://www.tiktok.com/@${username}`;
  if (platform === 'twitter')   return `https://twitter.com/${username}`;
  return `https://www.pinterest.com/${username}/`;
}

const flags     = parseArgs(process.argv);
const platform  = flags.platform || 'pinterest';
const action    = flags.action   || 'like';
const targetUrl = flags.url || null;

const wantHeadless = flags.headless === true || flags.headless === 'true';
process.env.HEADLESS = wantHeadless ? 'true' : 'false';

const db = getDb();
let account;

if (flags.id) {
  account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(flags.id);
} else if (flags.username) {
  account = db.prepare('SELECT * FROM accounts WHERE username = ? AND platform = ?')
              .get(flags.username, platform);
} else {
  account = db.prepare(`SELECT * FROM accounts WHERE platform = ? AND role = "sub" AND status = "idle" LIMIT 1`)
              .get(platform);
}

if (!account) {
  console.error(chalk.red('\nAccount not found.'));
  console.error(chalk.gray('  Use: --username <user> | --id <id>'));
  console.error(chalk.gray('  Or add one first: npm run cli add-account ...\n'));
  process.exit(1);
}

const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
console.log(chalk.bold('\n======================================'));
console.log(chalk.bold(`  Run-Once -- ${platformLabel} Worker Test`));
console.log(chalk.bold('======================================'));
console.log(`  Platform : ${chalk.cyan(platform)}`);
console.log(`  Account  : ${chalk.cyan(account.username)} (${account.role})`);
console.log(`  Action   : ${chalk.cyan(action)}`);
console.log(`  Target   : ${chalk.cyan(targetUrl || '(default profile)')}`);
console.log(`  Browser  : ${chalk.cyan(wantHeadless ? 'headless' : 'visible (headful)')}`);
console.log(`  Session  : ${chalk.cyan(account.session_path && existsSync(account.session_path) ? 'saved (skip login)' : 'none -- will login')}`);
console.log('');

const workerPaths = {
  pinterest: '../src/workers/pinterest.worker.js',
  instagram: '../src/workers/instagram.worker.js',
  tiktok:    '../src/workers/tiktok.worker.js',
};

const workerPath = workerPaths[platform];
if (!workerPath) {
  console.error(chalk.red(`No worker for platform: ${platform}`));
  process.exit(1);
}

const mod         = await import(workerPath);
const WorkerClass = Object.values(mod).find(v => typeof v === 'function');
if (!WorkerClass) {
  console.error(chalk.red(`Could not find exported class in ${workerPath}`));
  process.exit(1);
}

const worker      = new WorkerClass();
const resolvedUrl = targetUrl || buildDefaultUrl(platform, account.username);

console.log(chalk.gray('  Starting browser...\n'));
const startTime = Date.now();

try {
  await worker.run({ accountId: account.id, action, targetUrl: resolvedUrl });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(chalk.bold.green(`\nDone -- [${platform}:${action}] finished in ${elapsed}s`));
  console.log(chalk.gray(`  Account: ${account.username}\n`));

} catch (err) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.error(chalk.bold.red(`\nFailed after ${elapsed}s: ${err.message}\n`));

  if (process.env.LOG_LEVEL === 'debug') {
    console.error(err);
  } else {
    console.error(chalk.gray('  (run with LOG_LEVEL=debug to see stack trace)\n'));
  }
  process.exit(1);
}

process.exit(0);