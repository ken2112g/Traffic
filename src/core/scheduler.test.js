import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldScheduleAction } from './scheduler.js';

test('like is always scheduled regardless of rng', () => {
  assert.equal(shouldScheduleAction('like', () => 0.999), true);
  assert.equal(shouldScheduleAction('like', () => 0.001), true);
});

test('follow is always scheduled regardless of rng', () => {
  assert.equal(shouldScheduleAction('follow', () => 0.999), true);
  assert.equal(shouldScheduleAction('follow', () => 0.001), true);
});

test('repin is scheduled only when rng() < 0.5', () => {
  assert.equal(shouldScheduleAction('repin', () => 0.49), true);
  assert.equal(shouldScheduleAction('repin', () => 0.5), false);
  assert.equal(shouldScheduleAction('repin', () => 0.9), false);
});

test('comment is scheduled only when rng() < 0.5', () => {
  assert.equal(shouldScheduleAction('comment', () => 0.1), true);
  assert.equal(shouldScheduleAction('comment', () => 0.75), false);
});

test('default rng produces roughly 50% inclusion over many samples', () => {
  const N = 2000;
  let count = 0;
  for (let i = 0; i < N; i++) if (shouldScheduleAction('repin')) count++;
  const ratio = count / N;
  assert.ok(ratio > 0.4 && ratio < 0.6, `ratio ${ratio} not close to 0.5`);
});
