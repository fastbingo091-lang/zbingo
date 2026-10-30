const { hmacHex, randomServerSeed, sha256Hex } = require('./fairRng');

const INSTANT_CRASH_PERCENT = 8;
const MAX_MULTIPLIER = 500;
const GROWTH_MS = 7000;

function firstBitsToNumber(hex, bits = 52) {
  const chars = Math.ceil(bits / 4);
  const value = BigInt(`0x${hex.slice(0, chars)}`);
  const shift = BigInt(chars * 4 - bits);
  return Number(value >> shift);
}

function calculateCrashPoint(serverSeed, roundNumber, salt = 'gebres-staircase-run') {
  const hash = hmacHex(serverSeed, `${salt}:${roundNumber}`);
  const instantBucket = Number(BigInt(`0x${hash.slice(0, 8)}`) % 100n);
  if (instantBucket < INSTANT_CRASH_PERCENT) {
    return { crashMultiplier: 1, instantCrash: true, hash, serverSeedHash: sha256Hex(serverSeed) };
  }

  const max = 2 ** 52;
  const n = firstBitsToNumber(hash.slice(8), 52);
  const r = Math.min(0.999999999999, Math.max(0, n / max));
  const raw = 1 / (1 - r);
  const crashMultiplier = Math.max(1.01, Math.floor(raw * 100) / 100);
  return { crashMultiplier, instantCrash: false, hash, serverSeedHash: sha256Hex(serverSeed) };
}

function multiplierAt(elapsedMs) {
  const mult = Math.exp(Math.max(0, elapsedMs) / GROWTH_MS);
  return Math.max(1, Math.floor(mult * 100) / 100);
}

function timeToMultiplier(multiplier) {
  return Math.max(0, Math.log(Math.max(1, Number(multiplier))) * GROWTH_MS);
}

module.exports = {
  GROWTH_MS,
  INSTANT_CRASH_PERCENT,
  MAX_MULTIPLIER,
  calculateCrashPoint,
  hmacHex,
  multiplierAt,
  randomServerSeed,
  sha256Hex,
  timeToMultiplier,
};
