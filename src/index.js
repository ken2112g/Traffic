import 'dotenv/config';
import chalk from 'chalk';
import { getDb } from './db/schema.js';
import { accountManager } from './core/accountManager.js';
import { proxyManager } from './core/proxyManager.js';
import { scheduler } from './core/scheduler.js';
import { startWorker, getQueue, getQueueStats } from './core/queue.js';
import { logger } from './utils/logger.js';

import { PinterestWorker } from './workers/pinterest.worker.js';
import { InstagramWorker } from './workers/instagram.worker.js';
import { TikTokWorker }    from './workers/tiktok.worker.js';

// Pass classes (not instances) -- queue.js instantiates a fresh worker per job
const platformWorkers = {
  pinterest: PinterestWorker,
  instagram: InstagramWorker,
  tiktok:    TikTokWorker,
};

async function main() {
  console.log(chalk.bold.green('\n==========================================='));
  console.log(chalk.bold.green('   TRAFFIC TOOL -- Multi-Platform Engine'));
  console.log(chalk.bold.green('===========================================\n'));

  logger.info('Main', 'Init database...');
  getDb();

  logger.info('Main', 'Start queue worker...');
  const worker = startWorker(platformWorkers);

  logger.info('Main', 'Start scheduler...');
  await scheduler.startAll();

  printStats();

  logger.info('Main', chalk.green('Engine running... Ctrl+C to stop\n'));

  process.on('SIGINT', async () => {
    logger.info('Main', 'Stopping engine...');
    scheduler.stopAll();
    await worker.close();
    await getQueue().close();
    process.exit(0);
  });

  setInterval(printStats, 5 * 60 * 1000);
}

async function printStats() {
  const accStats   = accountManager.getStats();
  const proxyStats = proxyManager.getStats();
  const schedStats = scheduler.getStats();
  const queueStats = await getQueueStats();

  console.log(chalk.bold('\n--- Stats ---'));
  console.log(`Accounts : ${accStats.active} idle | ${accStats.running} running | ${accStats.banned} banned`);
  console.log(`Proxies  : ${proxyStats.active} active | ${proxyStats.dead} dead`);
  console.log(`Campaigns: ${schedStats.activeCampaigns} active`);
  console.log(`Tasks    : ${queueStats.waiting} waiting | ${queueStats.active} active | ${schedStats.doneTasks} done | ${schedStats.failedTasks} failed`);
  console.log('---\n');
}

main().catch(err => {
  logger.error('Main', 'Engine startup error', err);
  process.exit(1);
});