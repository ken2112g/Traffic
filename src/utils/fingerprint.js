import { createHash } from 'crypto';

// Mỗi account có fingerprint riêng dựa trên username — deterministic nhưng đa dạng
// Giúp tránh các account có cùng browser signature → khó detect bot network hơn

const LOCALES = ['en-US', 'en-GB', 'en-CA', 'en-AU', 'en-NZ'];

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Vancouver', 'Europe/London', 'Australia/Sydney',
];

const VIEWPORT_BASES = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1280, height: 800 },
  { width: 1600, height: 900 },
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

export function getAccountFingerprint(username) {
  const hash = createHash('sha256').update(String(username)).digest();
  const pick = (arr, i) => arr[hash[i] % arr.length];

  const base = pick(VIEWPORT_BASES, 0);
  // Thêm jitter nhỏ dựa trên hash bytes để viewport không tròn quá
  const width  = base.width  + (hash[3] % 60) - 30;
  const height = base.height + (hash[4] % 40) - 20;

  return {
    locale:     pick(LOCALES, 1),
    timezoneId: pick(TIMEZONES, 2),
    viewport:   { width, height },
    userAgent:  pick(USER_AGENTS, 5),
  };
}