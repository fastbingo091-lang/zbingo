const KENO_MAX_NUMBER = 80;
const KENO_DRAW_COUNT = 20;
const KENO_MAX_PICKS = 20;
const KENO_MIN_BET = 10;
const KENO_MAX_BET = 200;
const KENO_MAX_PAYOUT_ETB = 500000;
const KENO_MAX_MULTIPLIER = 2500;
const { makeProof, randomServerSeed, seededShuffle } = require('./fairRng');

// Official Keno Multiplier Paytable
// Only valid pick counts: 1-8, 10, 20
// Any hit combination not explicitly listed = 0x (loss)
const PAYOUT_TABLE = {
  1:  { 1: 2 },
  2:  { 2: 10 },
  3:  { 3: 25,  2: 2 },
  4:  { 4: 100, 3: 4,  2: 1 },
  5:  { 5: 500, 4: 15, 3: 2 },
  6:  { 6: 1000, 5: 40, 4: 4,  3: 1 },
  7:  { 7: 2000, 6: 100, 5: 15, 4: 2 },
  8:  { 8: 2500, 7: 400, 6: 40, 5: 5 },
  10: { 10: 2500, 9: 2500, 8: 2500, 7: 100, 6: 15, 5: 2 },
  20: { 20: 2500, 19: 2500, 18: 2500, 17: 2500, 16: 2500, 15: 2500, 14: 2500, 13: 2500, 12: 2500, 11: 100, 10: 50, 9: 5, 8: 2 },
};

// Valid pick counts per the official paytable
const VALID_PICK_COUNTS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 10, 20]);

function uniqueSortedNumbers(numbers) {
  return [...new Set(numbers.map(n => Number(n)))].sort((a, b) => a - b);
}

function kenoConfig(settings = {}) {
  return {
    maxPicks: Number.isInteger(Number(settings.maxPicks)) ? Number(settings.maxPicks) : KENO_MAX_PICKS,
    minBet: Number.isInteger(Number(settings.minBet)) ? Number(settings.minBet) : KENO_MIN_BET,
    maxBet: Number.isInteger(Number(settings.maxBet)) ? Number(settings.maxBet) : KENO_MAX_BET,
    bettingAmounts: Array.isArray(settings.bettingAmounts) ? settings.bettingAmounts.map(Number).filter(Number.isInteger) : null,
    maxPayoutEtb: Number.isFinite(Number(settings.maxPayoutEtb)) ? Number(settings.maxPayoutEtb) : KENO_MAX_PAYOUT_ETB,
    maxMultiplier: Number.isFinite(Number(settings.maxMultiplier)) ? Number(settings.maxMultiplier) : KENO_MAX_MULTIPLIER,
    payoutTable: settings.payoutTable && typeof settings.payoutTable === 'object' ? settings.payoutTable : PAYOUT_TABLE,
  };
}

function validateKenoPicks(picks, settings = {}) {
  const cfg = kenoConfig(settings);
  const clean = uniqueSortedNumbers(Array.isArray(picks) ? picks : []);
  if (clean.length < 1) return { error: 'Pick at least 1 number.' };
  if (clean.length > cfg.maxPicks) return { error: `Pick up to ${cfg.maxPicks} numbers.` };
  if (!VALID_PICK_COUNTS.has(clean.length)) return { error: `Invalid pick count. Choose: ${[...VALID_PICK_COUNTS].sort((a,b)=>a-b).join(', ')} numbers.` };
  if (clean.some(n => !Number.isInteger(n) || n < 1 || n > KENO_MAX_NUMBER)) return { error: 'Numbers must be from 1 to 80.' };
  return { picks: clean };
}

function validateKenoBet(bet, settings = {}) {
  const cfg = kenoConfig(settings);
  const amount = Number(bet);
  if (!Number.isInteger(amount) || amount < cfg.minBet) return { error: `Minimum bet is ${cfg.minBet} ETB.` };
  if (amount > cfg.maxBet) return { error: `Maximum bet is ${cfg.maxBet} ETB.` };
  if (cfg.bettingAmounts && cfg.bettingAmounts.length && !cfg.bettingAmounts.includes(amount)) {
    return { error: `Bet amount must be one of: ${cfg.bettingAmounts.join(', ')} ETB.` };
  }
  return { bet: amount };
}

function drawKenoNumbers(serverSeed = randomServerSeed(), roundId = Date.now()) {
  const pool = Array.from({ length: KENO_MAX_NUMBER }, (_, i) => i + 1);
  return seededShuffle(pool, serverSeed, `keno:${roundId}`).slice(0, KENO_DRAW_COUNT);
}

function drawKenoRound(roundId = Date.now(), serverSeed = randomServerSeed()) {
  const drawn = drawKenoNumbers(serverSeed, roundId);
  const proof = makeProof(serverSeed, roundId, 'keno');
  return { drawn, proof };
}

function calculateKenoResult(picks, drawn, bet, settings = {}) {
  const cfg = kenoConfig(settings);
  const pickSet = new Set(picks);
  const matches = drawn.filter(n => pickSet.has(n)).sort((a, b) => a - b);
  const matchCount = matches.length;
  const pickCount = picks.length;

  // Lookup multiplier from official paytable
  const rawMultiplier = (cfg.payoutTable[pickCount] && cfg.payoutTable[pickCount][matchCount]) || 0;

  // Calculate payout with financial caps
  let rawPayout = bet * rawMultiplier;

  // Enforce absolute max payout cap (500,000 ETB)
  let capped = false;
  let payout = rawPayout;
  if (rawPayout > cfg.maxPayoutEtb) {
    payout = cfg.maxPayoutEtb;
    capped = true;
  }

  // Enforce max multiplier cap (2,500x)
  const effectiveMultiplier = bet > 0 ? payout / bet : 0;
  if (effectiveMultiplier > cfg.maxMultiplier && !capped) {
    payout = bet * cfg.maxMultiplier;
    capped = true;
  }

  const multiplier = bet > 0 ? Math.floor((payout / bet) * 100) / 100 : 0;

  return {
    matches,
    matchCount,
    multiplier,
    payout,
    rawMultiplier,
    capped: capped || rawPayout > payout,
    pickCount,
  };
}

function maxKenoPayout(pickCount, bet, settings = {}) {
  const cfg = kenoConfig(settings);
  const table = cfg.payoutTable[pickCount];
  if (!table) return 0;
  const maxMultiplier = Math.max(0, ...Object.values(table));
  return Math.min(bet * maxMultiplier, cfg.maxPayoutEtb);
}

module.exports = {
  KENO_DRAW_COUNT,
  KENO_MAX_PAYOUT_ETB,
  KENO_MAX_NUMBER,
  KENO_MAX_PICKS,
  KENO_MIN_BET,
  KENO_MAX_BET,
  KENO_MAX_MULTIPLIER,
  VALID_PICK_COUNTS,
  PAYOUT_TABLE,
  calculateKenoResult,
  drawKenoRound,
  drawKenoNumbers,
  kenoConfig,
  maxKenoPayout,
  validateKenoBet,
  validateKenoPicks,
};
