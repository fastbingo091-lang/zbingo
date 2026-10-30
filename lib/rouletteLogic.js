// ──────────────────────────────────────
// EUROPEAN ROULETTE LOGIC
// 37 numbers: 0 (green) + 1-36 (red/black)
// ──────────────────────────────────────

const { makeProof, randomServerSeed, seededInt } = require('./fairRng');

// ── Financial Constants ──
const ROULETTE_MIN_BET = 10;              // Minimum bet per individual spot (ETB)
const ROULETTE_MAX_BET = 200;             // Maximum bet per individual spot (ETB)
const ROULETTE_MAX_PLAYER_PAYOUT = 500000; // Max aggregate payout per player per spin (ETB)
const ROULETTE_MAX_ROUND_PAYOUT = 500000;  // Max total payout to ALL players per spin (ETB)
const ROULETTE_COMMISSION_RATE = 0.15;     // 15% house commission on net profit.

// Wheel layout (European order)
const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36,
  11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9,
  22, 18, 29, 7, 28, 12, 35, 3, 26,
];

// Red numbers in European roulette
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// Black numbers
const BLACK_NUMBERS = new Set([2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35]);

// Official Bet type definitions — European Roulette paytable
// Payout = bet × multiplier + original stake returned
const BET_TYPES = {
  straight_up:   { payout: 35, desc: 'Straight Up', minNumbers: 1, maxNumbers: 1 },
  split:         { payout: 17, desc: 'Split', minNumbers: 2, maxNumbers: 2 },
  street:        { payout: 11, desc: 'Street', minNumbers: 3, maxNumbers: 3 },
  corner:        { payout: 8,  desc: 'Corner', minNumbers: 4, maxNumbers: 4 },
  six_line:      { payout: 5,  desc: 'Six Line', minNumbers: 6, maxNumbers: 6 },
  dozen:         { payout: 2,  desc: 'Dozen', minNumbers: 12, maxNumbers: 12 },
  column:        { payout: 2,  desc: 'Column', minNumbers: 12, maxNumbers: 12 },
  even_odd:      { payout: 1,  desc: 'Even/Odd', minNumbers: 18, maxNumbers: 18 },
  red_black:     { payout: 1,  desc: 'Red/Black', minNumbers: 18, maxNumbers: 18 },
  low_high:      { payout: 1,  desc: 'Low/High', minNumbers: 18, maxNumbers: 18 },
};

// Columns: 1st col = 1,4,7,...,34; 2nd col = 2,5,8,...,35; 3rd col = 3,6,9,...,36
const COLUMN_1 = new Set(Array.from({ length: 12 }, (_, i) => i * 3 + 1));
const COLUMN_2 = new Set(Array.from({ length: 12 }, (_, i) => i * 3 + 2));
const COLUMN_3 = new Set(Array.from({ length: 12 }, (_, i) => i * 3 + 3));

function getNumberColor(num) {
  if (num === 0) return 'green';
  return RED_NUMBERS.has(num) ? 'red' : 'black';
}

function getWheelIndex(num) {
  return WHEEL_ORDER.indexOf(num);
}

function spinWheel(serverSeed = randomServerSeed(), roundId = Date.now()) {
  const index = seededInt(serverSeed, roundId, WHEEL_ORDER.length, 'roulette');
  const num = WHEEL_ORDER[index];
  return {
    number: num,
    color: getNumberColor(num),
    wheelIndex: getWheelIndex(num),
    proof: makeProof(serverSeed, roundId, 'roulette'),
  };
}

function rouletteConfig(settings = {}) {
  return {
    minBet: Number.isFinite(Number(settings.minBet)) ? Number(settings.minBet) : ROULETTE_MIN_BET,
    maxBet: Number.isFinite(Number(settings.maxBet)) ? Number(settings.maxBet) : ROULETTE_MAX_BET,
    bettingAmounts: Array.isArray(settings.bettingAmounts) ? settings.bettingAmounts.map(Number).filter(Number.isInteger) : null,
    maxPlayerPayout: Number.isFinite(Number(settings.maxPlayerPayout)) ? Number(settings.maxPlayerPayout) : ROULETTE_MAX_PLAYER_PAYOUT,
    maxRoundPayout: Number.isFinite(Number(settings.maxRoundPayout)) ? Number(settings.maxRoundPayout) : ROULETTE_MAX_ROUND_PAYOUT,
    commissionRate: Number.isFinite(Number(settings.commissionRate)) ? Number(settings.commissionRate) : ROULETTE_COMMISSION_RATE,
  };
}

/**
 * Validate a bet placement.
 * bet: { type, numbers: [], amount }
 * Returns { error } or { valid: true }
 */
function validateBet(bet, allowedBets, settings = {}) {
  const cfg = rouletteConfig({ ...settings, bettingAmounts: allowedBets || settings.bettingAmounts });
  if (!bet || !bet.type || !Array.isArray(bet.numbers)) {
    return { error: 'Invalid bet format.' };
  }

  // ── Financial Limits ──
  const amount = Number(bet.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Invalid bet amount.' };
  if (amount < cfg.minBet) return { error: `Minimum bet is ${cfg.minBet} ETB per spot.` };
  if (amount > cfg.maxBet) return { error: `Maximum bet is ${cfg.maxBet} ETB per spot.` };
  if (cfg.bettingAmounts && cfg.bettingAmounts.length && !cfg.bettingAmounts.includes(amount)) {
    return { error: `Bet amount must be one of: ${cfg.bettingAmounts.join(', ')}` };
  }

  const typeDef = BET_TYPES[bet.type];
  if (!typeDef) return { error: `Unknown bet type: ${bet.type}` };

  // Category bets (even_odd, red_black, low_high) use string labels
  const isCategoryBet = bet.type === 'even_odd' || bet.type === 'red_black' || bet.type === 'low_high';

  if (!isCategoryBet) {
    if (bet.numbers.length < typeDef.minNumbers || bet.numbers.length > typeDef.maxNumbers) {
      return { error: `${typeDef.desc} requires ${typeDef.minNumbers}${typeDef.minNumbers !== typeDef.maxNumbers ? ' to ' + typeDef.maxNumbers : ''} number(s).` };
    }
    // Validate numbers are in range
    for (const n of bet.numbers) {
      if (!Number.isInteger(n) || n < 0 || n > 36) {
        return { error: 'All numbers must be 0-36.' };
      }
    }
  }

  // Validate bet-specific number rules
  switch (bet.type) {
    case 'straight_up':
      if (bet.numbers.length !== 1) return { error: 'Straight up: pick exactly 1 number.' };
      break;
    case 'split':
      if (bet.numbers.length !== 2) return { error: 'Split: pick exactly 2 adjacent numbers.' };
      break;
    case 'street':
      if (bet.numbers.length !== 3) return { error: 'Street: pick exactly 3 numbers.' };
      break;
    case 'corner':
      if (bet.numbers.length !== 4) return { error: 'Corner: pick exactly 4 numbers.' };
      break;
    case 'six_line':
      if (bet.numbers.length !== 6) return { error: 'Six Line: pick exactly 6 numbers.' };
      break;
    case 'dozen': {
      const dozen1 = Array.from({ length: 12 }, (_, i) => i + 1);
      const dozen2 = Array.from({ length: 12 }, (_, i) => i + 13);
      const dozen3 = Array.from({ length: 12 }, (_, i) => i + 25);
      const sets = [dozen1, dozen2, dozen3];
      const match = sets.find(s => s.length === bet.numbers.length && s.every(n => bet.numbers.includes(n)));
      if (!match) return { error: 'Invalid dozen. Choose: 1st(1-12), 2nd(13-24), or 3rd(25-36).' };
      break;
    }
    case 'column': {
      const cols = [COLUMN_1, COLUMN_2, COLUMN_3];
      const nums = new Set(bet.numbers);
      const match = cols.find(c => c.size === nums.size && [...c].every(n => nums.has(n)));
      if (!match) return { error: 'Invalid column. Choose a full column of 12 numbers.' };
      break;
    }
    case 'even_odd':
      if (bet.numbers[0] !== 'even' && bet.numbers[0] !== 'odd') {
        return { error: 'Choose "even" or "odd".' };
      }
      break;
    case 'red_black':
      if (bet.numbers[0] !== 'red' && bet.numbers[0] !== 'black') {
        return { error: 'Choose "red" or "black".' };
      }
      break;
    case 'low_high':
      if (bet.numbers[0] !== 'low' && bet.numbers[0] !== 'high') {
        return { error: 'Choose "low" (1-18) or "high" (19-36).' };
      }
      break;
  }

  return { valid: true };
}

/**
 * Maximum possible payout for a single bet type (bet × (multiplier + 1)).
 */
function maxBetReturn(betType) {
  const def = BET_TYPES[betType];
  return def ? ROULETTE_MAX_BET * (def.payout + 1) : 0;
}

/**
 * Maximum possible total payout for a specific player across all their current bets.
 * Used to enforce the per-player 500,000 ETB guardrail BEFORE placing a new bet.
 */
function playerMaxPossiblePayout(playerId, bets, settings = {}) {
  // For any single number 0-36, what's this player's total payout if that number hits?
  let maxPayout = 0;
  const playerBets = Object.values(bets).filter(b => b.playerId === playerId);

  if (playerBets.length === 0) return 0;

  for (let n = 0; n <= 36; n++) {
    let payout = 0;
    for (const bet of playerBets) {
      if (isWinningBet(bet, n)) {
        payout += bet.amount * (BET_TYPES[bet.type].payout + 1);
      }
    }
    maxPayout = Math.max(maxPayout, payout);
  }
  return maxPayout;
}

/**
 * Check if a bet wins against the result number.
 */
function isWinningBet(bet, resultNumber) {
  const n = resultNumber;
  switch (bet.type) {
    case 'straight_up': return bet.numbers.includes(n);
    case 'split':       return bet.numbers.includes(n);
    case 'street':      return bet.numbers.includes(n);
    case 'corner':      return bet.numbers.includes(n);
    case 'six_line':    return bet.numbers.includes(n);
    case 'dozen':       return bet.numbers.includes(n);
    case 'column':      return bet.numbers.includes(n);
    case 'even_odd': {
      if (n === 0) return false;
      const choice = bet.numbers[0];
      if (choice === 'even') return n % 2 === 0;
      if (choice === 'odd')  return n % 2 === 1;
      return false;
    }
    case 'red_black': {
      if (n === 0) return false;
      const choice = bet.numbers[0];
      if (choice === 'red')   return RED_NUMBERS.has(n);
      if (choice === 'black') return BLACK_NUMBERS.has(n);
      return false;
    }
    case 'low_high': {
      if (n === 0) return false;
      const choice = bet.numbers[0];
      if (choice === 'low')  return n >= 1 && n <= 18;
      if (choice === 'high') return n >= 19 && n <= 36;
      return false;
    }
    default: return false;
  }
}

/**
 * Calculate RAW (uncapped) total payout for all bets against result.
 * Includes return of original stake: payout = bet × (multiplier + 1)
 */
function calculatePayouts(bets, resultNumber) {
  let totalPayout = 0;
  const results = [];
  for (const [betId, bet] of Object.entries(bets)) {
    const won = isWinningBet(bet, resultNumber);
    const payout = won ? bet.amount * (BET_TYPES[bet.type].payout + 1) : 0;
    totalPayout += payout;
    results.push({ betId, type: bet.type, numbers: bet.numbers, amount: bet.amount, won, payout });
  }
  return { totalPayout, results };
}

/**
 * Calculate CAPPED payouts with financial guardrails.
 * 
 * Caps applied in order:
 * 1. Per-player cap: no single player receives > 500,000 ETB
 * 2. Per-round cap: total all-player payouts capped at 500,000 ETB,
 *    scaled proportionally by winning bet amounts
 *
 * Returns { totalPayout, results[], roundCapped, playerCaps[] }
 */
function calculateCappedPayouts(bets, resultNumber, settings = {}) {
  const cfg = rouletteConfig(settings);
  // Step 1: Raw payouts
  const raw = calculatePayouts(bets, resultNumber);

  // Step 2: Per-player cap (500,000 ETB per player)
  const playerTotals = {}; // playerId → total raw payout
  const playerCaps = [];

  for (const br of raw.results) {
    if (!br.won || br.payout <= 0) continue;
    const bet = bets[br.betId];
    if (!bet) continue;
    playerTotals[bet.playerId] = (playerTotals[bet.playerId] || 0) + br.payout;
  }

  // Apply per-player caps
  const payoutScaleByPlayer = {}; // playerId → scale factor
  for (const [pid, total] of Object.entries(playerTotals)) {
    if (total > cfg.maxPlayerPayout) {
      payoutScaleByPlayer[pid] = cfg.maxPlayerPayout / total;
      playerCaps.push({ playerId: pid, rawTotal: total, cappedTotal: cfg.maxPlayerPayout });
    }
  }

  for (const br of raw.results) {
    if (!br.won || br.payout <= 0) continue;
    const bet = bets[br.betId];
    if (!bet) continue;
    const scale = payoutScaleByPlayer[bet.playerId];
    if (scale && scale < 1) {
      br.payout = Math.floor(br.payout * scale);
      br.playerCapped = true;
    }
  }

  // Step 3: Aggregate round cap (500,000 ETB total across ALL players)
  let grandTotal = 0;
  for (const br of raw.results) {
    if (br.won && br.payout > 0) grandTotal += br.payout;
  }

  let roundCapped = false;
  if (grandTotal > cfg.maxRoundPayout) {
    roundCapped = true;
    const scale = cfg.maxRoundPayout / grandTotal;

    for (const br of raw.results) {
      if (br.won && br.payout > 0) {
        br.payout = Math.floor(br.payout * scale);
        br.roundCapped = true;
      }
    }
    grandTotal = cfg.maxRoundPayout;
  }

  // Step 4: House commission on net profit.
  let totalCommission = 0;
  for (const br of raw.results) {
    if (!br.won || br.payout <= 0) continue;
    const bet = bets[br.betId];
    if (!bet) continue;
    const profit = br.payout - bet.amount; // net profit only, not returned stake
    if (profit > 0) {
      const comm = Math.floor(profit * cfg.commissionRate);
      br.commission = comm;
      br.payout -= comm;
      totalCommission += comm;
    }
  }
  grandTotal -= totalCommission;

  return {
    totalPayout: grandTotal,
    totalCommission,
    results: raw.results,
    roundCapped,
    playerCaps,
  };
}

/**
 * Get all numbers that cover a bet (for UI highlighting).
 */
function getBetCoveredNumbers(bet) {
  if (bet.type === 'even_odd' || bet.type === 'red_black' || bet.type === 'low_high') {
    return [];
  }
  return bet.numbers;
}

function getWheelOrder() { return [...WHEEL_ORDER]; }
function getRedNumbers() { return new Set(RED_NUMBERS); }
function getBlackNumbers() { return new Set(BLACK_NUMBERS); }
function getBetTypes() { return { ...BET_TYPES }; }

// Helper to get the dozen label
function getDozenLabel(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  if (sorted[0] === 1 && sorted[11] === 12) return '1st 12';
  if (sorted[0] === 13 && sorted[11] === 24) return '2nd 12';
  if (sorted[0] === 25 && sorted[11] === 36) return '3rd 12';
  return '';
}

// Helper to get the column label
function getColumnLabel(numbers) {
  const set = new Set(numbers);
  if (COLUMN_1.size === set.size && [...COLUMN_1].every(n => set.has(n))) return 'Column 1';
  if (COLUMN_2.size === set.size && [...COLUMN_2].every(n => set.has(n))) return 'Column 2';
  if (COLUMN_3.size === set.size && [...COLUMN_3].every(n => set.has(n))) return 'Column 3';
  return '';
}

module.exports = {
  BET_TYPES,
  BLACK_NUMBERS,
  COLUMN_1,
  COLUMN_2,
  COLUMN_3,
  RED_NUMBERS,
  ROULETTE_MAX_BET,
  ROULETTE_MAX_PLAYER_PAYOUT,
  ROULETTE_MAX_ROUND_PAYOUT,
  ROULETTE_MIN_BET,
  ROULETTE_COMMISSION_RATE,
  WHEEL_ORDER,
  calculateCappedPayouts,
  calculatePayouts,
  getBetCoveredNumbers,
  getBetTypes,
  getColumnLabel,
  getDozenLabel,
  getNumberColor,
  getRedNumbers,
  getWheelIndex,
  getWheelOrder,
  isWinningBet,
  maxBetReturn,
  playerMaxPossiblePayout,
  rouletteConfig,
  spinWheel,
  validateBet,
};
