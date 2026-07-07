import { Queue, Worker, UnrecoverableError } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import 'dotenv/config';

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

const QUEUE_NAME = 'traffic-actions';

let _connection = null;
let _queue      = null;

export function getRedis() {
  if (!_connection) {
    _connection = new IORedis(REDIS_CONFIG);
    _connection.on('error',   (err) => logger.error('Redis', err.message));
    _connection.on('connect', ()    => logger.info('Redis', 'Connected'));
  }
  return _connection;
}

export function getQueue() {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts:         3,
        backoff:          { type: 'exponential', delay: 30000 },
        removeOnComplete: { count: 200 },
        removeOnFail:     { count: 500 },
      },
    });
  }
  return _queue;
}

export async function enqueueTask({ taskId, campaignId, accountId, platform, action, targetUrl, delayMs = 0 }) {
  const db = getDb();
  const id = taskId || randomUUID();

  if (!taskId) {
    const scheduledAt = new Date(Date.now() + delayMs).toISOString();
    db.prepare(`
      INSERT INTO tasks (id, campaign_id, account_id, platform, action, target_url, status, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, "pending", ?)
    `).run(id, campaignId || null, accountId, platform, action, targetUrl, scheduledAt);
  }

  await getQueue().add(
    `${platform}:${action}`,
    { taskId: id, accountId, platform, action, targetUrl },
    { delay: delayMs, jobId: id }
  );

  logger.debug('Queue', `Enqueue [${platform}:${action}] account=${accountId} delay=${Math.round(delayMs/1000)}s`);
  return id;
}

export async function enqueueBatch(tasks, { delayMinMs = 5000, delayMaxMs = 30000 } = {}) {
  let cumulativeDelay = 0;
  const ids = [];
  for (const task of tasks) {
    const jitter = Math.floor(Math.random() * (delayMaxMs - delayMinMs) + delayMinMs);
    cumulativeDelay += jitter;
    ids.push(await enqueueTask({ ...task, delayMs: cumulativeDelay }));
  }
  logger.info('Queue', `Enqueue batch ${tasks.length} tasks`);
  return ids;
}

// Lỗi vĩnh viễn — không nên retry
const isPermanentError = (msg) =>
  /ban|suspend|block|checkpoint|locked|disabled|invalid.*cred|wrong.*pass|account.*disabled/i.test(msg);

export function startWorker(platformWorkers) {
  const db          = getDb();
  const concurrency = parseInt(process.env.MAX_CONCURRENT_BROWSERS || '5');

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { taskId, accountId, platform, action, targetUrl } = job.data;

      db.prepare(`UPDATE tasks SET status = 'running', started_at=datetime('now'), attempts=attempts+1 WHERE id=?`).run(taskId);

      const WorkerClass = platformWorkers[platform];
      if (!WorkerClass) throw new Error(`No worker for platform: ${platform}`);

      const handler = new WorkerClass();
      try {
        await handler.run({ accountId, action, targetUrl });
      } catch (err) {
        // Nếu là lỗi vĩnh viễn → đánh dấu failed ngay, không retry
        if (isPermanentError(err.message)) {
          db.prepare(`UPDATE tasks SET status = 'failed', error=?, finished_at=datetime('now') WHERE id=?`)
            .run(err.message, taskId);
          throw new UnrecoverableError(err.message);
        }
        throw err;
      }

      db.prepare(`UPDATE tasks SET status = 'done', finished_at=datetime('now') WHERE id=?`).run(taskId);
      logger.info('Worker', `[${platform}:${action}] DONE -- account=${accountId}`);
    },
    { connection: getRedis(), concurrency }
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    const { taskId } = job.data;
    // Chỉ update nếu chưa set (UnrecoverableError đã set ở trên)
    const task = getDb().prepare('SELECT status FROM tasks WHERE id=?').get(taskId);
    if (task && task.status !== 'failed') {
      getDb().prepare(`UPDATE tasks SET status = 'failed', error=?, finished_at=datetime('now') WHERE id=?`)
        .run(err.message, taskId);
    }
    logger.error('Worker', `[${job.data.platform}:${job.data.action}] FAILED -- ${err.message}`);
  });

  worker.on('error', (err) => logger.error('Worker', err.message));
  logger.info('Worker', `Started concurrency=${concurrency}`);
  return worker;
}

export async function reEnqueueTask({ taskId, accountId, platform, action, targetUrl, delayMs = 0 }) {
  await getQueue().add(
    `${platform}:${action}`,
    { taskId, accountId, platform, action, targetUrl },
    { delay: Math.max(0, delayMs), jobId: taskId }
  );
  logger.debug('Queue', `Re-enqueue ${taskId} [${platform}:${action}]`);
}

export async function getQueueStats() {
  const queue = getQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(), queue.getActiveCount(), queue.getCompletedCount(),
    queue.getFailedCount(),  queue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}