const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const gameLogic = require('./lib/gameLogic');
const kenoLogic = require('./lib/kenoLogic');
const rouletteLogic = require('./lib/rouletteLogic');
const dinoLogic = require('./lib/dinoLogic');
const hiloLogic = require('./lib/hiloLogic');
const crashLogic = require('./lib/crashLogic');
const finance = require('./lib/finance');
const paymentMatching = require('./lib/paymentMatching');
const { createWalletStore } = require('./lib/walletStore');
const { verifyTelegramInitData } = require('./lib/telegramAuth');
const { isTelegramBotToken } = require('./lib/telegramBotToken');
const { canonicalEthiopianPhone } = require('./lib/phone');
const fairRng = require('./lib/fairRng');

// ──────────────────────────────────────
// CONFIG
// ──────────────────────────────────────
const PORT = process.env.PORT || 5000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 100;
const COUNTDOWN_SECONDS = Math.max(3, Number(process.env.BINGO_COUNTDOWN_SECONDS) || 60);
const DRAW_INTERVAL_MS = Math.max(500, Number(process.env.BINGO_DRAW_INTERVAL_MS) || 5000);
const BINGO_REVEAL_DELAY_MS = 900;
const BINGO_DRAW_DISPLAY_REDUCTION_MS = 1000;
const BINGO_DISCONNECT_GRACE_MS = Math.max(15000, Number(process.env.BINGO_DISCONNECT_GRACE_MS) || 45000);
const PENALTY_SECONDS = 15;
const BINGO_FIRST_FALSE_CLAIM_PENALTY_SECONDS = 5;
const BINGO_REPEAT_FALSE_CLAIM_PENALTY_SECONDS = 10;
const WINNER_DISPLAY_SECONDS = 15;
const BETS = [10, 20, 50, 100, 200];
const STARTING_BALANCE = 50;
const COMMISSION_RATE = 0.20;
const WINNER_SHARE = 0.80;
const MIN_WITHDRAW_ETB = 50;
const MAX_WITHDRAW_ETB = 10000;
const DAILY_WITHDRAW_LIMIT_ETB = 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-before-production';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_TELEGRAM_BOT_TOKEN = process.env.ADMIN_TELEGRAM_BOT_TOKEN || '';
const PAYMENT_SMS_API_KEY = process.env.PAYMENT_SMS_API_KEY || 'change-me-payment-sms-key';
const BOT_SERVER_API_KEY = process.env.BOT_SERVER_API_KEY || PAYMENT_SMS_API_KEY;
const APP_GATE_PASSWORD = process.env.APP_GATE_PASSWORD || 'habesha2026';
const PAYMENT_SMS_ALLOWED_SENDERS = (process.env.PAYMENT_SMS_ALLOWED_SENDERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const PAYMENT_SMS_ALLOW_ANY_SENDER = PAYMENT_SMS_ALLOWED_SENDERS.includes('*');
const PAYMENT_SMS_ALLOWED_DEVICES = (process.env.PAYMENT_SMS_ALLOWED_DEVICES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const ADMIN_TELEGRAM_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || '';
const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'Africa/Nairobi';
const WIN_NOTIFY_SENIOR_ETB = 1000;
const WIN_NOTIFY_MASTER_ETB = 5000;
const AUDIT_LIVE_DAYS = 3;
const PLAYER_HISTORY_DAYS = 3;
const HIGH_WIN_ALERT_MIN_WINS = 4;
const HIGH_WIN_ALERT_MIN_PAYOUT = 200;
const ADMIN_SESSION_MS = 30 * 60 * 1000;
const ADMIN_LOGIN_WINDOW_MS = 60 * 1000;
const ADMIN_MAX_LOGIN_ATTEMPTS = 5;
const PLAYER_LOGIN_WINDOW_MS = 5 * 60 * 1000;
const PLAYER_MAX_LOGIN_ATTEMPTS = 8;
const PLAYER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const COOL_DOWN_LOSS_THRESHOLD = Math.max(20, Number(process.env.COOL_DOWN_LOSS_THRESHOLD || 20));
const COOL_DOWN_HOURS = Number(process.env.COOL_DOWN_HOURS || 3);
const ENFORCE_KENO_VAULT_CHECK = process.env.ENFORCE_KENO_VAULT_CHECK === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto
  .createHash('sha256')
  .update(`${ADMIN_PASSWORD}:${TELEGRAM_BOT_TOKEN}:gamehub-local-session`)
  .digest('hex');
// Runtime-configurable game settings (modified via admin panel)
const runtimeConfig = { MIN_PLAYERS, MAX_PLAYERS, COUNTDOWN_SECONDS, DRAW_INTERVAL_MS, PENALTY_SECONDS, WINNER_DISPLAY_SECONDS, COMMISSION_RATE, WINNER_SHARE, STARTING_BALANCE, COOL_DOWN_LOSS_THRESHOLD, COOL_DOWN_HOURS };
const GAME_PRIZE_VAULTS = Object.freeze({
  bingo: 'bingoPrizeVault',
  keno: 'kenoPrizeVault',
  roulette: 'roulettePrizeVault',
});
const GAME_HOUSE_WIN_VAULTS = Object.freeze({
  keno: 'kenoHouseWinVault',
  roulette: 'rouletteHouseWinVault',
});
const CAPITAL_INJECTION_ACCOUNTS = Object.freeze(['promotion', 'bingoPrizeVault', 'kenoPrizeVault', 'roulettePrizeVault', 'kenoHouseWinVault', 'rouletteHouseWinVault', 'crashVault']);
const DIVIDEND_WITHDRAWAL_ACCOUNTS = Object.freeze(['commission', 'kenoHouseWinVault', 'rouletteHouseWinVault', 'operating']);
const ADMIN_TRANSFER_LOCKED_ACCOUNTS = Object.freeze(['playerLiability', 'withdrawals', 'gameEscrow']);
const POLICY_BODY_MAX_CHARS = Number(process.env.POLICY_BODY_MAX_CHARS || 100000);
const TELEGRAM_BOT_USERNAME = String(process.env.TELEGRAM_BOT_USERNAME || 'zbingo111_bot').replace(/^@/, '').trim();

function gamePrizeVault(game) {
  return GAME_PRIZE_VAULTS[game] || 'prizeVault';
}

function gameHouseWinVault(game) {
  return GAME_HOUSE_WIN_VAULTS[game] || 'commission';
}

const DEFAULT_POLICY_SETTINGS = Object.freeze({
  title: 'HabeshaBingo Player Policy / የሐበሻቢንጎ የተጫዋች ፖሊሲ',
  body: [
    'HabeshaBingo is built for fun, entertainment, and responsible play. Our main goal is to create an enjoyable game experience, not an income source.',
    '',
    'Players must be 18 years or older. Minors are not allowed to register, deposit, or play. If a minor is found using the platform, their remaining balance will be refunded where appropriate and the account will be permanently suspended.',
    '',
    'Games should be played only for entertainment. HabeshaBingo must not be used as a guaranteed way to earn income. Players should use only money they can afford to lose.',
    '',
    'We actively monitor for signs of harmful or addictive play. If our team believes a player is at risk, we may warn, suspend, cool down, or permanently restrict the account for player safety.',
    '',
    'We follow a fair and transparent cost policy. There are no hidden charges. Current fees and limits:',
    '- Bingo commission: 15%',
    '- Withdrawal fee: 2%',
    '- Maximum daily withdrawal: 10,000 ETB',
    '',
    'Game rules, prize rules, fees, and limits may change when needed. Any important change will be shown clearly in the app or bot before it applies.',
    '',
    'By creating an account or continuing to play, you confirm that you are 18+, understand these rules, and agree to use HabeshaBingo responsibly.',
    '',
    '---',
    '',
    'ሐበሻቢንጎ ለመዝናናት፣ ለመጫወት እና በኃላፊነት ለሚደረግ ጨዋታ የተዘጋጀ ነው። ዋና ዓላማችን አስደሳች የጨዋታ ተሞክሮ መፍጠር ነው፤ ይህን መድረክ እንደ የገቢ ምንጭ መጠቀም አይመከርም።',
    '',
    'ተጫዋቾች ዕድሜያቸው 18 ዓመት ወይም ከዚያ በላይ መሆን አለበት። ከ18 ዓመት በታች ያሉ ሰዎች መመዝገብ፣ ገንዘብ ማስገባት ወይም መጫወት አይፈቀድላቸውም። ታናሽ ተጫዋች ከተገኘ፣ ቀሪ ሂሳቡ በተገቢው ሁኔታ ይመለሳል እና አካውንቱ በቋሚነት ይታገዳል።',
    '',
    'ጨዋታዎቹ ለመዝናናት ብቻ መጠቀም አለባቸው። ሐበሻቢንጎ የተረጋገጠ የገቢ መንገድ አይደለም። ተጫዋቾች ሊያጡት የሚችሉትን ገንዘብ ብቻ መጠቀም አለባቸው።',
    '',
    'በጨዋታ ሱስ ወይም ጎጂ የጨዋታ ባህሪ ምልክቶች ላይ በንቃት እንከታተላለን። ተጫዋች አደጋ ላይ ነው ብለን ካመንን፣ ማስጠንቀቂያ፣ ጊዜያዊ እረፍት፣ እገዳ ወይም ቋሚ መከልከል ልንወስድ እንችላለን።',
    '',
    'ፍትሐዊ እና ግልጽ የወጪ ፖሊሲ እንከተላለን። የተደበቁ ክፍያዎች የሉም። አሁን ያሉ ክፍያዎች እና ገደቦች፦',
    '- የቢንጎ ኮሚሽን፦ 15%',
    '- የገንዘብ ማውጫ ክፍያ፦ 2%',
    '- ከፍተኛ የቀን ማውጫ መጠን፦ 10,000 ብር',
    '',
    'የጨዋታ ህጎች፣ የሽልማት ህጎች፣ ክፍያዎች እና ገደቦች በሚያስፈልግ ጊዜ ሊቀየሩ ይችላሉ። አስፈላጊ ለውጦች ከመተግበራቸው በፊት በመተግበሪያው ወይም በቦቱ በግልጽ ይታያሉ።',
    '',
    'አካውንት በመፍጠር ወይም መጫወትን በመቀጠል፣ ዕድሜዎ 18+ መሆኑን፣ እነዚህን ህጎች መረዳትዎን እና በኃላፊነት ለመጠቀም መስማማትዎን ያረጋግጣሉ።',
  ].join('\n'),
  updatedAt: '',
  updatedBy: 'system',
});
const LEGACY_POLICY_BODY = [
  'Players must be 18 or older.',
  'Play responsibly and only use money you can afford to lose.',
  'Deposits and withdrawals are reviewed for payment safety.',
  'Game results are final once a round is completed.',
  'Support can pause accounts when needed for player safety or system security.',
].join('\n');

function normalizePolicySettings(settings = {}) {
  const rawTitle = String(settings.title || '').trim();
  const rawBody = String(settings.body || '').trim();
  const shouldUseDefaultBody =
    !rawBody ||
    rawBody === LEGACY_POLICY_BODY ||
    (/players must be 18 or older/i.test(rawBody) && rawBody.length < 500);
  const isDefaultPolicyBody = shouldUseDefaultBody || /HabeshaBingo is built for fun/i.test(rawBody) || /ሐበሻቢንጎ/.test(rawBody);
  const shouldUseDefaultTitle = !rawTitle || (rawTitle === 'HabeshaBingo Policies' && isDefaultPolicyBody);
  return {
    title: (shouldUseDefaultTitle ? DEFAULT_POLICY_SETTINGS.title : rawTitle).slice(0, 120) || DEFAULT_POLICY_SETTINGS.title,
    body: (shouldUseDefaultBody ? DEFAULT_POLICY_SETTINGS.body : rawBody).slice(0, POLICY_BODY_MAX_CHARS) || DEFAULT_POLICY_SETTINGS.body,
    updatedAt: settings.updatedAt || '',
    updatedBy: settings.updatedBy || 'system',
  };
}

function publicPolicySettings(wallets) {
  return normalizePolicySettings(wallets?.policySettings || {});
}

function defaultGameSettings() {
  return {
    bingo: {
      bettingAmounts: [...BETS],
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      countdownSeconds: COUNTDOWN_SECONDS,
      drawIntervalMs: DRAW_INTERVAL_MS,
      revealDelayMs: BINGO_REVEAL_DELAY_MS,
      winnerDisplaySeconds: WINNER_DISPLAY_SECONDS,
      commissionRate: COMMISSION_RATE,
      winnerShare: WINNER_SHARE,
      falseClaimFirstPenaltySeconds: BINGO_FIRST_FALSE_CLAIM_PENALTY_SECONDS,
      falseClaimRepeatPenaltySeconds: BINGO_REPEAT_FALSE_CLAIM_PENALTY_SECONDS,
    },
    keno: {
      bettingAmounts: [10, 20, 50, 100, 200],
      minBet: kenoLogic.KENO_MIN_BET,
      maxBet: kenoLogic.KENO_MAX_BET,
      maxPicks: kenoLogic.KENO_MAX_PICKS,
      maxPayoutEtb: kenoLogic.KENO_MAX_PAYOUT_ETB,
      maxMultiplier: kenoLogic.KENO_MAX_MULTIPLIER,
      payoutTable: kenoLogic.PAYOUT_TABLE,
    },
    roulette: {
      bettingAmounts: [...ROULETTE_BETS],
      countdownSeconds: ROULETTE_COUNTDOWN,
      resultDisplaySeconds: ROULETTE_RESULT_DISPLAY,
      minBet: rouletteLogic.ROULETTE_MIN_BET,
      maxBet: rouletteLogic.ROULETTE_MAX_BET,
      maxPlayerPayout: rouletteLogic.ROULETTE_MAX_PLAYER_PAYOUT,
      maxRoundPayout: rouletteLogic.ROULETTE_MAX_ROUND_PAYOUT,
      commissionRate: rouletteLogic.ROULETTE_COMMISSION_RATE,
    },
    wallet: {
      minWithdrawEtb: MIN_WITHDRAW_ETB,
      maxWithdrawEtb: MAX_WITHDRAW_ETB,
      dailyWithdrawLimitEtb: DAILY_WITHDRAW_LIMIT_ETB,
      signupPromoEnabled: true,
      signupPromoAmount: STARTING_BALANCE,
      withdrawalFeeEnabled: false,
      withdrawalFeeRate: 0,
      withdrawalFeeFlat: 0,
    },
  };
}

function normalizeBetAmounts(value, fallback) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[,\s]+/);
  const clean = [...new Set(raw.map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0 && n <= 100000))]
    .sort((a, b) => a - b)
    .slice(0, 12);
  return clean.length ? clean : [...fallback];
}

function normalizePayoutTable(value, fallback) {
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = null; }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return JSON.parse(JSON.stringify(fallback));
  const table = {};
  for (const [pickCount, hits] of Object.entries(source)) {
    const pick = Number(pickCount);
    if (!Number.isInteger(pick) || !kenoLogic.VALID_PICK_COUNTS.has(pick)) continue;
    if (!hits || typeof hits !== 'object' || Array.isArray(hits)) continue;
    table[pick] = {};
    for (const [hitCount, multiplier] of Object.entries(hits)) {
      const hit = Number(hitCount);
      const mult = Number(multiplier);
      if (Number.isInteger(hit) && hit >= 0 && hit <= pick && Number.isFinite(mult) && mult >= 0 && mult <= 100000) {
        table[pick][hit] = Math.floor(mult * 100) / 100;
      }
    }
    if (!Object.keys(table[pick]).length) delete table[pick];
  }
  return Object.keys(table).length ? table : JSON.parse(JSON.stringify(fallback));
}

function numberInRange(value, fallback, min, max, integer = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const valueToUse = integer ? Math.round(parsed) : parsed;
  return Math.min(max, Math.max(min, valueToUse));
}

function normalizeGameSettingsBlock(game, settings = {}, defaults = defaultGameSettings()[game]) {
  const source = { ...defaults, ...(settings || {}) };
  if (game === 'bingo') {
    const commissionRate = numberInRange(source.commissionRate, defaults.commissionRate, 0, 0.5);
    return {
      bettingAmounts: normalizeBetAmounts(source.bettingAmounts, defaults.bettingAmounts),
      minPlayers: numberInRange(source.minPlayers, defaults.minPlayers, 2, 20, true),
      maxPlayers: numberInRange(source.maxPlayers, defaults.maxPlayers, 2, 100, true),
      countdownSeconds: numberInRange(source.countdownSeconds, defaults.countdownSeconds, 5, 300, true),
      drawIntervalMs: numberInRange(source.drawIntervalMs, defaults.drawIntervalMs, 1000, 15000, true),
      revealDelayMs: numberInRange(source.revealDelayMs, defaults.revealDelayMs, 250, 3000, true),
      winnerDisplaySeconds: numberInRange(source.winnerDisplaySeconds, defaults.winnerDisplaySeconds, 3, 120, true),
      commissionRate,
      winnerShare: Math.max(0.5, Math.min(1, Number.isFinite(Number(source.winnerShare)) ? Number(source.winnerShare) : 1 - commissionRate)),
      falseClaimFirstPenaltySeconds: numberInRange(source.falseClaimFirstPenaltySeconds, defaults.falseClaimFirstPenaltySeconds, 1, 60, true),
      falseClaimRepeatPenaltySeconds: numberInRange(source.falseClaimRepeatPenaltySeconds, defaults.falseClaimRepeatPenaltySeconds, 1, 120, true),
    };
  }
  if (game === 'keno') {
    return {
      bettingAmounts: normalizeBetAmounts(source.bettingAmounts, defaults.bettingAmounts),
      minBet: numberInRange(source.minBet, defaults.minBet, 1, 100000, true),
      maxBet: numberInRange(source.maxBet, defaults.maxBet, 1, 100000, true),
      maxPicks: numberInRange(source.maxPicks, defaults.maxPicks, 1, kenoLogic.KENO_MAX_PICKS, true),
      maxPayoutEtb: numberInRange(source.maxPayoutEtb, defaults.maxPayoutEtb, 100, 10000000, true),
      maxMultiplier: numberInRange(source.maxMultiplier, defaults.maxMultiplier, 1, 100000, true),
      payoutTable: normalizePayoutTable(source.payoutTable, defaults.payoutTable),
    };
  }
  if (game === 'roulette') {
    return {
      bettingAmounts: normalizeBetAmounts(source.bettingAmounts, defaults.bettingAmounts),
      countdownSeconds: numberInRange(source.countdownSeconds, defaults.countdownSeconds, 5, 300, true),
      resultDisplaySeconds: numberInRange(source.resultDisplaySeconds, defaults.resultDisplaySeconds, 3, 120, true),
      minBet: numberInRange(source.minBet, defaults.minBet, 1, 100000, true),
      maxBet: numberInRange(source.maxBet, defaults.maxBet, 1, 100000, true),
      maxPlayerPayout: numberInRange(source.maxPlayerPayout, defaults.maxPlayerPayout, 100, 10000000, true),
      maxRoundPayout: numberInRange(source.maxRoundPayout, defaults.maxRoundPayout, 100, 10000000, true),
      commissionRate: numberInRange(source.commissionRate, defaults.commissionRate, 0, 0.5),
    };
  }
  if (game === 'wallet') {
    return {
      minWithdrawEtb: numberInRange(source.minWithdrawEtb, defaults.minWithdrawEtb, 1, 1000000, true),
      maxWithdrawEtb: numberInRange(source.maxWithdrawEtb, defaults.maxWithdrawEtb, 1, 1000000, true),
      dailyWithdrawLimitEtb: numberInRange(source.dailyWithdrawLimitEtb, defaults.dailyWithdrawLimitEtb, 1, 10000000, true),
      signupPromoEnabled: source.signupPromoEnabled !== false,
      signupPromoAmount: numberInRange(source.signupPromoAmount, defaults.signupPromoAmount, 0, 100000, true),
      withdrawalFeeEnabled: source.withdrawalFeeEnabled === true,
      withdrawalFeeRate: numberInRange(source.withdrawalFeeRate, defaults.withdrawalFeeRate, 0, 0.25),
      withdrawalFeeFlat: numberInRange(source.withdrawalFeeFlat, defaults.withdrawalFeeFlat, 0, 10000, true),
    };
  }
  return { ...defaults };
}

function normalizeGameSettings(settings = {}) {
  const defaults = defaultGameSettings();
  const activeSource = settings.active || settings || {};
  const pendingSource = settings.pending || {};
  const active = {};
  const pending = {};
  for (const game of Object.keys(defaults)) {
    active[game] = normalizeGameSettingsBlock(game, activeSource[game], defaults[game]);
    if (pendingSource[game]) pending[game] = normalizeGameSettingsBlock(game, pendingSource[game], defaults[game]);
  }
  return {
    active,
    pending,
    updatedAt: settings.updatedAt || '',
    updatedBy: settings.updatedBy || 'system',
    pendingUpdatedAt: settings.pendingUpdatedAt || '',
    pendingUpdatedBy: settings.pendingUpdatedBy || '',
  };
}

function activeGameSettings(wallets, game) {
  wallets.gameSettings = normalizeGameSettings(wallets.gameSettings);
  return wallets.gameSettings.active[game] || defaultGameSettings()[game];
}

function publicGameSettings(wallets) {
  const settings = normalizeGameSettings(wallets?.gameSettings || {});
  return { active: settings.active, pending: settings.pending, updatedAt: settings.updatedAt, updatedBy: settings.updatedBy, pendingUpdatedAt: settings.pendingUpdatedAt, pendingUpdatedBy: settings.pendingUpdatedBy };
}

function activatePendingGameSettings(wallets, game, actor = 'system') {
  wallets.gameSettings = normalizeGameSettings(wallets.gameSettings);
  const pending = wallets.gameSettings.pending?.[game];
  if (!pending) return false;
  wallets.gameSettings.active[game] = normalizeGameSettingsBlock(game, pending);
  delete wallets.gameSettings.pending[game];
  wallets.gameSettings.updatedAt = new Date().toISOString();
  wallets.gameSettings.updatedBy = actor;
  recordAuditEvent(wallets, {
    category: 'system',
    event: 'game_settings_activated',
    actorType: 'system',
    actorName: actor,
    game,
    status: 'ok',
    details: { game, appliedAt: wallets.gameSettings.updatedAt },
  });
  return true;
}

function hasActiveBingoRound() {
  return Object.values(gameRooms || {}).some(room => {
    if (!room) return false;
    if (room.players?.length > 0) return true;
    return !['lobby', 'finished'].includes(room.status);
  });
}

function hasActiveRouletteRound() {
  return rouletteState.status !== 'betting' || Object.keys(rouletteState.bets || {}).length > 0;
}

function canApplyGameSettingsImmediately(game) {
  if (game === 'keno') return true;
  if (game === 'bingo') return !hasActiveBingoRound();
  if (game === 'roulette') return !hasActiveRouletteRound();
  return game === 'wallet';
}

if (ADMIN_PASSWORD === 'change-me-before-production') {
  console.warn('WARNING: Set ADMIN_PASSWORD before using the admin panel outside local development.');
}
if (IS_PRODUCTION) {
  const fatalConfig = [];
  if (ADMIN_PASSWORD === 'change-me-before-production') fatalConfig.push('ADMIN_PASSWORD');
  if (!process.env.SESSION_SECRET || SESSION_SECRET.length < 32) fatalConfig.push('SESSION_SECRET');
  if (!PAYMENT_SMS_API_KEY || PAYMENT_SMS_API_KEY === 'change-me-payment-sms-key') fatalConfig.push('PAYMENT_SMS_API_KEY');
  if (!BOT_SERVER_API_KEY || BOT_SERVER_API_KEY === 'change-me-payment-sms-key') fatalConfig.push('BOT_SERVER_API_KEY');
  if (fatalConfig.length) {
    throw new Error(`Refusing to start in production with unsafe config: ${fatalConfig.join(', ')}`);
  }
}

// ──────────────────────────────────────
// EXPRESS + SOCKET.IO
// ──────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, { perMessageDeflate: false, maxHttpBufferSize: 1e6, pingInterval: 25000, pingTimeout: 20000 });
app.use(express.json({ limit: '32kb' }));
const compressedCache = new Map();
function serveCompressedPublicFile(routePath, filePath, contentType) {
  app.get(routePath, (req, res, next) => {
    if (!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();
    const absolutePath = path.join(__dirname, 'public', filePath);
    fs.stat(absolutePath, (statError, stat) => {
      if (statError) return next();
      const cacheKey = `${absolutePath}:${stat.mtimeMs}:${stat.size}`;
      const cached = compressedCache.get(cacheKey);
      const send = body => {
        const immutable = filePath !== 'index.html';
        res.setHeader('content-type', contentType);
        res.setHeader('content-encoding', 'gzip');
        res.setHeader('vary', 'Accept-Encoding');
        res.setHeader('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-store, must-revalidate');
        if (!immutable) {
          res.setHeader('pragma', 'no-cache');
          res.setHeader('expires', '0');
        }
        res.end(body);
      };
      if (cached) return send(cached);
      fs.readFile(absolutePath, (readError, body) => {
        if (readError) return next();
        zlib.gzip(body, { level: 6 }, (gzipError, zipped) => {
          if (gzipError) return next();
          compressedCache.clear();
          compressedCache.set(cacheKey, zipped);
          send(zipped);
        });
      });
    });
  });
}
serveCompressedPublicFile(['/', '/index.html'], 'index.html', 'text/html; charset=utf-8');
serveCompressedPublicFile('/vendor/three.min.js', 'vendor/three.min.js', 'application/javascript; charset=utf-8');
serveCompressedPublicFile('/vendor/theblindhawk-roulette.js', 'vendor/theblindhawk-roulette.js', 'application/javascript; charset=utf-8');
app.use((req, res, next) => {
  const cacheableStatic = req.method === 'GET' && (req.path.startsWith('/assets/') || req.path.startsWith('/vendor/'));
  if (!cacheableStatic) {
    res.set('Cache-Control', 'no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    const rel = path.relative(path.join(__dirname, 'public'), filePath).replace(/\\/g, '/');
    if (rel.startsWith('assets/') || rel.startsWith('vendor/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.removeHeader('Pragma');
      res.removeHeader('Expires');
    } else if (rel === 'index.html' || rel === '') {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.get('/health', (req, res) => {
  try {
    const wallets = loadWallets();
    const financeHealth = finance.financeHealth(wallets);
    const database = walletStore.info();
    res.status(financeHealth.ok && database.hashOk ? 200 : 503).json({
      ok: financeHealth.ok && database.hashOk,
      version: require('./package.json').version,
      players: Object.keys(wallets.players || {}).length,
      database,
      finance: financeHealth.summary,
      financeIssues: financeHealth.issues,
      configWarnings: systemWarnings(wallets),
      time: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: 'Wallet database is unavailable.',
      detail: error.message,
      database: safeWalletStoreInfo(),
      time: new Date().toISOString(),
    });
  }
});

app.get('/api/public-settings', (req, res) => {
  try {
    const wallets = loadWallets();
    res.json({
      ok: true,
      policies: publicPolicySettings(wallets),
      gameSettings: publicGameSettings(wallets).active,
      responsibleGaming: {
        coolDownLossThreshold: runtimeConfig.COOL_DOWN_LOSS_THRESHOLD,
        coolDownHours: runtimeConfig.COOL_DOWN_HOURS,
      },
    });
  } catch (error) {
    res.status(503).json({ ok: false, error: 'Settings unavailable.' });
  }
});

// App gate authentication — validates password before allowing app usage
// Password stored in DB (wallets.appGate) so admin can change it from the dashboard.
// version increments on every password change, so connected devices detect stale auth.
function getAppGateConfig(wallets) {
  const cfg = wallets.appGate || {};
  return {
    password: cfg.password || APP_GATE_PASSWORD,
    version: cfg.version || 1,
  };
}

app.post('/api/app-auth', (req, res) => {
  if (!rateLimitRequest(req, res, 'app-auth', 30, 60 * 1000)) return;
  const body = req.body || {};
  const password = String(body.password || '').trim();
  const deviceId = String(body.deviceId || '').trim().slice(0, 80);
  
  if (!password) {
    res.status(400).json({ ok: false, error: 'Password is required.' });
    return;
  }

  const wallets = loadWallets();
  const cfg = getAppGateConfig(wallets);
  
  if (!safeEqual(password, cfg.password)) {
    console.warn(`App auth rejected: bad password from device ${deviceId || 'unknown'}`);
    res.status(401).json({ ok: false, error: 'Invalid password.' });
    return;
  }
  
  console.log(`App auth granted: device ${deviceId || 'unknown'}`);
  res.json({ ok: true, passwordVersion: cfg.version });
});

// Quick version-only check for already-authed devices
app.get('/api/app-auth/check', (req, res) => {
  if (!rateLimitRequest(req, res, 'app-auth-check', 60, 60 * 1000)) return;
  const wallets = loadWallets();
  const cfg = getAppGateConfig(wallets);
  res.json({ passwordVersion: cfg.version });
});

app.post('/api/payment-sms', (req, res) => {
  if (!rateLimitRequest(req, res, 'payment-sms', 120, 60 * 1000)) return;
  const expected = `Bearer ${PAYMENT_SMS_API_KEY}`;
  if (!PAYMENT_SMS_API_KEY || PAYMENT_SMS_API_KEY === 'change-me-payment-sms-key') {
    console.warn('WARNING: Set PAYMENT_SMS_API_KEY before using payment SMS API outside local testing.');
  }
  if (!safeEqual(req.get('authorization') || '', expected)) {
    res.status(401).json({ ok: false, error: 'Unauthorized payment SMS API request.' });
    return;
  }

  const body = req.body || {};
  const sender = String(body.sender || '').trim().slice(0, 80);
  const message = String(body.message || '').trim().slice(0, 2000);
  const clientMessageHash = String(body.messageHash || '').trim().slice(0, 128);
  const deviceId = String(body.deviceId || '').trim().slice(0, 80);
  const receivedAt = String(body.receivedAt || new Date().toISOString()).trim().slice(0, 80);
  const simSlot = Number.isFinite(Number(body.simSlot)) ? Number(body.simSlot) : -1;
  const appVersion = String(body.appVersion || '').trim().slice(0, 40);

  if (!sender || !message || !deviceId) {
    res.status(400).json({ ok: false, error: 'sender, message, and deviceId are required.' });
    return;
  }
  if (!PAYMENT_SMS_ALLOW_ANY_SENDER && PAYMENT_SMS_ALLOWED_SENDERS.length && !PAYMENT_SMS_ALLOWED_SENDERS.includes(sender.toLowerCase())) {
    res.status(403).json({ ok: false, error: 'SMS sender is not allowed.' });
    return;
  }
  if (PAYMENT_SMS_ALLOWED_DEVICES.length && !PAYMENT_SMS_ALLOWED_DEVICES.includes(deviceId.toLowerCase())) {
    res.status(403).json({ ok: false, error: 'SMS forwarding device is not allowed.' });
    return;
  }
  const messageHash = fairRng.sha256Hex(`${deviceId}|${sender}|${message}|${receivedAt}`);

  const wallets = loadWallets();
  if (!wallets.paymentSmsInbox) wallets.paymentSmsInbox = [];
  const duplicate = wallets.paymentSmsInbox.find(item =>
    item.messageHash === messageHash ||
    (clientMessageHash && item.clientMessageHash === clientMessageHash)
  );
  if (duplicate) {
    res.json({ ok: true, duplicate: true, id: duplicate.id, status: duplicate.status });
    return;
  }

  const entry = {
    id: fairRng.randomId('sms'),
    deviceId,
    sender,
    message,
    receivedAt,
    simSlot,
    messageHash,
    clientMessageHash,
    appVersion,
    status: sender === 'TEST_SENDER' ? 'test_received' : 'received',
    createdAt: new Date().toISOString(),
  };
  const parsedPayment = paymentMatching.parsePaymentSms(message);
  entry.parsed = parsedPayment;

  if (!wallets.usedPaymentRefs) wallets.usedPaymentRefs = {};
  if (parsedPayment.reference && wallets.usedPaymentRefs[parsedPayment.reference]) {
    entry.status = 'duplicate_reference';
    entry.matchReason = `Reference ${parsedPayment.reference} was already used.`;
  } else if (sender !== 'TEST_SENDER' && parsedPayment.reference && parsedPayment.amount > 0 && parsedPayment.payerLast4) {
    const matches = paymentMatching.findDepositMatches(wallets.requests, parsedPayment, receivedAt);
    if (matches.length === 1) {
      const request = matches[0];
      const wallet = wallets.players[request.playerId];
      if (wallet) {
        const reservedReference = reservePaymentReference(wallets, parsedPayment.reference, {
          smsId: entry.id,
          requestId: request.id,
          playerId: request.playerId,
          amount: request.amount,
          source: 'sms_auto_match',
        });
        if (reservedReference.error) {
          entry.status = 'duplicate_reference';
          entry.matchReason = reservedReference.error;
        } else {
        const credited = finance.creditPlayer(wallets, request.playerId, wallet, request.amount, `Auto deposit approved from SMS ref ${parsedPayment.reference}`, 'deposit_auto_approved', { requestId: request.id, smsId: entry.id, reference: parsedPayment.reference });
        if (credited.error) {
          delete wallets.usedPaymentRefs[reservedReference.reference];
          entry.status = 'match_failed';
          entry.matchReason = credited.error;
        } else {
          markRealDeposit(wallet, request.amount, 'sms_auto_match');
          reclaimSignupPromoCredit(wallets, request.playerId, wallet, 'deposit', { requestId: request.id, amount: request.amount, source: 'sms_auto_match' });
          request.status = 'approved_auto';
          request.resolvedAt = new Date().toISOString();
          request.resolvedBy = 'sms_auto_match';
          request.resolutionNote = `Auto matched SMS ref ${parsedPayment.reference}`;
          request.smsId = entry.id;
          request.reference = parsedPayment.reference;
          recordAdminCashMovement(wallets, {
            adminId: request.depositAccountOwnerAdminId || '',
            type: 'deposit_collected',
            direction: 'in',
            amount: request.amount,
            requestId: request.id,
            playerId: request.playerId,
            playerName: wallet.name || '',
            reference: parsedPayment.reference,
            note: 'Auto-confirmed Telebirr deposit.',
            source: 'sms_auto_match',
            actorType: 'system',
            applyToFloat: true,
          });
          entry.status = 'auto_credited';
          entry.matchedRequestId = request.id;
          entry.matchedPlayerId = request.playerId;
          notifyPlayerTelegram(wallet, `Deposit confirmed\n\n${formatEtb(request.amount)} has been added to your game wallet.\nBalance: ${formatEtb(wallet.balance)}`);
        }
        }
      } else {
        entry.status = 'match_failed';
        entry.matchReason = 'Matched request player wallet was not found.';
      }
    } else if (matches.length > 1) {
      entry.status = 'manual_review';
      entry.matchReason = 'More than one pending deposit matched amount and phone last 4.';
      entry.candidateRequestIds = matches.map(req => req.id);
    } else {
      entry.status = 'unmatched';
      entry.matchReason = 'No pending deposit matched amount, phone last 4, and time window.';
    }
  } else if (sender !== 'TEST_SENDER') {
    entry.status = 'manual_review';
    entry.matchReason = 'Could not extract reference, amount, or payer phone last 4.';
  }

  wallets.paymentSmsInbox.unshift(entry);
  if (wallets.paymentSmsInbox.length > 1000) wallets.paymentSmsInbox.length = 1000;
  finance.recordLedger(wallets, {
    type: 'payment_sms_received',
    amount: 0,
    from: `sms:${deviceId}`,
    to: 'payment_sms_inbox',
    desc: `Payment SMS received from ${sender}`,
    meta: { id: entry.id, messageHash, clientMessageHash, receivedAt },
  });
  saveWallets(wallets);
  if (entry.status === 'auto_credited') {
    io.emit('balanceUpdate', publicWallet(entry.matchedPlayerId, wallets.players[entry.matchedPlayerId]));
  }
  emitAdminDataToAll();
  if (entry.status !== 'test_received') notifySeniorAdmins(wallets, `Payment SMS ${entry.status}\nSender: ${sender}\nAmount: ${parsedPayment.amount || '-'} ETB\nRef: ${parsedPayment.reference || '-'}\n${entry.matchReason || ''}`);
  res.json({ ok: true, id: entry.id, status: entry.status });
});

app.post('/api/bot/deposit-request', (req, res) => {
  if (!requireBotApi(req, res)) return;
  const wallets = loadWallets();
  const match = findWalletByTelegram(wallets, req.body?.telegramId);
  if (!match) { res.status(404).json({ ok: false, error: 'No game account is linked to this Telegram user yet. Open the Mini App once and register.' }); return; }
  const [playerId, wallet] = match;
  const result = createDepositRequest(wallets, playerId, wallet, req.body || {}, 'telegram_bot');
  if (result.error) { res.status(400).json({ ok: false, error: result.error }); return; }
  saveWallets(wallets);
  emitAdminDataToAll();
  if (!result.existing) notifyDepositRequest(wallets, wallet, result.request);
  res.json({ ok: true, request: publicRequest(result.request), account: publicWallet(playerId, wallet) });
});

app.post('/api/bot/withdraw-request', (req, res) => {
  if (!requireBotApi(req, res)) return;
  const wallets = loadWallets();
  const match = findWalletByTelegram(wallets, req.body?.telegramId);
  if (!match) { res.status(404).json({ ok: false, error: 'No game account is linked to this Telegram user yet. Open the Mini App once and register.' }); return; }
  const [playerId, wallet] = match;
  const result = createWithdrawRequest(wallets, playerId, wallet, req.body || {}, 'telegram_bot');
  if (result.error) { res.status(400).json({ ok: false, error: result.error }); return; }
  saveWallets(wallets);
  io.emit('balanceUpdate', publicWallet(playerId, wallet));
  emitAdminDataToAll();
  notifyWithdrawalRequest(wallets, wallet, result.request);
  res.json({ ok: true, request: publicRequest(result.request), account: publicWallet(playerId, wallet) });
});

app.post('/api/bot/register', (req, res) => {
  if (!requireBotApi(req, res)) return;
  const wallets = loadWallets();
  const result = linkTelegramAccount(wallets, req.body || {});
  if (result.error) { res.status(400).json({ ok: false, error: result.error }); return; }
  saveWallets(wallets);
  emitAdminDataToAll();
  notifyPlayerRegistered(wallets, result.id, result.wallet, { existing: !!result.existing, source: 'telegram_bot' });
  res.json({ ok: true, linked: !!result.linked, existing: !!result.existing, account: publicWallet(result.id, result.wallet) });
});

app.post('/api/bot/logout', (req, res) => {
  if (!requireBotApi(req, res)) return;
  const wallets = loadWallets();
  const body = req.body || {};
  const telegramId = String(body.telegramId || '').trim();
  // Find and invalidate the player's session
  const match = findWalletByTelegram(wallets, telegramId);
  if (match) {
    const [playerId, wallet] = match;
    wallet.sessionToken = '';
    wallet.sessionExpiresAt = 0;
    wallet.currentSocketId = null;
    if (wallet.telegramId) {
      wallet.telegramAutoLoginDisabled = true;
      wallet.telegramLogoutSource = 'bot';
      wallet.telegramLoggedOutAt = new Date().toISOString();
    }
    saveWallets(wallets);
    // Disconnect their socket if connected
    io.sockets.sockets.forEach(s => {
      if (s.data?.playerId === playerId) s.disconnect(true);
    });
  }
  res.json({ ok: true });
});

app.get('/api/bot/profile/:telegramId', (req, res) => {
  if (!requireBotApi(req, res)) return;
  const wallets = loadWallets();
  const match = findWalletByTelegram(wallets, req.params.telegramId);
  if (!match) { res.status(404).json({ ok: false, error: 'No linked game account found. Use Register / Link Wallet from the bot menu first.' }); return; }
  res.json({ ok: true, account: publicWallet(match[0], match[1]), requests: getPlayerRequests(wallets, match[0]) });
});

app.post('/api/bot/support-request', (req, res) => {
  if (!requireBotApi(req, res)) return;
  const wallets = loadWallets();
  const body = req.body || {};
  const telegramId = String(body.telegramId || '').trim();
  const username = String(body.username || '').trim().slice(0, 80);
  const name = String(body.name || '').trim().slice(0, 80);
  const match = findWalletByTelegram(wallets, telegramId);
  const message = String(body.message || body.question || '').trim().slice(0, 1000);
  const now = new Date().toISOString();
  const supportRequest = {
    id: fairRng.randomId('sup'),
    type: 'support',
    status: 'open',
    source: 'telegram_bot',
    playerId: match?.[0] || '',
    playerName: match?.[1]?.name || name || '',
    playerPhone: match?.[1]?.phone || '',
    balance: match ? finance.money(match[1].balance || 0) : 0,
    telegramId,
    telegramUsername: username,
    telegramName: name,
    message: message || 'Support button pressed',
    createdAt: now,
    updatedAt: now,
  };
  const assignment = assignSupportRequest(wallets, supportRequest);
  wallets.supportRequests.unshift(supportRequest);
  if (wallets.supportRequests.length > 500) wallets.supportRequests.length = 500;
  const accountLine = match ? `Wallet: ${match[1].name} (${match[1].phone || '-'})\nBalance: ${formatEtb(match[1].balance)}` : 'Wallet: not linked yet';
  const text = `Support request assigned\nRequest: ${supportRequest.id}\nAssigned to: ${supportRequest.assignedAdminName || 'Master review'}\nName: ${name || '-'}\nUsername: ${username ? `@${username}` : '-'}\nTelegram ID: ${telegramId || '-'}\n${accountLine}\nMessage: ${supportRequest.message}`;
  if (assignment.admin) {
    const chatId = assignment.admin.telegramChatId || assignment.admin.telegramId;
    if (chatId) notifyAdminChatId(chatId, text, wallets);
    else notifyMasterAdmins(wallets, `${text}\n\nWarning: assigned admin has no Telegram alert chat linked.`);
  } else {
    notifyMasterAdmins(wallets, text);
  }
  recordAuditEvent(wallets, {
    time: now,
    category: 'support',
    event: 'support_request_created',
    actorType: 'player',
    actorId: supportRequest.playerId || telegramId || '',
    actorName: supportRequest.playerName || name || '',
    playerId: supportRequest.playerId || '',
    playerName: supportRequest.playerName || name || '',
    status: supportRequest.assignmentStatus || supportRequest.status,
    details: {
      requestId: supportRequest.id,
      assignedAdminId: supportRequest.assignedAdminId || '',
      assignedAdminName: supportRequest.assignedAdminName || '',
      telegramUsername: username || '',
    },
  });
  saveWallets(wallets);
  res.json({ ok: true, requestId: supportRequest.id, assignedAdminName: supportRequest.assignedAdminName || '' });
});

app.get('/api/bot/config', (req, res) => {
  if (!requireBotApi(req, res)) return;
  const { botToken, botUsername } = getTelegramSettings();
  res.json({ ok: true, botToken, botUsername, hasBotToken: !!botToken });
});
app.get('/api/admin-bot/config', (req, res) => {
  if (!requireBotApi(req, res)) return;
  const wallets = loadWallets();
  const settings = wallets.telegramSettings || {};
  const adminBotToken = cleanTelegramToken(settings.adminBotToken || ADMIN_TELEGRAM_BOT_TOKEN);
  res.json({ ok: true, adminBotToken, hasAdminBotToken: !!adminBotToken, hasDedicatedAdminBot: !!adminBotToken });
});

app.post('/api/admin-bot/link', (req, res) => {
  if (!requireBotApi(req, res)) return;
  const wallets = loadWallets();
  const body = req.body || {};
  const login = String(body.adminLogin || body.username || '').trim();
  const password = String(body.password || '').trim();
  const match = findAdminUser(wallets, login);
  if (!match) { res.status(404).json({ ok: false, error: 'Admin account not found or disabled.' }); return; }
  const [adminId, admin] = match;
  if (!verifySecret(admin.passwordHash, password)) { res.status(401).json({ ok: false, error: 'Wrong admin password.' }); return; }
  admin.telegramChatId = String(body.chatId || body.telegramChatId || '').trim().replace(/[^\d-]/g, '').slice(0, 80);
  admin.telegramId = String(body.telegramId || '').trim().slice(0, 80);
  admin.telegramUsername = String(body.telegramUsername || '').trim().replace(/^@/, '').slice(0, 80) || admin.telegramUsername || '';
  admin.telegramFirstName = normalizeName(body.firstName || '');
  admin.telegramLastName = normalizeName(body.lastName || '');
  admin.mustConnectTelegram = false;
  admin.telegramLinkedAt = new Date().toISOString();
  admin.updatedAt = new Date().toISOString();
  if (!wallets.adminAudit) wallets.adminAudit = [];
  wallets.adminAudit.unshift({
    time: new Date().toISOString(),
    admin: admin.name || admin.username || adminId,
    role: admin.role,
    action: 'connect_admin_alert_bot',
    details: { adminId, telegramUsername: admin.telegramUsername || '', source: 'admin_alert_bot' },
  });
  if (wallets.adminAudit.length > 1000) wallets.adminAudit.length = 1000;
  saveWallets(wallets);
  emitAdminDataToAll();
  res.json({ ok: true, admin: publicAdminUser(admin, wallets) });
});


// ──────────────────────────────────────
// WALLET PERSISTENCE
// ──────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const WALLET_FILE = path.join(DATA_DIR, 'wallets.json');
const WALLET_BACKUP_DIR = path.join(DATA_DIR, 'backups');
const WALLET_BACKUP_INTERVAL_MS = Number(process.env.WALLET_BACKUP_INTERVAL_MS || 5 * 60 * 1000);
const DB_BACKUP_INTERVAL_MS = Number(process.env.DB_BACKUP_INTERVAL_MS || 30 * 60 * 1000);
const WALLET_BACKUP_KEEP = Number(process.env.WALLET_BACKUP_KEEP || 48);
const DB_BACKUP_KEEP = Number(process.env.DB_BACKUP_KEEP || 96);
const httpRateLimits = new Map();
let lastWalletBackupAt = 0;
let lastDatabaseBackupAt = 0;
const walletStore = createWalletStore({ dataDir: DATA_DIR, legacyWalletFile: WALLET_FILE });

function normalizeWalletDocument(data) {
  const wallets = data || { company: { balance: 0, totalCommission: 0, totalPaidOut: 0, accounts: {}, transactions: [], ledger: [] }, players: {}, requests: [], suspendedPlayers: {}, adminAudit: [], paymentSmsInbox: [], usedPaymentRefs: {}, telegramSettings: {}, gameHistory: [], auditLog: [], auditArchive: {} };
  if (!wallets.suspendedPlayers) wallets.suspendedPlayers = {};
  if (!wallets.players) wallets.players = {};
  if (!wallets.adminUsers) wallets.adminUsers = {};
  if (!wallets.requests) wallets.requests = [];
  if (!wallets.adminAudit) wallets.adminAudit = [];
  if (!wallets.paymentSmsInbox) wallets.paymentSmsInbox = [];
  if (!wallets.usedPaymentRefs) wallets.usedPaymentRefs = {};
  if (!wallets.telegramSettings) wallets.telegramSettings = {};
  if (!wallets.depositAccounts) wallets.depositAccounts = [];
  if (!wallets.gameHistory) wallets.gameHistory = [];
  if (!wallets.auditLog) wallets.auditLog = [];
  if (!wallets.auditArchive) wallets.auditArchive = {};
  if (!wallets.adminCashStatements) wallets.adminCashStatements = [];
  if (!wallets.auditState) wallets.auditState = {};
  if (!wallets.notificationState) wallets.notificationState = {};
  if (!wallets.activeGameStakes) wallets.activeGameStakes = {};
  if (!wallets.supportRequests) wallets.supportRequests = [];
  wallets.policySettings = normalizePolicySettings(wallets.policySettings);
  wallets.gameSettings = normalizeGameSettings(wallets.gameSettings);
  if (!wallets.appGate) wallets.appGate = { password: APP_GATE_PASSWORD, version: 1 };
  finance.ensureFinance(wallets);
  rotateAuditLog(wallets);
  return wallets;
}

// ── In-memory wallet cache ──
// loadWallets() is called 50+ times across the codebase.
// Without a cache every call hits synchronous SQLite + JSON.parse of the entire wallet.
// With the cache, first call loads from DB; subsequent calls return the live reference O(1).
// saveWallets() updates the cache immediately so the next loadWallets() sees the latest state.
let _walletCache = null;
let _saveWalletsLastLedgerId = '';

function latestFinanceLedgerId(wallets) {
  return String(wallets?.company?.ledger?.[0]?.id || '');
}

function loadWallets() {
  try {
    if (!_walletCache) {
      _walletCache = normalizeWalletDocument(walletStore.load());
      _saveWalletsLastLedgerId = latestFinanceLedgerId(_walletCache);
    }
    return _walletCache;
  } catch (e) {
    console.error('Wallet load error:', e.message);
    throw new Error(`Wallet database load failed: ${e.message}`);
  }
}

/** Force the next loadWallets() call to re-read from SQLite. Use after a crash or manual DB edit. */
function invalidateWalletCache() {
  _walletCache = null;
}

function safeWalletStoreInfo() {
  try {
    return walletStore.info();
  } catch (error) {
    return { dbPath: walletStore.dbPath, error: error.message };
  }
}

function maybeBackupWalletFile() {
  if (!fs.existsSync(WALLET_FILE)) return;
  const now = Date.now();
  if (WALLET_BACKUP_INTERVAL_MS > 0 && now - lastWalletBackupAt < WALLET_BACKUP_INTERVAL_MS) return;
  if (!fs.existsSync(WALLET_BACKUP_DIR)) fs.mkdirSync(WALLET_BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(WALLET_FILE, path.join(WALLET_BACKUP_DIR, `wallets-${stamp}.json`));
  lastWalletBackupAt = now;

  const backups = fs.readdirSync(WALLET_BACKUP_DIR)
    .filter(name => /^wallets-.*\.json$/.test(name))
    .map(name => ({ name, fullPath: path.join(WALLET_BACKUP_DIR, name), time: fs.statSync(path.join(WALLET_BACKUP_DIR, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  for (const oldBackup of backups.slice(Math.max(0, WALLET_BACKUP_KEEP))) {
    fs.unlinkSync(oldBackup.fullPath);
  }
}

function pruneBackups(pattern, keep) {
  if (!fs.existsSync(WALLET_BACKUP_DIR)) return;
  const backups = fs.readdirSync(WALLET_BACKUP_DIR)
    .filter(name => pattern.test(name))
    .map(name => ({ name, fullPath: path.join(WALLET_BACKUP_DIR, name), time: fs.statSync(path.join(WALLET_BACKUP_DIR, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  const backupRoot = path.resolve(WALLET_BACKUP_DIR);
  for (const oldBackup of backups.slice(Math.max(0, keep))) {
    const resolved = path.resolve(oldBackup.fullPath);
    if (resolved.startsWith(backupRoot + path.sep)) fs.unlinkSync(resolved);
  }
}

function maybeBackupDatabase() {
  const now = Date.now();
  if (DB_BACKUP_INTERVAL_MS > 0 && now - lastDatabaseBackupAt < DB_BACKUP_INTERVAL_MS) return;
  if (!fs.existsSync(WALLET_BACKUP_DIR)) fs.mkdirSync(WALLET_BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  walletStore.backupTo(path.join(WALLET_BACKUP_DIR, `game-${stamp}.sqlite`));
  lastDatabaseBackupAt = now;
  pruneBackups(/^game-.*\.sqlite$/, DB_BACKUP_KEEP);
}

let _saveWalletsPending=null,_saveWalletsTimer=null,_saveWalletsLastFlush=0;
const SAVE_WALLETS_DEBOUNCE_MS=250;
function saveWallets(wallets) {
  _walletCache = wallets;  // update in-memory cache immediately so loadWallets() returns latest state
  _saveWalletsPending=wallets;
  const latestLedgerId = latestFinanceLedgerId(wallets);
  const hasNewFinanceLedger = latestLedgerId && latestLedgerId !== _saveWalletsLastLedgerId;
  if (hasNewFinanceLedger) {
    if (_saveWalletsTimer) {
      clearTimeout(_saveWalletsTimer);
      _saveWalletsTimer = null;
    }
    flushSaveWallets();
    return;
  }
  if(_saveWalletsTimer)return;
  const elapsed=Date.now()-_saveWalletsLastFlush;
  if(elapsed>=SAVE_WALLETS_DEBOUNCE_MS){flushSaveWallets();return}
  _saveWalletsTimer=setTimeout(()=>{_saveWalletsTimer=null;flushSaveWallets()},SAVE_WALLETS_DEBOUNCE_MS-elapsed);
}
function flushSaveWallets(){
  if(!_saveWalletsPending)return;
  _saveWalletsLastFlush=Date.now();
  const wallets=_saveWalletsPending;
  _saveWalletsPending=null;
  const t0=Date.now();
  try {
    rotateAuditLog(wallets);
    wallets.auditState = { ...(wallets.auditState || {}), lastArchivedAt: new Date().toISOString(), liveRetentionDays: AUDIT_LIVE_DAYS };
    walletStore.save(wallets);
    _saveWalletsLastLedgerId = latestFinanceLedgerId(wallets);
    const t1=Date.now();
    try { maybeBackupDatabase(); } catch (backupError) { console.error('Database backup warning:', backupError.message); }
    updateCachedCompanyStats(wallets);
    const health = finance.financeHealth(wallets);
    if (!health.ok) console.error('Finance health warning:', JSON.stringify(health.issues));
    const total=Date.now()-t0;
    if(total>5)console.log(`⏱ flushSaveWallets: ${total}ms (sqlite:${t1-t0}ms)`);
  } catch (e) {
    console.error('Wallet save error:', e.message);
    throw e;
  }
}

function normalizeName(name) {
  return String(name || '').trim().substring(0, 20) || 'Anonymous';
}

function normalizePhone(phone) {
  return canonicalEthiopianPhone(phone);
}

function normalizePin(pin) {
  return String(pin || '').replace(/\D/g, '').substring(0, 4);
}

function hashPin(pin) {
  const cleanPin = normalizePin(pin);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(cleanPin, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function hashSecret(secret) {
  const value = String(secret || '');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(value, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifySecret(stored, secret) {
  if (!stored || !String(stored).startsWith('scrypt:')) return false;
  const [, salt, storedHash] = String(stored).split(':');
  const hash = crypto.scryptSync(String(secret || ''), salt, 32).toString('hex');
  return safeEqual(hash, storedHash);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function rateLimitRequest(req, res, bucket, maxRequests, windowMs) {
  const key = `${bucket}:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
  const now = Date.now();
  const record = httpRateLimits.get(key) || { count: 0, first: now };
  if (now - record.first > windowMs) {
    httpRateLimits.set(key, { count: 1, first: now });
    return true;
  }
  record.count += 1;
  httpRateLimits.set(key, record);
  if (record.count > maxRequests) {
    res.status(429).json({ ok: false, error: 'Too many requests. Try again shortly.' });
    return false;
  }
  return true;
}

function systemWarnings(wallets = null) {
  const warnings = [];
  if (ADMIN_PASSWORD === 'change-me-before-production') warnings.push('ADMIN_PASSWORD is still the development default.');
  if (PAYMENT_SMS_API_KEY === 'change-me-payment-sms-key') warnings.push('PAYMENT_SMS_API_KEY is still the development default.');
  if (BOT_SERVER_API_KEY === 'change-me-payment-sms-key') warnings.push('BOT_SERVER_API_KEY is still the development default.');
  if (PAYMENT_SMS_ALLOW_ANY_SENDER) warnings.push('PAYMENT_SMS_ALLOWED_SENDERS is set to *; any authenticated SMS sender can be submitted.');
  else if (!PAYMENT_SMS_ALLOWED_SENDERS.length) warnings.push('PAYMENT_SMS_ALLOWED_SENDERS is not configured; any authenticated SMS sender can be submitted.');
  if (!PAYMENT_SMS_ALLOWED_DEVICES.length) warnings.push('PAYMENT_SMS_ALLOWED_DEVICES is not configured; any authenticated forwarding device can submit SMS.');
  const settingsWallets = wallets || loadWallets();
  if (!TELEGRAM_BOT_TOKEN && !settingsWallets.telegramSettings?.botToken) warnings.push('Telegram bot token is not configured.');
  if (!process.env.SESSION_SECRET) warnings.push('SESSION_SECRET is derived from other settings; set a dedicated secret for production.');
  return warnings;
}

function cleanTelegramToken(token) {
  return String(token || '').trim().slice(0, 120);
}

function cleanTelegramBotUsername(username) {
  const clean = String(username || '').trim().replace(/^@/, '').slice(0, 32);
  return /^[a-zA-Z0-9_]{5,32}$/.test(clean) ? clean : '';
}

function cleanAdminChatIds(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,\n\s]+/);
  return [...new Set(raw.map(id => String(id || '').trim()).filter(id => /^-?\d{4,30}$/.test(id)))].slice(0, 5);
}

function getTelegramSettings(wallets = null) {
  const data = wallets || loadWallets();
  const settings = data.telegramSettings || {};
  const botToken = cleanTelegramToken(settings.botToken || TELEGRAM_BOT_TOKEN);
  const adminBotToken = cleanTelegramToken(settings.adminBotToken || ADMIN_TELEGRAM_BOT_TOKEN || botToken);
  const botUsername = cleanTelegramBotUsername(settings.botUsername) || TELEGRAM_BOT_USERNAME;
  const envChatIds = cleanAdminChatIds(ADMIN_TELEGRAM_CHAT_ID);
  const storedChatIds = cleanAdminChatIds(settings.adminChatIds || []);
  return { botToken, adminBotToken, botUsername, hasDedicatedAdminBot: !!cleanTelegramToken(settings.adminBotToken || ADMIN_TELEGRAM_BOT_TOKEN), adminChatIds: storedChatIds.length ? storedChatIds : envChatIds };
}

function publicTelegramSettings(wallets) {
  const settings = wallets.telegramSettings || {};
  const current = getTelegramSettings(wallets);
  const token = cleanTelegramToken(settings.botToken || TELEGRAM_BOT_TOKEN);
  const adminToken = cleanTelegramToken(settings.adminBotToken || ADMIN_TELEGRAM_BOT_TOKEN);
  return {
    hasBotToken: !!token,
    botTokenPreview: token ? `${token.slice(0, 8)}...${token.slice(-6)}` : '',
    hasAdminBotToken: !!adminToken,
    adminBotTokenPreview: adminToken ? `${adminToken.slice(0, 8)}...${adminToken.slice(-6)}` : '',
    hasDedicatedAdminBot: current.hasDedicatedAdminBot,
    adminChatIds: current.adminChatIds,
    botUsername: current.botUsername,
    maxAdminChatIds: 5,
  };
}

function requireBotApi(req, res) {
  if (!rateLimitRequest(req, res, 'bot-api', 180, 60 * 1000)) return false;
  const expected = `Bearer ${BOT_SERVER_API_KEY}`;
  if (!safeEqual(req.get('authorization') || '', expected)) {
    res.status(401).json({ ok: false, error: 'Unauthorized bot API request.' });
    return false;
  }
  return true;
}

async function telegramSend(chatId, text, tokenOverride = '') {
  const { botToken } = getTelegramSettings();
  const token = cleanTelegramToken(tokenOverride || botToken);
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (error) {
    console.error('Telegram notification error:', error.message);
  }
}

function formatEtb(amount) {
  return `${finance.money(amount).toLocaleString('en-US')} ETB`;
}

function playerSummaryLine(playerId, wallet) {
  return `${wallet?.name || playerId || '-'} | ${playerPublicCode(playerId)} | ${wallet?.phone || '-'} | ${formatEtb(wallet?.balance || 0)}`;
}

function notifyPlayerTelegram(wallet, text) {
  const { botToken } = getTelegramSettings();
  telegramSend(wallet?.telegramChatId || wallet?.telegramId, text, botToken);
}

function emitPlayerNotification(playerId, type, message) {
  if (!playerId || !message) return;
  io.sockets.sockets.forEach(sock => {
    if (sock.data?.playerId === playerId) sock.emit('notification', { type, message });
  });
}

function notifyAdminTelegram(text) {
  const { adminChatIds, adminBotToken } = getTelegramSettings();
  for (const chatId of adminChatIds) telegramSend(chatId, text, adminBotToken);
}

function notifyAdminChatId(chatId, text, wallets = null) {
  const { adminBotToken } = getTelegramSettings(wallets);
  telegramSend(chatId, text, adminBotToken);
}

function adminTelegramChatIds(wallets, roles = [], { fallbackToConfigured = true } = {}) {
  const roleSet = new Set((Array.isArray(roles) ? roles : [roles]).filter(Boolean));
  const ids = new Set();
  const admins = Object.values(wallets?.adminUsers || {});
  const players = Object.values(wallets?.players || {});
  for (const admin of admins) {
    if (admin.active === false) continue;
    if (roleSet.size && !roleSet.has(admin.role)) continue;
    const directId = admin.telegramChatId || admin.telegramId;
    if (directId) ids.add(String(directId));
    const linkedWallet = admin.phone
      ? players.find(wallet => wallet.phone === admin.phone && (wallet.telegramChatId || wallet.telegramId))
      : null;
    if (linkedWallet) ids.add(String(linkedWallet.telegramChatId || linkedWallet.telegramId));
  }
  if (fallbackToConfigured && ids.size === 0) {
    for (const chatId of getTelegramSettings(wallets).adminChatIds) ids.add(String(chatId));
  }
  return Array.from(ids);
}

function notifyAdminRoles(wallets, roles, text, options = {}) {
  const ids = adminTelegramChatIds(wallets, roles, options);
  const { adminBotToken } = getTelegramSettings(wallets);
  for (const chatId of ids) telegramSend(chatId, text, adminBotToken);
}

function notifySeniorAdmins(wallets, text, options = {}) {
  notifyAdminRoles(wallets, ['senior'], text, options);
}

function notifyMasterAdmins(wallets, text, options = {}) {
  notifyAdminRoles(wallets, ['master'], text, options);
}

function notifySeniorAndMasterAdmins(wallets, text, options = {}) {
  notifyAdminRoles(wallets, ['senior', 'master'], text, options);
}

function notifyPlayerRegistered(wallets, playerId, wallet, { existing = false, source = 'mini_app' } = {}) {
  if (!existing) {
    const promoAmount = finance.money(wallet.signupPromoAmount || wallet.signupPromoLockedBalance || 0);
    const promoLine = promoAmount > 0
      ? `\n\nYou received ${formatEtb(promoAmount)} starter credit to test the games. This credit is playable, but not withdrawable. When you win or make a deposit, the starter credit is returned first while your wallet keeps at least ${formatEtb(50)}.`
      : '';
    notifyPlayerTelegram(wallet, `Welcome to HabeshaBingo, ${wallet.name}!\n\nYour game wallet is ready.${promoLine}\n\nDeposit money when you are ready, then open the games and play.`);
    if (promoAmount > 0) {
      notifyPlayerTelegram(wallet, `እንኳን ደስ አለዎት!\n\n${formatEtb(promoAmount)} የመጀመሪያ መሞከሪያ ክሬዲት ተቀብለዋል። ይህ ክሬዲት ለጨዋታ ብቻ ነው፣ ለማውጣት አይቻልም። ሲያሸንፉ ወይም ገንዘብ ሲያስገቡ፣ ቀሪ ሂሳብዎ ከ${formatEtb(50)} በታች እንዳይወርድ ተጠብቆ ይህ መሞከሪያ ክሬዲት በመጀመሪያ ይመለሳል።`);
    }
  }
  if (!existing) {
    notifySeniorAndMasterAdmins(
      wallets,
      `New player registered\nPlayer: ${playerSummaryLine(playerId, wallet)}\nSource: ${source}\nTelegram: ${wallet.telegramUsername ? '@' + wallet.telegramUsername : wallet.telegramId || '-'}`
    );
  }
}

function notifyPlayerWin(wallets, playerId, wallet, game, payout, details = {}) {
  const cleanPayout = finance.money(payout);
  if (cleanPayout <= 0) return;
  const gameName = String(game || 'game').toUpperCase();
  const returnedLine = details.returnedAmount && details.returnedAmount !== cleanPayout
    ? `\nReturned to wallet: ${formatEtb(details.returnedAmount)}`
    : '';
  notifyPlayerTelegram(wallet, `Congratulations ${wallet.name}, you won!\n\nGame: ${gameName}\nPrize: ${formatEtb(cleanPayout)}${returnedLine}\nBalance: ${formatEtb(wallet.balance || 0)}`);
  const adminText = `Player win alert\nPlayer: ${playerSummaryLine(playerId, wallet)}\nGame: ${gameName}\nPrize: ${formatEtb(cleanPayout)}${details.returnedAmount ? `\nReturned: ${formatEtb(details.returnedAmount)}` : ''}${details.round ? `\nRound: ${details.round}` : ''}`;
  if (cleanPayout > WIN_NOTIFY_MASTER_ETB) {
    notifySeniorAndMasterAdmins(wallets, adminText);
  } else if (cleanPayout > WIN_NOTIFY_SENIOR_ETB) {
    notifySeniorAdmins(wallets, adminText);
  }
}

function notifyDepositRequest(wallets, wallet, request) {
  if (!request) return;
  const text = `New deposit request\nPlayer: ${playerSummaryLine(request.playerId, wallet)}\nAmount: ${formatEtb(request.amount)}\nAssigned account: ${request.depositAccountLabel || '-'} ${request.depositAccountNumber || ''}\nAccount owner: ${request.depositAccountOwnerAdminName || '-'}`;
  // Notify only the admin who owns this deposit account
  if (request.depositAccountOwnerAdminId) {
    const admin = wallets.adminUsers?.[request.depositAccountOwnerAdminId];
    if (admin?.telegramChatId || admin?.telegramId) {
      notifyAdminChatId(admin.telegramChatId || admin.telegramId, text, wallets);
    } else {
      notifyMasterAdmins(wallets, `${text}\n\nWarning: account owner admin has no Telegram alert chat linked.`);
    }
  } else {
    // Legacy deposit accounts without owner — fall back to all senior admins
    notifySeniorAdmins(wallets, text);
  }
}

function notifyWithdrawalRequest(wallets, wallet, request) {
  if (!request) return;
  const text = `New withdrawal request\nPlayer: ${playerSummaryLine(request.playerId, wallet)}\nAmount: ${formatEtb(request.amount)}\nPayout phone: ${request.payoutPhone || wallet.phone || '-'}\nAssigned to: ${request.assignedWithdrawAdminName || 'Master review'}\nBalance before reserve: ${formatEtb(request.balanceBeforeReserve ?? 0)}\nAvailable after reserve: ${formatEtb(wallet.balance || 0)}\nReserved pending approval: ${formatEtb(request.amount)}`;
  if (request.assignedWithdrawAdminId) {
    const admin = wallets.adminUsers?.[request.assignedWithdrawAdminId];
    if (admin?.telegramChatId || admin?.telegramId) notifyAdminChatId(admin.telegramChatId || admin.telegramId, text, wallets);
    else notifyMasterAdmins(wallets, `${text}\n\nWarning: assigned admin has no Telegram alert chat linked.`);
  } else {
    notifyMasterAdmins(wallets, text);
  }
}

function notifySystemInterruption(text) {
  try {
    const wallets = loadWallets();
    const voided = voidActiveGameStakes(wallets, 'system_interruption');
    if (voided.count > 0) saveWallets(wallets);
    notifySeniorAndMasterAdmins(wallets, `System interruption alert\n${text}${voided.count ? `\n\nActive games voided: ${voided.count}\nRefunded: ${formatEtb(voided.refunded)}` : ''}`);
  } catch (error) {
    console.error('System interruption notification failed:', error.message);
  }
}

function verifyPin(wallet, pin) {
  const cleanPin = normalizePin(pin);
  if (!/^\d{4}$/.test(cleanPin)) return false;
  if (wallet.pinHash && String(wallet.pinHash).startsWith('scrypt:')) {
    const [, salt, storedHash] = String(wallet.pinHash).split(':');
    const hash = crypto.scryptSync(cleanPin, salt, 32).toString('hex');
    return safeEqual(hash, storedHash);
  }
  return wallet.pin === cleanPin;
}

function migratePinHash(wallet, pin) {
  if (wallet && !wallet.pinHash && wallet.pin && verifyPin(wallet, pin)) {
    wallet.pinHash = hashPin(pin);
    delete wallet.pin;
    return true;
  }
  return false;
}

function issuePlayerSession(playerId) {
  const exp = Date.now() + PLAYER_SESSION_MS;
  const nonce = crypto.randomBytes(10).toString('hex');
  const body = `${playerId}.${exp}.${nonce}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('hex');
  return `${body}.${sig}`;
}

function verifyPlayerSession(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) return { error: 'Please log in again.' };
  const [playerId, expRaw, nonce, sig] = parts;
  const exp = Number(expRaw);
  if (!playerId || !Number.isFinite(exp) || exp < Date.now() || !nonce) return { error: 'Please log in again.' };
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${playerId}.${expRaw}.${nonce}`).digest('hex');
  if (!safeEqual(sig, expected)) return { error: 'Please log in again.' };
  return { playerId };
}

function authenticatePlayer(wallets, payload = {}, socket = null) {
  const verified = verifyPlayerSession(payload.sessionToken);
  let playerId = verified.playerId;
  if (verified.error) {
    const socketPlayerId = socket?.data?.playerId;
    const requestedPlayerId = normalizePlayerId(payload.playerId, '');
    if (socketPlayerId && socketPlayerId === requestedPlayerId) playerId = socketPlayerId;
    else return verified;
  }
  const id = normalizePlayerId(playerId, '');
  const wallet = wallets.players[id];
  if (!wallet) return { error: 'Please log in again.' };
  return { id, wallet };
}

function normalizePlayerId(playerId, fallbackName) {
  const raw = String(playerId || '').trim();
  if (/^[a-zA-Z0-9_:+-]{3,80}$/.test(raw)) return raw;
  const fallback = normalizeName(String(fallbackName || raw)).toLowerCase();
  return fallback ? `legacy:${fallback}` : raw || 'unknown';
}

function getPlayerWallet(wallets, playerId, name) {
  const id = normalizePlayerId(playerId, name);
  if (!wallets.players[id]) {
    wallets.players[id] = { id, name: normalizeName(name), balance: 0, totalWon: 0, totalLost: 0, gamesPlayed: 0, wins: 0, createdAt: new Date().toISOString() };
    applySignupPromo(wallets, id, wallets.players[id], 'legacy_wallet_create');
  } else {
    wallets.players[id].id = id;
    wallets.players[id].name = normalizeName(name || wallets.players[id].name);
  }
  return wallets.players[id];
}

function publicWallet(id, wallet) {
  const promoLocked = finance.money(wallet.signupPromoLockedBalance || 0);
  const balance = finance.money(wallet.balance || 0);
  return {
    playerId: id,
    playerCode: playerPublicCode(id),
    name: wallet.name,
    phone: wallet.phone || '',
    balance,
    withdrawableBalance: Math.max(0, balance - promoLocked),
    signupPromoLockedBalance: promoLocked,
    hasRealDeposit: !!wallet.hasRealDeposit,
    totalWon: wallet.totalWon || 0,
    totalLost: wallet.totalLost || 0,
    gamesPlayed: wallet.gamesPlayed || 0,
    wins: wallet.wins || 0,
    telegramId: wallet.telegramId || null,
    telegramUsername: wallet.telegramUsername || null,
    telegramChatId: wallet.telegramChatId || null,
    referredByAdminId: wallet.referredByAdminId || '',
    referralCode: wallet.referralCode || '',
    defaultDepositPhone: wallet.defaultDepositPhone || wallet.phone || '',
    mustChangePin: !!wallet.mustChangePin,
  };
}

function playerPublicCode(playerId) {
  const hash = crypto.createHash('sha256').update(String(playerId || '')).digest('hex').slice(0, 8).toUpperCase();
  return `HB-${hash}`;
}

function findWalletByLogin(wallets, login, options = {}) {
  const cleanLogin = String(login || '').trim().toLowerCase();
  const phoneLogin = normalizePhone(login);
  if (!cleanLogin && !phoneLogin) return null;
  const entries = Object.entries(wallets.players || {});
  const exact = entries.find(([id, wallet]) => {
    const name = String(wallet.name || '').trim().toLowerCase();
    return id.toLowerCase() === cleanLogin ||
      playerPublicCode(id).toLowerCase() === cleanLogin ||
      (phoneLogin && wallet.phone === phoneLogin) ||
      name === cleanLogin ||
      String(wallet.telegramUsername || '').toLowerCase() === cleanLogin.replace(/^@/, '');
  });
  if (exact) return exact;
  const firstNameMatches = entries.filter(([, wallet]) => {
    const first = String(wallet.name || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
    return cleanLogin.length >= 2 && first === cleanLogin;
  });
  if (firstNameMatches.length === 1) return firstNameMatches[0];
  if (firstNameMatches.length > 1) return options.allowAmbiguous ? { ambiguous: true } : null;
  const compact = cleanLogin.replace(/\s+/g, '');
  const firstPlusLast4 = entries.filter(([, wallet]) => {
    const first = String(wallet.name || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
    const last4 = String(wallet.phone || '').replace(/\D/g, '').slice(-4);
    return compact && `${first}${last4}` === compact;
  });
  if (firstPlusLast4.length === 1) return firstPlusLast4[0];
  if (firstPlusLast4.length > 1) return options.allowAmbiguous ? { ambiguous: true } : null;
  return null;
}

function findWalletForAdmin(wallets, query) {
  const clean = String(query || '').trim().toLowerCase();
  const phone = normalizePhone(query);
  if (!clean && !phone) return null;
  return Object.entries(wallets.players || {}).find(([id, wallet]) => {
    const code = playerPublicCode(id).toLowerCase();
    return id.toLowerCase() === clean ||
      code === clean ||
      (phone && wallet.phone === phone) ||
      String(wallet.name || '').toLowerCase() === clean ||
      String(wallet.telegramUsername || '').toLowerCase() === clean.replace(/^@/, '');
  }) || Object.entries(wallets.players || {}).find(([id, wallet]) => {
    const haystack = [
      id,
      playerPublicCode(id),
      wallet.name,
      wallet.phone,
      wallet.telegramUsername ? `@${wallet.telegramUsername}` : '',
    ].join(' ').toLowerCase();
    return clean.length >= 3 && haystack.includes(clean);
  }) || null;
}

function applySignupPromo(wallets, playerId, wallet, source = 'account_create') {
  const walletSettings = activeGameSettings(wallets, 'wallet');
  const amount = finance.money(walletSettings.signupPromoAmount);
  if (walletSettings.signupPromoEnabled === false || amount <= 0) return { skipped: true };
  const name = wallet.name || playerId;
  const accounts = finance.ensureFinance(wallets);
  if (finance.money(accounts.promotion || 0) < amount) {
    const available = finance.money(accounts.promotion || 0);
    const funded = finance.externalCredit(wallets, 'promotion', amount - available, `Auto fund signup promo for ${name}`, 'signup_promo_budget_autofill', { source, playerId });
    if (funded.error) return funded;
  }
  const paid = finance.accountToPlayer(wallets, 'promotion', playerId, wallet, amount, `Signup gift for ${name}`, 'starter_bonus', { source });
  if (!paid.error) {
    wallet.signupPromoPaidAt = new Date().toISOString();
    wallet.signupPromoAmount = amount;
    wallet.signupPromoLockedBalance = finance.money(wallet.signupPromoLockedBalance || 0) + amount;
    wallet.signupPromoReclaimed = finance.money(wallet.signupPromoReclaimed || 0);
    wallet.hasRealDeposit = !!wallet.hasRealDeposit;
  }
  return paid;
}

function markRealDeposit(wallet, amount = 0, source = 'deposit') {
  if (!wallet) return;
  wallet.hasRealDeposit = true;
  wallet.firstDepositAt = wallet.firstDepositAt || new Date().toISOString();
  wallet.lastDepositAt = new Date().toISOString();
  wallet.totalDeposited = finance.money(wallet.totalDeposited || 0) + finance.money(amount || 0);
  wallet.lastDepositSource = source;
}

function notifySignupPromoReturned(wallet, amount, reason = '') {
  const returned = finance.money(amount);
  if (!wallet || returned <= 0) return;
  const reasonLine = reason ? `\nReason: ${reason}` : '';
  notifyPlayerTelegram(wallet, `Starter credit returned\n\n${formatEtb(returned)} starter credit has been returned.${reasonLine}\nBalance: ${formatEtb(wallet.balance || 0)}`);
  notifyPlayerTelegram(wallet, `የመሞከሪያ ክሬዲት ተመልሷል\n\n${formatEtb(returned)} የመጀመሪያ መሞከሪያ ክሬዲት ተመልሷል።\nቀሪ ሂሳብዎ: ${formatEtb(wallet.balance || 0)}`);
}

function reclaimSignupPromoCredit(wallets, playerId, wallet, reason = 'wallet activity', details = {}) {
  if (!wallet) return { reclaimed: 0 };
  const locked = finance.money(wallet.signupPromoLockedBalance || 0);
  if (locked <= 0) return { reclaimed: 0 };
  const balance = finance.money(wallet.balance || 0);
  const reclaim = Math.min(locked, Math.max(0, balance - 50));
  if (reclaim <= 0) return { reclaimed: 0 };
  const moved = finance.debitPlayerToAccount(
    wallets,
    playerId,
    wallet,
    'promotion',
    reclaim,
    `Return signup promo credit after ${reason} for ${wallet.name || playerId}`,
    'signup_promo_reclaim',
    { reason, ...details }
  );
  if (moved.error) return moved;
  wallet.signupPromoLockedBalance = Math.max(0, locked - reclaim);
  wallet.signupPromoReclaimed = finance.money(wallet.signupPromoReclaimed || 0) + reclaim;
  wallet.signupPromoLastReclaimedAt = new Date().toISOString();
  if (wallet.signupPromoLockedBalance <= 0) wallet.signupPromoFullyReclaimedAt = wallet.signupPromoFullyReclaimedAt || new Date().toISOString();
  notifySignupPromoReturned(wallet, reclaim, reason);
  emitPlayerNotification(playerId, 'success', `${formatEtb(reclaim)} starter credit returned. Balance: ${formatEtb(wallet.balance || 0)}`);
  return { reclaimed: reclaim };
}

function reclaimSignupPromoAfterWin(wallets, playerId, wallet, payout, game, details = {}) {
  const cleanPayout = finance.money(payout || 0);
  if (cleanPayout <= 0) return { reclaimed: 0 };
  return reclaimSignupPromoCredit(wallets, playerId, wallet, `${game} win`, { game, payout: cleanPayout, ...details });
}


function createAccount(wallets, { name, phone, pin, telegram, ageConfirmed, policyAccepted, referralCode }) {
  const cleanName = normalizeName(name);
  const cleanPhone = normalizePhone(phone);
  const cleanPin = normalizePin(pin);
  if (!cleanName || cleanName === 'Anonymous') return { error: 'Enter your first name.' };
  if (!cleanPhone) return { error: 'Enter a valid Ethiopian phone number: 09xxxxxxxx, 07xxxxxxxx, +2519xxxxxxxx, or +2517xxxxxxxx.' };
  if (!/^\d{4}$/.test(cleanPin)) return { error: 'PIN must be exactly 4 digits.' };
  if (!ageConfirmed) return { error: 'You must confirm that you are 18 or older.' };
  if (policyAccepted !== true) return { error: 'You must accept the policies before creating an account.' };
  if (Object.values(wallets.players).some(wallet => wallet.phone === cleanPhone)) return { error: 'Phone number is already registered.' };

  const id = `acct:${cleanPhone}`;
  wallets.players[id] = {
    id,
    name: cleanName,
    phone: cleanPhone,
    pinHash: hashPin(cleanPin),
    balance: 0,
    totalWon: 0,
    totalLost: 0,
    gamesPlayed: 0,
    wins: 0,
    createdAt: new Date().toISOString(),
    telegramId: telegram?.id || null,
    telegramUsername: telegram?.username || null,
    telegramChatId: telegram?.chatId || null,
    telegramFirstName: telegram?.firstName || null,
    telegramLastName: telegram?.lastName || null,
    ageConfirmedAt: new Date().toISOString(),
    policyAcceptedAt: new Date().toISOString(),
    policyVersion: wallets.policySettings?.updatedAt || 'default',
  };
  assignPlayerReferral(wallets, id, wallets.players[id], referralCode, telegram?.id ? 'telegram_mini_app_register' : 'mini_app_register');
  applySignupPromo(wallets, id, wallets.players[id], 'account_create');
  recordAuditEvent(wallets, {
    category: 'account',
    event: 'account_opened',
    actorType: 'player',
    actorId: id,
    actorName: cleanName,
    playerId: id,
    playerName: cleanName,
    status: 'created',
    details: {
      phone: cleanPhone,
      telegramId: telegram?.id || '',
      telegramUsername: telegram?.username || '',
      ageConfirmed: true,
    },
  });
  return { id, wallet: wallets.players[id] };
}

function loginAccount(wallets, { login, pin }) {
  const cleanPin = normalizePin(pin);
  const match = findWalletByLogin(wallets, login, { allowAmbiguous: true });
  if (match?.ambiguous) return { error: 'More than one account matches that name. Please login with your phone number.' };
  if (!match) return { error: 'No account found for that phone/name. Please register or check the login.' };
  if (!verifyPin(match[1], cleanPin)) return { error: 'Wrong 4 digit PIN.' };
  migratePinHash(match[1], cleanPin);
  if (match[1].telegramAutoLoginDisabled) {
    match[1].telegramAutoLoginDisabled = false;
    match[1].telegramLogoutSource = '';
    match[1].telegramLoggedOutAt = '';
  }
  recordAuditEvent(wallets, {
    category: 'account',
    event: 'account_login',
    actorType: 'player',
    actorId: match[0],
    actorName: match[1].name || '',
    playerId: match[0],
    playerName: match[1].name || '',
    status: 'success',
    details: { login: String(login || '').slice(0, 80) },
  });
  return { id: match[0], wallet: match[1] };
}

function findWalletByTelegram(wallets, telegramId) {
  const id = String(telegramId || '');
  return Object.entries(wallets.players).find(([, wallet]) => String(wallet.telegramId || '') === id);
}

function linkTelegramAccount(wallets, payload = {}) {
  const telegramId = String(payload.telegramId || '').trim();
  if (!telegramId) return { error: 'Telegram user ID is required.' };
  const existingTelegram = findWalletByTelegram(wallets, telegramId);
  if (existingTelegram) {
    existingTelegram[1].telegramAutoLoginDisabled = false;
    existingTelegram[1].telegramLogoutSource = '';
    existingTelegram[1].telegramLoggedOutAt = '';
    assignPlayerReferral(wallets, existingTelegram[0], existingTelegram[1], payload.referralCode, 'telegram_existing');
    return { id: existingTelegram[0], wallet: existingTelegram[1], linked: false, existing: true };
  }

  const phone = normalizePhone(payload.phone);
  const pin = normalizePin(payload.pin);
  const telegram = {
    id: telegramId,
    username: String(payload.username || '').trim().slice(0, 80),
    chatId: String(payload.chatId || payload.telegramChatId || telegramId).trim().slice(0, 80),
    firstName: normalizeName(payload.firstName || payload.name || 'Telegram Player'),
    lastName: normalizeName(payload.lastName || ''),
  };
  const fullName = normalizeName(payload.fullName || payload.name || telegram.firstName);
  if (!phone) return { error: 'Use: /register 0912345678 1234. Accepted formats: 09xxxxxxxx, 07xxxxxxxx, +2519xxxxxxxx, +2517xxxxxxxx.' };
  if (!/^\d{4}$/.test(pin)) return { error: 'PIN must be exactly 4 digits.' };

  const existingPhone = Object.entries(wallets.players).find(([, wallet]) => wallet.phone === phone);
  if (existingPhone) {
    const [id, wallet] = existingPhone;
    if (wallet.telegramId && String(wallet.telegramId) !== telegramId) return { error: 'This phone is already linked to another Telegram account.' };
    if (!verifyPin(wallet, pin)) return { error: 'Wrong PIN for this phone number.' };
    migratePinHash(wallet, pin);
    wallet.telegramId = telegram.id;
    wallet.telegramUsername = telegram.username || wallet.telegramUsername || null;
    wallet.telegramChatId = telegram.chatId || wallet.telegramChatId || telegram.id;
    wallet.telegramFirstName = telegram.firstName || wallet.telegramFirstName || null;
    wallet.telegramLastName = telegram.lastName || wallet.telegramLastName || null;
    wallet.telegramAutoLoginDisabled = false;
    wallet.telegramLogoutSource = '';
    wallet.telegramLoggedOutAt = '';
    if (fullName && fullName !== 'Anonymous') wallet.name = fullName;
    if (payload.ageConfirmed && !wallet.ageConfirmedAt) wallet.ageConfirmedAt = new Date().toISOString();
    assignPlayerReferral(wallets, id, wallet, payload.referralCode, 'telegram_link');
    recordAuditEvent(wallets, {
      category: 'account',
      event: 'account_linked_telegram',
      actorType: 'player',
      actorId: id,
      actorName: wallet.name || '',
      playerId: id,
      playerName: wallet.name || '',
      status: 'linked',
      details: {
        telegramId: telegram.id,
        telegramUsername: telegram.username || '',
        phone,
      },
    });
    return { id, wallet, linked: true, existing: true };
  }

  if (!payload.ageConfirmed) return { error: 'You must confirm that you are 18 or older.' };
  if (payload.policyAccepted !== true) return { error: 'You must accept the policies before creating an account.' };
  const created = createAccount(wallets, { name: fullName || telegram.firstName, phone, pin, telegram, ageConfirmed: true, policyAccepted: true, referralCode: payload.referralCode });
  if (created.error) return created;
  return { ...created, linked: true, existing: false };
}

function makeRequestId() {
  return fairRng.randomId('req');
}

function makeReceiptId(game) {
  return fairRng.randomId(`rcp_${game}`);
}

function recordGameHistory(wallets, entry) {
  if (!wallets.gameHistory) wallets.gameHistory = [];
  const receipt = {
    id: entry.id || makeReceiptId(entry.game || 'game'),
    game: entry.game,
    playerId: entry.playerId,
    playerName: entry.playerName,
    bet: finance.money(entry.bet),
    payout: finance.money(entry.payout),
    profit: finance.money(entry.payout) - finance.money(entry.bet),
    status: entry.status || (finance.money(entry.payout) > 0 ? 'won' : 'lost'),
    createdAt: entry.createdAt || new Date().toISOString(),
    details: entry.details || {},
  };
  wallets.gameHistory.unshift(receipt);
  if (wallets.gameHistory.length > 50000) wallets.gameHistory.length = 50000;
  recordAuditEvent(wallets, {
    time: receipt.createdAt,
    category: 'game',
    event: `game_${receipt.status}`,
    actorType: 'player',
    actorId: receipt.playerId || '',
    actorName: receipt.playerName || '',
    playerId: receipt.playerId || '',
    playerName: receipt.playerName || '',
    game: receipt.game || '',
    amount: receipt.payout || receipt.bet || 0,
    status: receipt.status || '',
    details: {
      receiptId: receipt.id,
      bet: receipt.bet,
      payout: receipt.payout,
      profit: receipt.profit,
      ...receipt.details,
    },
  });
  maybeTriggerCoolDown(wallets, receipt);
  maybeTriggerHighWinnerAlert(wallets, receipt);
  return receipt;
}

function isLossReceipt(receipt) {
  if (!receipt) return false;
  if (receipt.status === 'won') return false;
  return receipt.status === 'lost' || finance.money(receipt.profit) < 0;
}

function maybeTriggerCoolDown(wallets, receipt) {
  if (!receipt || !receipt.playerId || !isLossReceipt(receipt)) return;
  const threshold = Math.max(20, Math.round(Number(runtimeConfig.COOL_DOWN_LOSS_THRESHOLD) || COOL_DOWN_LOSS_THRESHOLD));
  const hours = Math.max(1, Number(runtimeConfig.COOL_DOWN_HOURS) || COOL_DOWN_HOURS);
  if (threshold <= 0 || hours <= 0) return;
  const dayKey = localDateKey(new Date(receipt.createdAt || Date.now()));
  let streak = 0;
  const history = (wallets.gameHistory || []).filter(item => {
    if (item.playerId !== receipt.playerId) return false;
    return localDateKey(new Date(item.createdAt || Date.now())) === dayKey;
  });
  for (const item of history) {
    if (item.status === 'won' || finance.money(item.payout) > finance.money(item.bet)) break;
    if (isLossReceipt(item)) streak += 1;
    if (streak > threshold + 200) break;
  }
  if (streak < threshold) return;
  const shouldWarn = streak === threshold || ((streak - threshold) > 0 && (streak - threshold) % 5 === 0);
  if (!shouldWarn) return;
  const wallet = wallets.players?.[receipt.playerId] || {};
  const message = "Today seems to be an unlucky day! Take a short break to recharge, and we look forward to seeing you back soon.";
  if (!wallets.responsibleGamingWarnings) wallets.responsibleGamingWarnings = {};
  const warningKey = `${receipt.playerId}:${dayKey}:loss_streak`;
  const previousWarning = wallets.responsibleGamingWarnings[warningKey];
  if (previousWarning && Number(previousWarning.lossStreak || 0) >= streak) return;
  wallets.responsibleGamingWarnings[warningKey] = {
    warnedAt: new Date().toISOString(),
    message,
    lossStreak: streak,
    latestGame: receipt.game || '',
    latestReceiptId: receipt.id,
  };
  notifyPlayerTelegram(wallet, message);
  notifySeniorAdmins(wallets, `Responsible gaming warning\nPlayer: ${playerSummaryLine(receipt.playerId, wallet)}\nLoss streak: ${streak}\nAction: player warned only, not blocked\nLatest game: ${(receipt.game || 'game').toUpperCase()}`);
  recordAuditEvent(wallets, {
    category: 'responsible_gaming',
    event: 'loss_streak_warning',
    actorType: 'system',
    playerId: receipt.playerId,
    playerName: receipt.playerName || wallet.name || '',
    game: receipt.game || '',
    status: 'warned',
    details: { threshold, repeatEveryLosses: 5, lossStreak: streak, latestReceiptId: receipt.id, blocked: false },
  });
}

function maybeTriggerHighWinnerAlert(wallets, receipt) {
  if (!receipt || receipt.status !== 'won') return;
  if (finance.money(receipt.payout) < HIGH_WIN_ALERT_MIN_PAYOUT) return;
  const dayKey = localDateKey(new Date(receipt.createdAt || Date.now()));
  const playerId = receipt.playerId || '';
  if (!playerId) return;
  const qualifyingWins = (wallets.gameHistory || []).filter(item => {
    if (item.playerId !== playerId || item.status !== 'won') return false;
    if (finance.money(item.payout) < HIGH_WIN_ALERT_MIN_PAYOUT) return false;
    return localDateKey(new Date(item.createdAt || Date.now())) === dayKey;
  });
  if (qualifyingWins.length < HIGH_WIN_ALERT_MIN_WINS) return;
  if (!wallets.notificationState) wallets.notificationState = {};
  if (!wallets.notificationState.highWinnerAlerts) wallets.notificationState.highWinnerAlerts = {};
  const alertKey = `${dayKey}:${playerId}`;
  if (wallets.notificationState.highWinnerAlerts[alertKey]) return;
  wallets.notificationState.highWinnerAlerts[alertKey] = {
    alertedAt: new Date().toISOString(),
    count: qualifyingWins.length,
    minPayout: HIGH_WIN_ALERT_MIN_PAYOUT,
  };
  const wallet = wallets.players?.[playerId] || {};
  const totalPayout = qualifyingWins.reduce((sum, item) => sum + finance.money(item.payout), 0);
  notifySeniorAdmins(
    wallets,
    `High-winner alert\nPlayer: ${playerSummaryLine(playerId, wallet)}\nWins today: ${qualifyingWins.length} games\nEach prize: ${formatEtb(HIGH_WIN_ALERT_MIN_PAYOUT)}+\nTotal qualifying prizes: ${formatEtb(totalPayout)}\nLatest game: ${(receipt.game || 'game').toUpperCase()}\nLatest prize: ${formatEtb(receipt.payout)}`
  );
  recordAuditEvent(wallets, {
    category: 'fraud',
    event: 'high_winner_alert',
    actorType: 'system',
    playerId,
    playerName: receipt.playerName || wallet.name || '',
    game: receipt.game || '',
    amount: totalPayout,
    status: 'alerted',
    details: {
      dayKey,
      wins: qualifyingWins.length,
      minPayout: HIGH_WIN_ALERT_MIN_PAYOUT,
      latestReceiptId: receipt.id,
    },
  });
}

function publicReceipt(receipt, includeDetails = true) {
  return {
    id: receipt.id,
    game: receipt.game,
    playerId: receipt.playerId,
    playerName: receipt.playerName,
    bet: receipt.bet,
    payout: receipt.payout,
    profit: receipt.profit,
    status: receipt.status,
    createdAt: receipt.createdAt,
    details: includeDetails ? receipt.details || {} : {},
  };
}

function getPlayerReceipts(wallets, playerId) {
  return (wallets.gameHistory || [])
    .filter(receipt => receipt.playerId === playerId)
    .slice(0, 25)
    .map(receipt => publicReceipt(receipt, true));
}

function playerHistoryCutoffMs(days = PLAYER_HISTORY_DAYS) {
  return Date.now() - Math.max(1, Number(days) || PLAYER_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
}

function shortNumberList(numbers, limit = 12) {
  if (!Array.isArray(numbers) || !numbers.length) return '';
  const clean = numbers.map(n => Number(n)).filter(n => Number.isFinite(n));
  const shown = clean.slice(0, limit).join(', ');
  return clean.length > limit ? `${shown}...` : shown;
}

function playerGameHistoryText(receipt) {
  const game = String(receipt.game || 'game').toLowerCase();
  const details = receipt.details || {};
  const parts = [`Bet ${formatEtb(receipt.bet)}`];
  if (game === 'keno') {
    const picks = shortNumberList(details.picks, 20);
    if (picks) parts.push(`Picked ${picks}`);
    if (Number.isFinite(Number(details.matchCount))) parts.push(`Matched ${details.matchCount}`);
    if (Number.isFinite(Number(details.multiplier)) && Number(details.multiplier) > 0) parts.push(`${Number(details.multiplier)}x`);
  } else if (game === 'roulette') {
    const betType = String(details.type || '').replace(/_/g, ' ');
    const numbers = shortNumberList(details.numbers, 10);
    if (betType) parts.push(`Bet type ${betType}`);
    if (numbers) parts.push(`Numbers ${numbers}`);
    if (Number.isFinite(Number(details.winningNumber))) parts.push(`Result ${details.winningNumber}`);
  } else if (game === 'bingo') {
    if (details.cartelaId) parts.push(`Cartela ${details.cartelaId}`);
    if (Number.isFinite(Number(details.calledCount))) parts.push(`${details.calledCount} calls`);
    if (details.winnerName && receipt.status !== 'won') parts.push(`Winner ${details.winnerName}`);
  } else if (game === 'hilo') {
    if (details.choice) parts.push(`Choice ${String(details.choice).toUpperCase()}`);
    if (details.multiplier) parts.push(`${Number(details.multiplier).toFixed(2)}x`);
  }
  parts.push(`Payout ${formatEtb(receipt.payout)}`);
  return parts.join(' | ');
}

function buildPlayerHistory(wallets, playerId) {
  const wallet = wallets.players?.[playerId] || {};
  const cutoff = playerHistoryCutoffMs();
  const byGame = {};
  for (const receipt of wallets.gameHistory || []) {
    if (receipt.playerId !== playerId) continue;
    const game = String(receipt.game || 'game').toLowerCase();
    if (!byGame[game]) byGame[game] = { game, played: 0, wins: 0, totalPaid: 0 };
    byGame[game].played += 1;
    if (receipt.status === 'won' || finance.money(receipt.profit) > 0) byGame[game].wins += 1;
    byGame[game].totalPaid += Math.max(0, finance.money(receipt.payout));
  }

  const activities = [];
  for (const receipt of wallets.gameHistory || []) {
    if (receipt.playerId !== playerId) continue;
    const timeMs = Date.parse(receipt.createdAt || '');
    if (!Number.isFinite(timeMs) || timeMs < cutoff) continue;
    const profit = finance.money(receipt.profit);
    activities.push({
      type: 'game',
      id: receipt.id || '',
      time: receipt.createdAt || '',
      title: `Played ${String(receipt.game || 'game').toUpperCase()}`,
      subtitle: playerGameHistoryText(receipt),
      amount: profit,
      status: receipt.status || (profit > 0 ? 'won' : 'played'),
      game: receipt.game || '',
    });
  }

  activities.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  return {
    retentionDays: PLAYER_HISTORY_DAYS,
    summary: {
      playerCode: playerPublicCode(playerId),
      gamesPlayed: wallet.gamesPlayed || 0,
      wins: wallet.wins || 0,
      totalWon: wallet.totalWon || 0,
      balance: wallet.balance || 0,
      byGame: Object.values(byGame).sort((a, b) => b.played - a.played),
    },
    activities: activities.slice(0, 300),
  };
}

function publicRequest(request) {
  return {
    id: request.id,
    type: request.type,
    playerId: request.playerId,
    playerCode: playerPublicCode(request.playerId),
    name: request.name,
    phone: request.phone,
    amount: request.amount,
    fee: request.fee || 0,
    totalDebit: request.totalDebit || request.amount,
    feeStatus: request.feeStatus || '',
    depositAccountId: request.depositAccountId || '',
    depositAccountLabel: request.depositAccountLabel || '',
    depositAccountName: request.depositAccountName || '',
    depositAccountNumber: request.depositAccountNumber || '',
    depositAccountOwnerAdminId: request.depositAccountOwnerAdminId || '',
    depositAccountOwnerAdminName: request.depositAccountOwnerAdminName || '',
    assignedWithdrawAdminId: request.assignedWithdrawAdminId || '',
    assignedWithdrawAdminName: request.assignedWithdrawAdminName || '',
    assignedWithdrawAt: request.assignedWithdrawAt || '',
    assignmentStatus: request.assignmentStatus || '',
    assignmentNote: request.assignmentNote || '',
    payoutPhone: request.payoutPhone || '',
    reference: request.reference || '',
    smsId: request.smsId || '',
    source: request.source || '',
    status: request.status,
    note: request.note || '',
    createdAt: request.createdAt,
    expiresAt: request.expiresAt || null,
    updatedAt: request.updatedAt || null,
    resolvedAt: request.resolvedAt || null,
    resolvedBy: request.resolvedBy || null,
    resolutionNote: request.resolutionNote || '',
    balanceBeforeReserve: request.balanceBeforeReserve ?? null,
    balanceAfterReserve: request.balanceAfterReserve ?? null,
  };
}

function expirePendingDepositRequests(wallets, nowMs = Date.now()) {
  if (!wallets?.requests) return 0;
  let expiredCount = 0;
  for (const request of wallets.requests) {
    if (request.type !== 'deposit' || request.status !== 'pending') continue;
    const expiresAt = Date.parse(request.expiresAt || '');
    if (!Number.isFinite(expiresAt) || expiresAt > nowMs) continue;
    request.status = 'expired';
    request.updatedAt = new Date(nowMs).toISOString();
    request.resolvedAt = request.updatedAt;
    request.resolvedBy = 'system_expiry';
    request.resolutionNote = 'Deposit request expired before payment confirmation.';
    expiredCount++;
    recordAuditEvent(wallets, {
      time: request.updatedAt,
      category: 'wallet',
      event: 'deposit_request_expired',
      actorType: 'system',
      actorId: 'system',
      playerId: request.playerId || '',
      playerName: request.name || '',
      amount: request.amount || 0,
      status: 'expired',
      details: {
        requestId: request.id,
        createdAt: request.createdAt || '',
        expiresAt: request.expiresAt || '',
      },
    });
  }
  return expiredCount;
}

function cleanDepositAccount(raw = {}) {
  const label = String(raw.label || raw.name || '').trim().slice(0, 80);
  const receiverName = String(raw.receiverName || raw.accountName || '').trim().slice(0, 120);
  const accountNumber = String(raw.accountNumber || raw.phone || '').replace(/[^\d+]/g, '').slice(0, 40);
  const notes = String(raw.notes || '').trim().slice(0, 200);
  const levelRaw = parseInt(raw.level ?? raw.slot ?? raw.position, 10);
  const dailyLimit = parseInt(raw.dailyLimit, 10);
  const minAmount = parseInt(raw.minAmount, 10);
  const maxAmount = parseInt(raw.maxAmount, 10);
  return {
    label,
    receiverName,
    accountNumber,
    level: Number.isFinite(levelRaw) && levelRaw > 0 ? Math.min(3, Math.round(levelRaw)) : 1,
    notes,
    dailyLimit: Number.isFinite(dailyLimit) && dailyLimit > 0 ? dailyLimit : 100000,
    minAmount: Number.isFinite(minAmount) && minAmount > 0 ? minAmount : 10,
    maxAmount: Number.isFinite(maxAmount) && maxAmount > 0 ? maxAmount : 100000,
  };
}

function adminDisplayName(wallets, adminId) {
  const admin = wallets?.adminUsers?.[adminId];
  if (!admin) return adminId ? 'Unassigned admin' : 'Unassigned';
  return admin.name || admin.username || admin.phone || adminId;
}

function activeDepositAccountCountForOwner(wallets, ownerAdminId, excludeAccountId = '') {
  return (wallets.depositAccounts || []).filter(account =>
    account.status !== 'deleted' &&
    account.ownerAdminId === ownerAdminId &&
    account.id !== excludeAccountId
  ).length;
}

function normalizeDepositAccountInputs(rawAccounts) {
  const list = Array.isArray(rawAccounts) ? rawAccounts : [];
  return list
    .map((account, index) => ({ ...cleanDepositAccount(account), level: cleanDepositAccount(account).level || index + 1 }))
    .filter(account => account.label || account.receiverName || account.accountNumber)
    .slice(0, 3);
}

function createDepositAccountRecord(wallets, clean, ownerAdminId = '', createdBy = '') {
  if (!clean.accountNumber) {
    return { error: 'Each deposit account needs a Telebirr number.' };
  }
  const ownerId = cleanDepositAccountOwner(wallets, ownerAdminId);
  if (ownerAdminId && !ownerId) return { error: 'Deposit account owner must be an active Senior Admin.' };
  if (ownerId && activeDepositAccountCountForOwner(wallets, ownerId) >= 3) {
    return { error: 'A Senior Admin can have up to 3 active deposit accounts.' };
  }
  const duplicate = (wallets.depositAccounts || []).find(account => account.status !== 'deleted' && account.accountNumber === clean.accountNumber);
  if (duplicate) return { error: 'That deposit account number already exists.' };
  const ownerName = adminDisplayName(wallets, ownerId);
  const level = Number.isFinite(Number(clean.level)) && Number(clean.level) > 0 ? Math.min(3, Math.round(Number(clean.level))) : 1;
  const account = {
    id: fairRng.randomId('depacct'),
    ...clean,
    label: clean.label || `${ownerName} deposit ${level}`,
    receiverName: clean.receiverName || ownerName,
    level,
    ownerAdminId: ownerId,
    ownerAdminName: adminDisplayName(wallets, ownerId),
    status: 'active',
    createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!wallets.depositAccounts) wallets.depositAccounts = [];
  wallets.depositAccounts.push(account);
  return { account };
}

function cleanDepositAccountOwner(wallets, ownerAdminId) {
  const cleanId = String(ownerAdminId || '').trim();
  if (!cleanId) return '';
  const admin = wallets.adminUsers?.[cleanId];
  if (!admin || admin.deleted || admin.active === false || admin.role !== 'senior') return '';
  return cleanId;
}

function publicDepositAccount(account = {}, wallets = null) {
  return {
    id: account.id,
    label: account.label || '',
    receiverName: account.receiverName || '',
    accountNumber: account.accountNumber || '',
    level: account.level || 1,
    ownerAdminId: account.ownerAdminId || '',
    ownerAdminName: wallets ? adminDisplayName(wallets, account.ownerAdminId) : account.ownerAdminName || '',
    status: account.status || 'active',
    dailyLimit: account.dailyLimit || 100000,
    minAmount: account.minAmount || 10,
    maxAmount: account.maxAmount || 100000,
    notes: account.notes || '',
    assignedToday: account.assignedToday || 0,
    pendingCount: account.pendingCount || 0,
    createdAt: account.createdAt || '',
    updatedAt: account.updatedAt || '',
  };
}

function normalizeAdminFloat(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? finance.money(parsed) : 0;
}

function activeSeniorWithdrawalAdmins(wallets, amount = 0, excludeIds = []) {
  const exclude = new Set((excludeIds || []).map(id => String(id || '').trim()).filter(Boolean));
  return Object.values(wallets.adminUsers || {})
    .filter(admin =>
      admin &&
      !admin.deleted &&
      admin.active !== false &&
      admin.role === 'senior' &&
      !exclude.has(admin.id) &&
      finance.money(admin.withdrawalFloatBalance || 0) >= finance.money(amount)
    )
    .sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || '')) ||
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
      String(a.id || '').localeCompare(String(b.id || ''))
    );
}

function chooseWithdrawalAdmin(wallets, amount, excludeIds = []) {
  const admins = activeSeniorWithdrawalAdmins(wallets, amount, excludeIds);
  if (!admins.length) return null;
  if (!wallets.withdrawalRouting) wallets.withdrawalRouting = {};
  const index = Number.isInteger(wallets.withdrawalRouting.nextIndex) ? wallets.withdrawalRouting.nextIndex : 0;
  const selected = admins[index % admins.length];
  wallets.withdrawalRouting.nextIndex = (index + 1) % admins.length;
  wallets.withdrawalRouting.updatedAt = new Date().toISOString();
  return selected;
}

function activeSupportRoutingAdmins(wallets, excludeIds = []) {
  const exclude = new Set((excludeIds || []).map(id => String(id || '').trim()).filter(Boolean));
  return Object.values(wallets.adminUsers || {})
    .filter(admin =>
      admin &&
      !admin.deleted &&
      admin.active !== false &&
      ['senior', 'support'].includes(admin.role) &&
      !exclude.has(admin.id)
    )
    .sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || '')) ||
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
      String(a.id || '').localeCompare(String(b.id || ''))
    );
}

function chooseSupportAdmin(wallets, excludeIds = []) {
  const admins = activeSupportRoutingAdmins(wallets, excludeIds);
  if (!admins.length) return null;
  if (!wallets.supportRouting) wallets.supportRouting = {};
  const index = Number.isInteger(wallets.supportRouting.nextIndex) ? wallets.supportRouting.nextIndex : 0;
  const selected = admins[index % admins.length];
  wallets.supportRouting.nextIndex = (index + 1) % admins.length;
  wallets.supportRouting.updatedAt = new Date().toISOString();
  return selected;
}

function assignSupportRequest(wallets, request, excludeIds = []) {
  const admin = chooseSupportAdmin(wallets, excludeIds);
  const now = new Date().toISOString();
  request.assignmentAttempts = Array.isArray(request.assignmentAttempts) ? request.assignmentAttempts : [];
  if (!admin) {
    request.assignedAdminId = '';
    request.assignedAdminName = '';
    request.assignedAt = '';
    request.assignmentStatus = 'needs_master';
    request.assignmentNote = 'No active support or senior admin is available.';
    recordAuditEvent(wallets, {
      time: now,
      category: 'support',
      event: 'support_assignment_failed',
      actorType: 'system',
      actorId: 'system',
      playerId: request.playerId || '',
      playerName: request.playerName || '',
      status: 'needs_master',
      details: { requestId: request.id },
    });
    return { error: request.assignmentNote };
  }
  request.assignedAdminId = admin.id;
  request.assignedAdminName = adminDisplayName(wallets, admin.id);
  request.assignedAt = now;
  request.assignmentStatus = 'assigned';
  request.assignmentNote = '';
  request.assignmentAttempts.push({ adminId: admin.id, adminName: request.assignedAdminName, assignedAt: now });
  recordAuditEvent(wallets, {
    time: now,
    category: 'support',
    event: 'support_assigned',
    actorType: 'system',
    actorId: admin.id,
    actorName: request.assignedAdminName,
    playerId: request.playerId || '',
    playerName: request.playerName || '',
    status: 'assigned',
    details: { requestId: request.id },
  });
  return { admin };
}

function assignWithdrawalRequest(wallets, request, amount, excludeIds = []) {
  const admin = chooseWithdrawalAdmin(wallets, amount, excludeIds);
  const now = new Date().toISOString();
  request.assignmentAttempts = Array.isArray(request.assignmentAttempts) ? request.assignmentAttempts : [];
  if (!admin) {
    request.assignedWithdrawAdminId = '';
    request.assignedWithdrawAdminName = '';
    request.assignedWithdrawAt = '';
    request.assignmentStatus = 'needs_master';
    request.assignmentNote = 'No active Senior Admin float can cover this withdrawal.';
    recordAuditEvent(wallets, {
      time: now,
      category: 'wallet',
      event: 'withdraw_assignment_failed',
      actorType: 'system',
      actorId: 'system',
      playerId: request.playerId || '',
      playerName: request.name || '',
      amount: finance.money(amount),
      status: 'needs_master',
      details: { requestId: request.id },
    });
    return { error: request.assignmentNote };
  }
  request.assignedWithdrawAdminId = admin.id;
  request.assignedWithdrawAdminName = adminDisplayName(wallets, admin.id);
  request.assignedWithdrawAt = now;
  request.assignmentStatus = 'assigned';
  request.assignmentNote = '';
  request.assignmentAttempts.push({ adminId: admin.id, adminName: request.assignedWithdrawAdminName, assignedAt: now });
  recordAuditEvent(wallets, {
    time: now,
    category: 'wallet',
    event: 'withdraw_assigned',
    actorType: 'system',
    actorId: admin.id,
    actorName: request.assignedWithdrawAdminName,
    playerId: request.playerId || '',
    playerName: request.name || '',
    amount: finance.money(amount),
    status: 'assigned',
    details: { requestId: request.id, adminFloatBalance: finance.money(admin.withdrawalFloatBalance || 0) },
  });
  return { admin };
}

function publicAdminFloatSummary(wallets, session = null) {
  const canSeeAll = !session || session.role === 'master' || adminHasPermission(session, 'manage_admins');
  return Object.values(wallets.adminUsers || {})
    .filter(admin => admin && !admin.deleted && admin.role === 'senior' && (canSeeAll || admin.id === session.adminId))
    .map(admin => {
      const assignedPending = (wallets.requests || []).filter(req =>
        req.type === 'withdraw' &&
        req.status === 'pending' &&
        req.assignedWithdrawAdminId === admin.id
      );
      return {
        adminId: admin.id,
        name: adminDisplayName(wallets, admin.id),
        username: admin.username || '',
        active: admin.active !== false,
        withdrawalFloatBalance: finance.money(admin.withdrawalFloatBalance || 0),
        pendingWithdrawals: assignedPending.length,
        pendingWithdrawalAmount: assignedPending.reduce((sum, req) => sum + finance.money(req.amount), 0),
      };
    })
    .sort((a, b) => b.withdrawalFloatBalance - a.withdrawalFloatBalance || a.name.localeCompare(b.name));
}

function ensureAdminCashStatements(wallets) {
  if (!wallets.adminCashStatements) wallets.adminCashStatements = [];
  return wallets.adminCashStatements;
}

function cleanStatementText(value, max = 220) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function recordAdminCashMovement(wallets, options = {}) {
  const adminId = String(options.adminId || '').trim();
  if (!adminId) return null;
  const admin = wallets.adminUsers?.[adminId];
  if (!admin || admin.deleted) return null;
  const amount = finance.money(options.amount || 0);
  const direction = String(options.direction || 'system').toLowerCase();
  const now = new Date().toISOString();
  const applyToFloat = options.applyToFloat === true && amount > 0;
  if (applyToFloat) {
    const current = finance.money(admin.withdrawalFloatBalance || 0);
    if (direction === 'in') admin.withdrawalFloatBalance = current + amount;
    if (direction === 'out') admin.withdrawalFloatBalance = Math.max(0, current - amount);
    admin.withdrawalFloatUpdatedAt = now;
  }
  const entry = {
    id: fairRng.randomId('cashstmt'),
    time: now,
    adminId,
    adminName: adminDisplayName(wallets, adminId),
    adminUsername: admin.username || '',
    type: cleanStatementText(options.type || 'cash_movement', 80),
    direction: ['in', 'out', 'system'].includes(direction) ? direction : 'system',
    amount,
    balanceAfter: finance.money(admin.withdrawalFloatBalance || 0),
    requestId: cleanStatementText(options.requestId || '', 80),
    playerId: cleanStatementText(options.playerId || '', 80),
    playerName: cleanStatementText(options.playerName || '', 120),
    reference: cleanStatementText(options.reference || '', 120),
    note: cleanStatementText(options.note || ''),
    source: cleanStatementText(options.source || '', 80),
    cashImpact: applyToFloat ? direction : 'none',
  };
  ensureAdminCashStatements(wallets).unshift(entry);
  if (wallets.adminCashStatements.length > 5000) wallets.adminCashStatements.length = 5000;
  recordAuditEvent(wallets, {
    time: now,
    category: 'admin_cash',
    event: entry.type,
    actorType: options.actorType || 'admin',
    actorId: adminId,
    actorName: entry.adminName,
    playerId: entry.playerId,
    playerName: entry.playerName,
    amount,
    status: entry.direction,
    details: {
      statementId: entry.id,
      requestId: entry.requestId,
      reference: entry.reference,
      balanceAfter: entry.balanceAfter,
      cashImpact: entry.cashImpact,
      note: entry.note,
    },
  });
  return entry;
}

function publicAdminCashStatements(wallets, session = null) {
  const canSeeAll = !session || session.role === 'master' || adminHasPermission(session, 'manage_admins');
  return ensureAdminCashStatements(wallets)
    .filter(entry => canSeeAll || entry.adminId === session.adminId)
    .slice(0, 500);
}

function depositAccountStats(wallets) {
  expirePendingDepositRequests(wallets);
  const today = new Date().toISOString().slice(0, 10);
  const pending = (wallets.requests || []).filter(req => req.type === 'deposit' && req.status === 'pending');
  return (wallets.depositAccounts || []).map(account => {
    const accountPending = pending.filter(req => req.depositAccountId === account.id);
    const assignedToday = (wallets.requests || [])
      .filter(req => req.type === 'deposit' && req.depositAccountId === account.id && String(req.createdAt || '').slice(0, 10) === today)
      .reduce((sum, req) => sum + finance.money(req.amount), 0);
    return publicDepositAccount({ ...account, pendingCount: accountPending.length, assignedToday }, wallets);
  });
}

function chooseDepositAccount(wallets, amount) {
  let accounts = depositAccountStats(wallets).filter(account =>
    account.status === 'active' &&
    amount >= account.minAmount &&
    amount <= account.maxAmount &&
    account.assignedToday + amount <= account.dailyLimit
  );
  if (!accounts.length) return null;
  const assignedAccounts = accounts.filter(account => account.ownerAdminId);
  if (assignedAccounts.length) accounts = assignedAccounts;
  accounts.sort((a, b) =>
    String(a.ownerAdminName || '').localeCompare(String(b.ownerAdminName || '')) ||
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  );
  if (!wallets.depositAccountRouting) wallets.depositAccountRouting = {};
  const index = Number.isInteger(wallets.depositAccountRouting.nextIndex) ? wallets.depositAccountRouting.nextIndex : 0;
  const selected = accounts[index % accounts.length];
  wallets.depositAccountRouting.nextIndex = (index + 1) % accounts.length;
  wallets.depositAccountRouting.updatedAt = new Date().toISOString();
  return selected;
}

function getPlayerRequests(wallets, playerId) {
  expirePendingDepositRequests(wallets);
  return (wallets.requests || [])
    .filter(req => req.playerId === playerId)
    .filter(req => !(req.type === 'deposit' && req.status === 'expired'))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20)
    .map(publicRequest);
}

function extractPaymentReference(value) {
  return paymentMatching.parsePaymentSms(String(value || '')).reference;
}

function reservePaymentReference(wallets, reference, details = {}) {
  const cleanReference = String(reference || '').trim().toUpperCase();
  if (!cleanReference) return { error: 'Payment reference is required.' };
  if (!wallets.usedPaymentRefs) wallets.usedPaymentRefs = {};
  const existing = wallets.usedPaymentRefs[cleanReference];
  if (existing && existing.requestId !== details.requestId) {
    return { error: `Reference ${cleanReference} was already used.` };
  }
  wallets.usedPaymentRefs[cleanReference] = {
    ...details,
    usedAt: new Date().toISOString(),
  };
  return { reference: cleanReference };
}

function createDepositRequest(wallets, playerId, wallet, payload = {}, source = 'mini_app') {
  expirePendingDepositRequests(wallets);
  const parsedAmount = parseInt(payload.amount, 10);
  const payerPhone = normalizePhone(payload.payerPhone || payload.phone || wallet.phone);
  const payerPhoneLast4 = paymentMatching.phoneLast4(payerPhone);
  if (!Number.isFinite(parsedAmount) || parsedAmount < 10 || parsedAmount > 100000) return { error: 'Deposit amount must be 10-100000 ETB.' };
  if (!payerPhoneLast4) return { error: 'Enter the phone number you will pay from.' };
  const depositAccount = chooseDepositAccount(wallets, parsedAmount);
  if (!depositAccount) return { error: 'No active Telebirr deposit account is available for this amount. Please contact support.' };
  const now = Date.now();
  const existing = (wallets.requests || []).find(request =>
    request.type === 'deposit' &&
    request.status === 'pending' &&
    request.playerId === playerId &&
    request.amount === parsedAmount &&
    request.payerPhoneLast4 === payerPhoneLast4 &&
    request.depositAccountId === depositAccount.id &&
    Date.parse(request.expiresAt || '') > now
  );
  if (existing) return { request: existing, existing: true };
  wallet.defaultDepositPhone = payerPhone || wallet.defaultDepositPhone || wallet.phone || '';
  const request = {
    id: makeRequestId(),
    type: 'deposit',
    playerId,
    name: wallet.name,
    phone: wallet.phone || '',
    amount: parsedAmount,
    payerPhoneLast4,
    payerPhoneMasked: payerPhone ? `****${payerPhoneLast4}` : '',
    depositAccountId: depositAccount.id,
    depositAccountLabel: depositAccount.label,
    depositAccountName: depositAccount.receiverName,
    depositAccountNumber: depositAccount.accountNumber,
    depositAccountOwnerAdminId: depositAccount.ownerAdminId || '',
    depositAccountOwnerAdminName: depositAccount.ownerAdminName || '',
    note: String(payload.note || '').trim().slice(0, 120),
    source,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + paymentMatching.DEPOSIT_EXPIRY_MS).toISOString(),
  };
  wallets.requests.push(request);
  recordAuditEvent(wallets, {
    time: request.createdAt,
    category: 'wallet',
    event: 'deposit_request_created',
    actorType: 'player',
    actorId: playerId,
    actorName: wallet.name || '',
    playerId,
    playerName: wallet.name || '',
    amount: parsedAmount,
    status: 'pending',
    details: {
      requestId: request.id,
      source,
      depositAccountId: depositAccount.id,
    },
  });
  return { request };
}

function createWithdrawRequest(wallets, playerId, wallet, payload = {}, source = 'mini_app') {
  const parsedAmount = parseInt(payload.amount, 10);
  const payoutPhone = normalizePhone(payload.payoutPhone || payload.phone || wallet.phone);
  const walletSettings = activeGameSettings(wallets, 'wallet');
  const withdrawalFee = walletSettings.withdrawalFeeEnabled === true
    ? Math.max(0, Math.floor(parsedAmount * walletSettings.withdrawalFeeRate) + Math.floor(walletSettings.withdrawalFeeFlat || 0))
    : 0;
  if (!verifyPin(wallet, payload.pin)) return { error: 'Wrong withdrawal PIN.' };
  migratePinHash(wallet, payload.pin);
  if (!Number.isFinite(parsedAmount) || parsedAmount < walletSettings.minWithdrawEtb || parsedAmount > walletSettings.maxWithdrawEtb) return { error: `Withdrawal amount must be ${walletSettings.minWithdrawEtb}-${walletSettings.maxWithdrawEtb} ETB.` };
  if (!payoutPhone) return { error: 'Enter a valid payout phone number.' };
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = (wallets.requests || [])
    .filter(req => req.type === 'withdraw' && req.playerId === playerId && req.status !== 'rejected' && String(req.createdAt || '').slice(0, 10) === today)
    .reduce((sum, req) => sum + finance.money(req.amount), 0);
  if (usedToday + parsedAmount > walletSettings.dailyWithdrawLimitEtb) return { error: `Daily withdrawal limit is ${walletSettings.dailyWithdrawLimitEtb} ETB.` };
  const lockedPromo = finance.money(wallet.signupPromoLockedBalance || 0);
  const withdrawableBalance = Math.max(0, finance.money(wallet.balance || 0) - lockedPromo);
  if (withdrawableBalance < parsedAmount + withdrawalFee) {
    return { error: `You can withdraw up to ${withdrawableBalance} ETB. Starter promo credit is playable but not withdrawable.` };
  }
  const balanceBeforeReserve = finance.money(wallet.balance);
  const reserved = finance.reserveWithdrawal(wallets, playerId, wallet, parsedAmount, `Withdrawal reserved for ${wallet.name}`, { request: 'pending', source });
  if (reserved.error) return reserved;
  const request = {
    id: makeRequestId(),
    type: 'withdraw',
    playerId,
    name: wallet.name,
    phone: wallet.phone || '',
    payoutPhone,
    amount: parsedAmount,
    note: String(payload.note || '').trim().slice(0, 120),
    source,
    status: 'pending',
    createdAt: new Date().toISOString(),
    fee: withdrawalFee,
    feeStatus: withdrawalFee > 0 ? 'pending_approval' : 'none',
    totalDebit: parsedAmount + withdrawalFee,
    balanceBeforeReserve,
    balanceAfterReserve: finance.money(wallet.balance),
  };
  const assigned = assignWithdrawalRequest(wallets, request, parsedAmount, []);
  wallets.requests.push(request);
  recordAuditEvent(wallets, {
    time: request.createdAt,
    category: 'wallet',
    event: 'withdraw_request_created',
    actorType: 'player',
    actorId: playerId,
    actorName: wallet.name || '',
    playerId,
    playerName: wallet.name || '',
    amount: parsedAmount,
    fee: withdrawalFee,
    totalDebit: parsedAmount + withdrawalFee,
    status: 'pending',
    details: {
      requestId: request.id,
      source,
      payoutPhone,
      balanceBeforeReserve,
      balanceAfterReserve: request.balanceAfterReserve,
      lockedPromo,
      withdrawableBalance,
      assignedWithdrawAdminId: request.assignedWithdrawAdminId || '',
      assignedWithdrawAdminName: request.assignedWithdrawAdminName || '',
    },
  });
  return { request };
}

// ──────────────────────────────────────
// BINGO CARD GENERATION
// ──────────────────────────────────────
function withdrawalFeeWasChargedAtRequest(request) {
  const fee = finance.money(request?.fee || 0);
  if (fee <= 0) return false;
  if (request.feeStatus === 'charged_at_request' || request.feeStatus === 'charged') return true;
  if (request.feeStatus === 'pending_approval' || request.feeStatus === 'none') return false;
  const before = finance.money(request.balanceBeforeReserve);
  const after = finance.money(request.balanceAfterReserve);
  const amount = finance.money(request.amount);
  return before > 0 && before - after >= amount + fee;
}

function chargeWithdrawalFeeOnApproval(wallets, request, wallet, adminNote) {
  const fee = finance.money(request?.fee || 0);
  if (fee <= 0) {
    request.feeStatus = 'none';
    request.feeChargedAt = '';
    return { success: true };
  }
  if (withdrawalFeeWasChargedAtRequest(request)) {
    request.feeStatus = 'charged';
    request.feeChargedAt = request.feeChargedAt || request.createdAt || new Date().toISOString();
    return { success: true, alreadyCharged: true };
  }
  const moved = finance.debitPlayerToAccount(
    wallets,
    request.playerId,
    wallet,
    'withdrawalFeeVault',
    fee,
    `Withdrawal fee from ${wallet.name}: ${adminNote}`,
    'withdrawal_fee',
    { requestId: request.id }
  );
  if (moved.error) return moved;
  request.feeStatus = 'charged';
  request.feeChargedAt = new Date().toISOString();
  return { success: true };
}

function generateBingoCard() {
  const columns = [{ min: 1, max: 15 }, { min: 16, max: 30 }, { min: 31, max: 45 }, { min: 46, max: 60 }, { min: 61, max: 75 }];
  const grid = [[], [], [], [], []];
  for (let col = 0; col < 5; col++) {
    const { min, max } = columns[col];
    const pool = [];
    for (let i = min; i <= max; i++) pool.push(i);
    const drawn = fairRng.cryptoShuffle(pool).slice(0, 5).sort((a, b) => a - b);
    for (let row = 0; row < 5; row++) grid[row][col] = drawn[row];
  }
  grid[2][2] = -1;
  return grid;
}
function cardsIdentical(a, b) { for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (a[r][c] !== b[r][c]) return false; return true; }
function generateUniqueCards(count) { const cards = []; while (cards.length < count) { const card = generateBingoCard(); if (!cards.some(c => cardsIdentical(c, card))) cards.push(card); } return cards; }

console.log('Generating 100 unique Cartelas…');
const CARTELAS = generateUniqueCards(100);
console.log(`Generated ${CARTELAS.length} Cartelas.`);

// ──────────────────────────────────────
// GAME ROOMS
// ──────────────────────────────────────
function createGameRoom(bet) {
  const room = { bet, status: 'lobby', players: [], calledNumbers: [], calledNumberSet: new Set(), takenCartelas: new Set(), countdownTimer: null, drawTimer: null, pendingDrawTimer: null, winnerDisplayTimer: null, countdownRemaining: 0, drawOrder: [], drawIndex: 0, pendingDraw: null, claimPending: false, escrowPot: 0, roundId: '', proof: null, serverSeed: '', serverSeedHash: '' };
  prepareBingoCommit(room);
  return room;
}
const gameRooms = Object.fromEntries(BETS.map(b => [b, createGameRoom(b)]));
const socketRoom = new Map();
const adminSockets = new Set();
const adminSessions = new Map();
const adminBrowserSessions = new Map();
const adminLoginAttempts = new Map();
const playerLoginAttempts = new Map();
const socketActionLimits = new Map();

function getBingoSettings() {
  return activeGameSettings(loadWallets(), 'bingo');
}

function getBingoBetAmounts(wallets = loadWallets()) {
  return activeGameSettings(wallets, 'bingo').bettingAmounts;
}

function syncBingoRooms(wallets = loadWallets()) {
  for (const bet of getBingoBetAmounts(wallets)) {
    if (!gameRooms[bet]) gameRooms[bet] = createGameRoom(bet);
  }
}

function getBingoRoomList(wallets = loadWallets()) {
  syncBingoRooms(wallets);
  const activeBets = new Set(getBingoBetAmounts(wallets));
  return Object.values(gameRooms)
    .filter(room => activeBets.has(room.bet) || room.players.length > 0 || room.status !== 'lobby')
    .sort((a, b) => a.bet - b.bet);
}

// ── ROULETTE STATE ──
const ROULETTE_BETS = [10, 20, 50, 100, 200];
const ROULETTE_COUNTDOWN = 45; // seconds for betting phase
const ROULETTE_RESULT_PROCESS_DELAY_MS = 8500;
const ROULETTE_RESULT_DISPLAY = 12; // seconds to show result
const rouletteState = {
  status: 'betting', // betting | spinning | result
  roundNumber: 0,
  bets: {}, // { betId: { playerId, playerName, socketId, type, numbers: [], amount } }
  nextBetId: 1,
  winningNumber: null,
  winningColor: null,
  serverSeed: '',
  serverSeedHash: '',
  proof: null,
  committedRoundNumber: 1,
  countdownRemaining: ROULETTE_COUNTDOWN,
  countdownTimer: null,
  resultTimer: null,
  playerResults: {},
  lastResults: [], // { number, color, totalBets, totalPayouts, playerCount } last 10
};
const rouletteSpinningPlayers = new Set();

function getRouletteSettings(wallets = loadWallets()) {
  return activeGameSettings(wallets, 'roulette');
}

// --- DINO BETTING RACE STATE ---
const dinoRooms = new Map(); // roomId → room object
const dinoRoomTimers = new Map(); // roomId → { countdown, tick, cleanup }

// ── HI-LO STATE ──
const DINO_MIN_PLAYERS = Math.max(1, Math.floor(Number(process.env.DINO_MIN_PLAYERS || 1)));
const DINO_COUNTDOWN_MS = Math.max(3000, Math.floor(Number(process.env.DINO_COUNTDOWN_MS || 10000)));
const DINO_MAX_DISTANCE = Math.max(5000, Math.floor(Number(process.env.DINO_MAX_DISTANCE || 50000)));

const hiloPlayers = new Map(); // playerId -> isolated Hi-Lo state
const hiloTimers = new Map();  // playerId -> { betting, dealing, result }

function publicHiloState(state) {
  const multipliers = hiloLogic.getCurrentMultipliers(state);
  return {
    status: state.status,
    baseCard: state.baseCard,
    nextCard: state.nextCard,
    countdownEnd: state.countdownEnd,
    playerChoice: state.playerChoice,
    playerBet: state.activeStake || state.playerBet || 0,
    playerWon: state.playerWon,
    effectiveMultiplier: state.effectiveMultiplier || 1,
    roundMultiplier: state.roundMultiplier || 1,
    roundNumber: state.roundNumber,
    multipliers,
    availableChoices: multipliers.available || [],
    history: state.history.slice(-10),
    activeStake: state.activeStake || 0,
  };
}

function getHiloSocket(playerId) {
  const state = hiloPlayers.get(playerId);
  return state?.socketId ? io.sockets.sockets.get(state.socketId) : null;
}

function clearHiloTimers(playerId) {
  const timers = hiloTimers.get(playerId);
  if (!timers) return;
  if (timers.betting) clearTimeout(timers.betting);
  if (timers.dealing) clearTimeout(timers.dealing);
  if (timers.result) clearTimeout(timers.result);
  hiloTimers.delete(playerId);
}

function emitHiloState(playerId) {
  const state = hiloPlayers.get(playerId);
  const sock = getHiloSocket(playerId);
  if (state && sock) sock.emit('hiloState', publicHiloState(state));
}

function ensureHiloState(playerId, socket = null) {
  let state = hiloPlayers.get(playerId);
  if (!state) {
    state = hiloLogic.createGameState();
    state.activeStake = 0;
    hiloPlayers.set(playerId, state);
    startHiloRound(playerId, false);
  }
  if (socket) state.socketId = socket.id;
  return state;
}

function startHiloRound(playerId, preserveStake = false) {
  let state = hiloPlayers.get(playerId);
  if (!state) {
    state = hiloLogic.createGameState();
    state.activeStake = 0;
    hiloPlayers.set(playerId, state);
  }
  const activeStake = preserveStake ? finance.money(state.activeStake) : 0;
  const effectiveMultiplier = preserveStake ? (state.effectiveMultiplier || 1) : 1;
  const history = state.history || [];
  const canContinueDeck = preserveStake && state.nextCard && Array.isArray(state.deck) && state.deck.length > 0;
  if (canContinueDeck) {
    state.roundNumber++;
    state.baseCard = state.nextCard;
    state.nextCard = null;
    state.playerChoice = null;
    state.playerBet = activeStake;
    state.playerWon = null;
    state.roundMultiplier = 1;
    state.status = 'idle';
  } else {
    const serverSeed = hiloLogic.generateServerSeed();
    hiloLogic.initRound(state, serverSeed, playerId);
    state.serverSeed = serverSeed;
  }
  hiloLogic.startBetting(state);
  state.activeStake = activeStake;
  state.playerBet = activeStake;
  state.effectiveMultiplier = effectiveMultiplier;
  state.history = history.slice(-10);
  emitHiloState(playerId);

  clearHiloTimers(playerId);
  const timers = {};
  timers.betting = setTimeout(() => {
    const current = hiloPlayers.get(playerId);
    if (!current || current.status !== 'betting' || current.playerChoice) return;
    startHiloRound(playerId, current.activeStake > 0);
  }, 6500);
  hiloTimers.set(playerId, timers);
}

function scheduleHiloResolve(playerId) {
  const timers = hiloTimers.get(playerId) || {};
  if (timers.betting) clearTimeout(timers.betting);
  if (timers.dealing) clearTimeout(timers.dealing);
  timers.dealing = setTimeout(() => resolveHiloRound(playerId), 2000);
  hiloTimers.set(playerId, timers);
}

function resolveHiloRound(playerId) {
  const state = hiloPlayers.get(playerId);
  if (!state || state.status !== 'dealing') return;
  hiloLogic.resolveRound(state);
  if (!state.playerWon) {
    const wallets = loadWallets();
    const wallet = wallets.players[playerId];
    if (wallet && state.activeStake > 0) {
      recordGameHistory(wallets, {
        game: 'hilo',
        playerId,
        playerName: wallet.name,
        bet: state.activeStake,
        payout: 0,
        status: 'lost',
        details: {
          round: state.roundNumber,
          choice: state.playerChoice,
          baseCard: state.baseCard,
          nextCard: state.nextCard,
          multiplier: state.effectiveMultiplier || 1,
        },
      });
      saveWallets(wallets);
    }
    state.activeStake = 0;
    state.effectiveMultiplier = 1;
    state.playerBet = 0;
  }
  emitHiloState(playerId);
  const timers = hiloTimers.get(playerId) || {};
  timers.result = setTimeout(() => {
    const current = hiloPlayers.get(playerId);
    if (current && current.status === 'result' && !current.playerWon) startHiloRound(playerId, false);
    else if (current && current.status === 'result' && current.playerWon && current.activeStake > 0) {
      cashoutHiloPlayer(playerId, null, 'auto_cashout');
    }
  }, 8000);
  hiloTimers.set(playerId, timers);
}

function cashoutHiloPlayer(playerId, socket = null, reason = 'player_cashout') {
  const state = hiloPlayers.get(playerId);
  if (!state || state.status !== 'result') return { error: 'Not result phase.' };
  if (!state.playerWon || state.activeStake <= 0) return { error: 'No winnings.' };
  const wallets = loadWallets();
  const wallet = wallets.players[playerId];
  if (!wallet) return { error: 'Player wallet not found.' };
  if (isSuspended(wallets, playerId)) return { error: suspensionMessage(wallets, playerId) };
  const payout = hiloLogic.calculatePayout(state.activeStake, state.effectiveMultiplier);
  const paid = finance.accountToPlayer(wallets, 'prizeVault', playerId, wallet, payout, wallet.name + ' Hi-Lo cashout', 'hilo_cashout', { round: state.roundNumber, multiplier: state.effectiveMultiplier, reason });
  if (paid.error) return paid;
  wallet.totalWon = (wallet.totalWon || 0) + payout;
  wallet.wins = (wallet.wins || 0) + 1;
  const paidMultiplier = state.effectiveMultiplier;
  const receipt = recordGameHistory(wallets, {
    game: 'hilo',
    playerId,
    playerName: wallet.name,
    bet: state.activeStake,
    payout,
    status: 'won',
    details: {
      round: state.roundNumber,
      choice: state.playerChoice,
      baseCard: state.baseCard,
      nextCard: state.nextCard,
      multiplier: paidMultiplier,
      reason,
    },
  });
  state.activeStake = 0;
  state.effectiveMultiplier = 1;
  state.playerBet = 0;
  notifyPlayerWin(wallets, playerId, wallet, 'hilo', payout, { round: receipt.details?.round });
  saveWallets(wallets);
  const target = socket || getHiloSocket(playerId);
  if (target) {
    target.emit('balanceUpdate', publicWallet(playerId, wallet));
    target.emit('hiloCashOutResult', { success: true, payout, multiplier: paidMultiplier, receipt: publicReceipt(receipt, true), auto: reason === 'auto_cashout' });
    target.emit('receiptRecorded', publicReceipt(receipt, true));
    target.emit('notification', { type: 'success', message: 'Cash out: ' + payout + ' ETB @ ' + paidMultiplier + 'x' });
  }
  startHiloRound(playerId, false);
  return { success: true, payout, multiplier: paidMultiplier, receipt };
}


function getDinoRoomList() {
  const list = [];
  dinoRooms.forEach((room, roomId) => {
    list.push({
      roomId,
      entryFee: room.entryFee,
      maxPlayers: room.maxPlayers,
      playerCount: Object.keys(room.players).length,
      status: room.status,
      round: room.round,
      totalPool: room.totalPool,
      createdAt: room.createdAt,
    });
  });
  return list;
}

function dinoRoomBroadcast(roomId, event, data) {
  io.to(`dino-room-${roomId}`).emit(event, data);
}

function recalculateDinoMoney(room) {
  const playerCount = Object.keys(room.players || {}).length;
  return dinoLogic.recalculateRoomMoney(room, playerCount <= 1 ? 1 : WINNER_SHARE);
}

function refundDinoEntry(room, playerId, reason) {
  if (!room?.players?.[playerId]) return null;
  const wallets = loadWallets();
  const wallet = wallets.players[playerId];
  if (!wallet) return null;
  const refunded = finance.accountToPlayer(
    wallets, 'gameEscrow', playerId, wallet, room.entryFee,
    reason || `Dino race refund to ${wallet.name}`,
    'dino_entry_refund', { roomId: room.roomId, round: room.round }
  );
  if (refunded.error) return refunded;
  wallet.totalLost = Math.max(0, (wallet.totalLost || 0) - room.entryFee);
  wallet.gamesPlayed = Math.max(0, (wallet.gamesPlayed || 0) - 1);
  saveWallets(wallets);
  const sock = io.sockets.sockets.get(room.players[playerId].socketId);
  if (sock) sock.emit('balanceUpdate', publicWallet(playerId, wallet));
  return refunded;
}

function cleanupDinoRoom(roomId) {
  const room = dinoRooms.get(roomId);
  if (!room) return;
  // Clear timers
  const timers = dinoRoomTimers.get(roomId);
  if (timers) {
    if (timers.countdown) clearTimeout(timers.countdown);
    if (timers.tick) clearInterval(timers.tick);
    if (timers.cleanup) clearTimeout(timers.cleanup);
    dinoRoomTimers.delete(roomId);
  }
  dinoRooms.delete(roomId);
  io.emit('dinoRoomList', getDinoRoomList());
}

function startDinoRace(roomId) {
  const room = dinoRooms.get(roomId);
  if (!room || room.status !== 'countdown') return;
  if (Object.keys(room.players).length < DINO_MIN_PLAYERS) {
    room.status = 'lobby';
    room.countdownStart = null;
    io.emit('dinoRoomList', getDinoRoomList());
    return;
  }

  room.status = 'racing';
  room.round++;
  room.raceStart = Date.now();
  room.maxDistance = DINO_MAX_DISTANCE;

  // Generate deterministic seed
  const seed = dinoLogic.makeSeed(roomId, room.round);
  room.raceSeed = seed;
  room.obstacles = dinoLogic.generateObstacles(seed, DINO_MAX_DISTANCE);

  // Reset all players to alive
  Object.values(room.players).forEach(p => { p.alive = true; p.distance = 0; p.y = 0; p.vy = 0; p.ducking = false; });

  dinoRoomBroadcast(roomId, 'dinoRaceStart', {
    seed,
    startTime: room.raceStart,
    obstacles: room.obstacles.length,
  });
  io.emit('dinoRoomList', getDinoRoomList());

  // 50ms tick loop (20 ticks/sec)
  const tickInterval = setInterval(() => {
    dinoGameTick(roomId);
  }, 50);

  const timers = dinoRoomTimers.get(roomId) || {};
  timers.tick = tickInterval;
  dinoRoomTimers.set(roomId, timers);
}

function dinoGameTick(roomId) {
  const room = dinoRooms.get(roomId);
  if (!room || room.status !== 'racing') return;

  const elapsed = (Date.now() - room.raceStart) / 1000;

  // Update each alive player's distance based on elapsed time + speed
  const playerStates = [];
  for (const [pid, p] of Object.entries(room.players)) {
    if (!p.alive) continue;

    // Update physics: distance += speed * dt
    const speed = dinoLogic.GAME_SPEED_BASE + elapsed * dinoLogic.GAME_SPEED_INCREASE;
    const dt = 0.05; // 50ms
    p.distance = (p.distance || 0) + speed * dt;

    // Update jump physics
    if (p.y > 0 || p.vy > 0) {
      p.vy = (p.vy || 0) - dinoLogic.GRAVITY * dt;
      p.y = (p.y || 0) + p.vy * dt;
      if (p.y <= 0) { p.y = 0; p.vy = 0; }
    }

    const hit = dinoLogic.checkCollision(p.distance, room.obstacles, p.y || 0, !!p.ducking);
    if (hit) {
      p.alive = false;
      p.finishTime = Date.now();
    }

    playerStates.push({
      playerId: pid,
      name: p.name,
      distance: Math.round(p.distance),
      y: Math.round(p.y),
      ducking: !!p.ducking,
      alive: p.alive,
    });
  }

  const end = dinoLogic.shouldEndGame(room);
  const alivePlayers = Object.values(room.players).filter(p => p.alive);
  if (end) {
    finishDinoRace(roomId, end);
    dinoRoomBroadcast(roomId, 'dinoPlayerStates', playerStates);
    return;
  }
  if (alivePlayers.length > 0 && alivePlayers.every(p => (p.distance || 0) >= DINO_MAX_DISTANCE)) {
    finishDinoRace(roomId, 'finish_line');
    dinoRoomBroadcast(roomId, 'dinoPlayerStates', playerStates);
    return;
  }

  // Broadcast positions
  dinoRoomBroadcast(roomId, 'dinoPlayerStates', playerStates);
}

function finishDinoRace(roomId, reason) {
  const room = dinoRooms.get(roomId);
  if (!room || room.status !== 'racing') return;

  room.status = 'finished';

  // Clear tick timer
  const timers = dinoRoomTimers.get(roomId);
  if (timers && timers.tick) clearInterval(timers.tick);

  // Mark all still-alive players as finished
  Object.values(room.players).forEach(p => {
    if (p.alive) { p.alive = false; p.finishTime = Date.now(); }
  });

  // Compute rankings and payouts
  recalculateDinoMoney(room);
  const rankings = dinoLogic.computeRankings(room);
  const payouts = dinoLogic.calculatePayouts(room);

  // Process house rake and payouts from escrow
  const wallets = loadWallets();
  if (room.houseRake > 0) {
    const house = finance.accountTransfer(
      wallets, 'gameEscrow', 'commission', room.houseRake,
      `Dino race commission (${room.entryFee} ETB room)`,
      'commission', { game: 'dino', roomId, round: room.round }
    );
    if (!house.error) wallets.company.totalCommission += room.houseRake;
    else console.error('Dino commission error:', house.error);
  }
  const processedPayouts = [];
  for (const payout of payouts) {
    if (payout.prize <= 0) continue;
    const wallet = (wallets.players || {})[payout.playerId];
    if (!wallet) continue;
    const result = finance.accountToPlayer(
      wallets, 'gameEscrow', payout.playerId, wallet, payout.prize,
      `Dino race win — place #${payout.place} (${payout.distance.toFixed(0)}m)`,
      'dino_payout', { roomId, round: room.round }
    );
    if (result.success) {
      processedPayouts.push({ ...payout, prize: payout.prize });
      wallet.totalWon = (wallet.totalWon || 0) + payout.prize;
      wallet.wins = (wallet.wins || 0) + 1;
      notifyPlayerWin(wallets, payout.playerId, wallet, 'dino', payout.prize, { round: room.round });
      // Notify individual player
      const playerSocket = io.sockets.sockets.get(room.players[payout.playerId]?.socketId);
      if (playerSocket) {
        playerSocket.emit('balanceUpdate', publicWallet(payout.playerId, wallet));
      }
    }
  }
  const roundId = makeReceiptId('dino_round');
  const payoutByPlayer = new Map(processedPayouts.map(p => [p.playerId, p]));
  for (const ranking of rankings) {
    const result = payoutByPlayer.get(ranking.playerId);
    const receipt = recordGameHistory(wallets, {
      id: makeReceiptId('dino'),
      game: 'dino',
      playerId: ranking.playerId,
      playerName: ranking.name,
      bet: room.entryFee,
      payout: result ? result.prize : 0,
      status: result ? 'won' : 'lost',
      details: {
        roundId,
        roomId,
        round: room.round,
        place: ranking.place || rankings.findIndex(r => r.playerId === ranking.playerId) + 1,
        distance: Math.round(ranking.distance || 0),
        prizePool: room.prizePool,
        commission: room.houseRake,
        totalPool: room.totalPool,
        reason,
      },
    });
    const sock = io.sockets.sockets.get(room.players[ranking.playerId]?.socketId);
    if (sock) sock.emit('receiptRecorded', publicReceipt(receipt, true));
  }
  saveWallets(wallets);

  // Broadcast results
  dinoRoomBroadcast(roomId, 'dinoRaceFinished', {
    reason,
    rankings,
    payouts: processedPayouts,
    seed: room.raceSeed,
  });
  io.emit('dinoRoomList', getDinoRoomList());

  // Auto-cleanup room after 60s display period
  const cleanupTimer = setTimeout(() => {
    cleanupDinoRoom(roomId);
  }, 60000);

  const t = dinoRoomTimers.get(roomId) || {};
  t.cleanup = cleanupTimer;
  dinoRoomTimers.set(roomId, t);
}

// --- GEBRE'S STAIRCASE RUN / CRASH STATE ---
const CRASH_BETS = [20, 50, 100, 200];
const CRASH_COUNTDOWN = 10;
const CRASH_TICK_MS = 100;
const CRASH_RESULT_DISPLAY = 6;
const CRASH_MAX_MULTIPLIER = 500;
const CRASH_STATIC_MAX_ROUND_PAYOUT_ETB = 500000;
const CRASH_MAX_PAYOUT_VAULT_SHARE = 0.25;
const crashState = {
  status: 'waiting', // waiting | running | crashed
  roundNumber: 0,
  countdownRemaining: CRASH_COUNTDOWN,
  bets: {},
  cashedOut: [],
  lastResults: [],
  serverSeed: '',
  serverSeedHash: '',
  committedRoundNumber: 1,
  hash: '',
  crashMultiplier: 1,
  instantCrash: false,
  startedAt: 0,
  currentMultiplier: 1,
  crashVaultBalance: 0,
  maxRoundPayout: 0,
  countdownTimer: null,
  tickTimer: null,
  resultTimer: null,
};

function crashPublicBets() {
  return Object.values(crashState.bets).map(bet => ({
    playerId: bet.playerId,
    playerName: bet.playerName,
    amount: bet.amount,
    cashedOut: !!bet.cashedOut,
    cashoutMultiplier: bet.cashoutMultiplier || null,
    payout: bet.payout || 0,
  }));
}

function activeCrashStake() {
  return Object.values(crashState.bets)
    .filter(bet => !bet.cashedOut)
    .reduce((sum, bet) => sum + bet.amount, 0);
}

function getCrashVault(wallets = loadWallets()) {
  return finance.money(finance.ensureFinance(wallets).crashVault);
}

function getCrashMaxRoundPayout(wallets = loadWallets()) {
  const vault = getCrashVault(wallets);
  const activeStake = activeCrashStake();
  const vaultShareCap = Math.floor(vault * CRASH_MAX_PAYOUT_VAULT_SHARE);
  const riskCap = Math.max(activeStake, vaultShareCap);
  return Math.max(0, Math.min(CRASH_STATIC_MAX_ROUND_PAYOUT_ETB, vault, riskCap));
}

function updateCrashRiskSnapshot(wallets = loadWallets()) {
  crashState.crashVaultBalance = getCrashVault(wallets);
  crashState.maxRoundPayout = getCrashMaxRoundPayout(wallets);
}

function getCrashState() {
  return {
    status: crashState.status,
    roundNumber: crashState.roundNumber,
    countdownRemaining: crashState.countdownRemaining,
    countdownTotal: CRASH_COUNTDOWN,
    currentMultiplier: crashState.currentMultiplier,
    crashMultiplier: crashState.status === 'crashed' ? crashState.crashMultiplier : null,
    instantCrash: crashState.status === 'crashed' ? crashState.instantCrash : false,
    serverSeedHash: crashState.serverSeedHash,
    serverSeed: crashState.status === 'crashed' ? crashState.serverSeed : '',
    hash: crashState.status === 'crashed' ? crashState.hash : '',
    maxMultiplier: CRASH_MAX_MULTIPLIER,
    maxRoundPayout: crashState.maxRoundPayout,
    crashVault: crashState.crashVaultBalance,
    maxPayoutVaultShare: CRASH_MAX_PAYOUT_VAULT_SHARE,
    totalBets: Object.values(crashState.bets).reduce((sum, b) => sum + b.amount, 0),
    activeBets: Object.values(crashState.bets).filter(b => !b.cashedOut).length,
    bets: crashPublicBets(),
    cashouts: crashState.cashedOut.slice(0, 20),
    lastResults: crashState.lastResults.slice(0, 10),
  };
}

function broadcastCrashState() {
  io.to('crash-room').emit('crashState', getCrashState());
  io.emit('crashRoomCounts', {
    status: crashState.status,
    roundNumber: crashState.roundNumber,
    totalBets: Object.values(crashState.bets).reduce((sum, b) => sum + b.amount, 0),
    activeBets: Object.values(crashState.bets).filter(b => !b.cashedOut).length,
  });
}

function resetCrashRound() {
  clearInterval(crashState.countdownTimer);
  clearInterval(crashState.tickTimer);
  clearTimeout(crashState.resultTimer);
  crashState.status = 'waiting';
  crashState.countdownRemaining = CRASH_COUNTDOWN;
  crashState.bets = {};
  crashState.cashedOut = [];
  crashState.serverSeed = '';
  crashState.serverSeedHash = '';
  crashState.committedRoundNumber = crashState.roundNumber + 1;
  crashState.hash = '';
  crashState.crashMultiplier = 1;
  crashState.instantCrash = false;
  crashState.startedAt = 0;
  crashState.currentMultiplier = 1;
  updateCrashRiskSnapshot();
  crashState.countdownTimer = null;
  crashState.tickTimer = null;
  crashState.resultTimer = null;
  prepareCrashCommit();
}

function prepareCrashCommit() {
  const nextRound = crashState.roundNumber + 1;
  if (crashState.serverSeed && crashState.committedRoundNumber === nextRound) return;
  crashState.serverSeed = crashLogic.randomServerSeed();
  crashState.serverSeedHash = crashLogic.sha256Hex(crashState.serverSeed);
  crashState.committedRoundNumber = nextRound;
}

function startCrashCountdown() {
  if (crashState.status !== 'waiting' || crashState.countdownTimer) return;
  prepareCrashCommit();
  crashState.countdownRemaining = CRASH_COUNTDOWN;
  broadcastCrashState();
  crashState.countdownTimer = setInterval(() => {
    crashState.countdownRemaining -= 1;
    broadcastCrashState();
    if (crashState.countdownRemaining <= 0) startCrashRun();
  }, 1000);
}

function startCrashRun() {
  clearInterval(crashState.countdownTimer);
  crashState.countdownTimer = null;
  crashState.status = 'running';
  prepareCrashCommit();
  crashState.roundNumber += 1;
  const point = crashLogic.calculateCrashPoint(crashState.serverSeed, crashState.roundNumber);
  crashState.serverSeedHash = point.serverSeedHash;
  crashState.hash = point.hash;
  crashState.crashMultiplier = Math.min(point.crashMultiplier, 1000000);
  crashState.instantCrash = point.instantCrash;
  crashState.currentMultiplier = 1;
  crashState.startedAt = Date.now();
  broadcastCrashState();
  if (crashState.instantCrash || crashState.crashMultiplier <= 1) {
    setTimeout(() => crashRound('instant_crash', 1), 250);
    return;
  }
  crashState.tickTimer = setInterval(tickCrashRun, CRASH_TICK_MS);
}

function activeCrashPayoutAt(multiplier) {
  return Object.values(crashState.bets)
    .filter(bet => !bet.cashedOut)
    .reduce((sum, bet) => sum + Math.floor(bet.amount * multiplier), 0);
}

function tickCrashRun() {
  if (crashState.status !== 'running') return;
  const multiplier = crashLogic.multiplierAt(Date.now() - crashState.startedAt);
  crashState.currentMultiplier = multiplier;
  if (multiplier >= crashState.crashMultiplier) {
    crashRound('crash', crashState.crashMultiplier);
    return;
  }
  if (multiplier >= CRASH_MAX_MULTIPLIER) {
    forceCashoutAllCrash('max_multiplier', CRASH_MAX_MULTIPLIER);
    return;
  }
  const maxRoundPayout = crashState.maxRoundPayout;
  const projected = activeCrashPayoutAt(multiplier);
  if (maxRoundPayout > 0 && projected >= maxRoundPayout) {
    const activeStake = activeCrashStake();
    const capMultiplier = activeStake > 0 ? Math.max(1, Math.floor((maxRoundPayout / activeStake) * 100) / 100) : multiplier;
    forceCashoutAllCrash('max_round_payout', Math.min(multiplier, capMultiplier));
    return;
  }
  broadcastCrashState();
}

function cashoutCrashBet(playerId, multiplier, reason = 'cashout') {
  const bet = crashState.bets[playerId];
  if (!bet || bet.cashedOut) return { error: 'No active crash bet.' };
  const cleanMultiplier = Math.max(1, Math.floor(Number(multiplier) * 100) / 100);
  const payoutAmount = Math.floor(bet.amount * cleanMultiplier);
  const wallets = loadWallets();
  const wallet = wallets.players[playerId];
  if (!wallet) return { error: 'Player wallet not found.' };
  const payout = finance.accountToPlayer(wallets, 'crashVault', playerId, wallet, payoutAmount, `Crash payout to ${bet.playerName}`, 'crash_payout', { round: crashState.roundNumber, multiplier: cleanMultiplier, reason });
  if (payout.error) return payout;
  wallet.totalWon = (wallet.totalWon || 0) + payoutAmount;
  wallet.wins = (wallet.wins || 0) + 1;
  bet.cashedOut = true;
  bet.cashoutMultiplier = cleanMultiplier;
  bet.payout = payoutAmount;
  bet.reason = reason;
  const receipt = recordGameHistory(wallets, {
    game: 'crash',
    playerId,
    playerName: bet.playerName,
    bet: bet.amount,
    payout: payoutAmount,
    status: 'won',
    details: {
      round: crashState.roundNumber,
      cashoutMultiplier: cleanMultiplier,
      crashMultiplier: crashState.crashMultiplier,
      reason,
      serverSeedHash: crashState.serverSeedHash,
      hash: crashState.hash,
    },
  });
  updateCrashRiskSnapshot(wallets);
  notifyPlayerWin(wallets, playerId, wallet, 'crash', payoutAmount, { round: crashState.roundNumber });
  saveWallets(wallets);
  const event = { playerId, playerName: bet.playerName, amount: bet.amount, multiplier: cleanMultiplier, payout: payoutAmount, reason };
  crashState.cashedOut.unshift(event);
  if (crashState.cashedOut.length > 20) crashState.cashedOut.length = 20;
  const sock = io.sockets.sockets.get(bet.socketId);
  if (sock) {
    sock.emit('crashCashoutResult', { success: true, ...event, account: publicWallet(playerId, wallet), receipt: publicReceipt(receipt, true) });
    sock.emit('receiptRecorded', publicReceipt(receipt, true));
  }
  io.to('crash-room').emit('crashCashout', event);
  io.emit('balanceUpdate', publicWallet(playerId, wallet));
  return { success: true, payout: payoutAmount };
}

function forceCashoutAllCrash(reason, multiplier) {
  if (crashState.status !== 'running') return;
  for (const bet of Object.values(crashState.bets)) {
    if (!bet.cashedOut) cashoutCrashBet(bet.playerId, multiplier, reason);
  }
  crashRound(reason, multiplier);
}

function crashRound(reason = 'crash', finalMultiplier = crashState.currentMultiplier) {
  if (crashState.status === 'crashed') return;
  clearInterval(crashState.tickTimer);
  crashState.tickTimer = null;
  crashState.status = 'crashed';
  crashState.currentMultiplier = Math.max(1, Math.floor(Number(finalMultiplier) * 100) / 100);
  const wallets = loadWallets();
  for (const bet of Object.values(crashState.bets)) {
    if (bet.cashedOut) continue;
    recordGameHistory(wallets, {
      game: 'crash',
      playerId: bet.playerId,
      playerName: bet.playerName,
      bet: bet.amount,
      payout: 0,
      status: 'lost',
      details: {
        round: crashState.roundNumber,
        crashMultiplier: crashState.currentMultiplier,
        reason,
        instantCrash: crashState.instantCrash,
        serverSeed: crashState.serverSeed,
        serverSeedHash: crashState.serverSeedHash,
        hash: crashState.hash,
      },
    });
  }
  saveWallets(wallets);
  crashState.lastResults.unshift({
    round: crashState.roundNumber,
    multiplier: crashState.currentMultiplier,
    reason,
    totalBets: Object.values(crashState.bets).reduce((sum, b) => sum + b.amount, 0),
    cashouts: crashState.cashedOut.length,
  });
  if (crashState.lastResults.length > 10) crashState.lastResults.length = 10;
  io.to('crash-room').emit('crashCrashed', getCrashState());
  broadcastCrashState();
  crashState.resultTimer = setTimeout(() => {
    resetCrashRound();
    broadcastCrashState();
    startCrashCountdown();
  }, CRASH_RESULT_DISPLAY * 1000);
}

function resetRouletteRound() {
  clearInterval(rouletteState.countdownTimer);
  clearTimeout(rouletteState.resultTimer);
  rouletteState.status = 'betting';
  rouletteState.bets = {};
  rouletteState.nextBetId = 1;
  rouletteState.winningNumber = null;
  rouletteState.winningColor = null;
  rouletteState.serverSeed = '';
  rouletteState.serverSeedHash = '';
  rouletteState.proof = null;
  rouletteState.playerResults = {};
  rouletteState.committedRoundNumber = rouletteState.roundNumber + 1;
  rouletteState.countdownRemaining = getRouletteSettings().countdownSeconds;
  rouletteState.countdownTimer = null;
  rouletteState.resultTimer = null;
  prepareRouletteCommit();
}

function prepareRouletteCommit() {
  const nextRound = rouletteState.roundNumber + 1;
  if (rouletteState.serverSeed && rouletteState.committedRoundNumber === nextRound) return;
  rouletteState.serverSeed = fairRng.randomServerSeed();
  rouletteState.serverSeedHash = fairRng.sha256Hex(rouletteState.serverSeed);
  rouletteState.committedRoundNumber = nextRound;
}

function getRouletteState() {
  const settings = getRouletteSettings();
  const totalBets = Object.values(rouletteState.bets).reduce((sum, b) => sum + b.amount, 0);
  const playerIds = new Set(Object.values(rouletteState.bets).map(b => b.playerId));
  return {
    status: rouletteState.status,
    roundNumber: rouletteState.roundNumber,
    countdownRemaining: rouletteState.countdownRemaining,
    countdownTotal: settings.countdownSeconds,
    winningNumber: rouletteState.winningNumber,
    winningColor: rouletteState.winningColor,
    serverSeedHash: rouletteState.serverSeedHash,
    serverSeed: rouletteState.status === 'result' ? rouletteState.serverSeed : '',
    proof: rouletteState.status === 'result' ? rouletteState.proof : null,
    totalBets,
    betCount: Object.keys(rouletteState.bets).length,
    playerCount: playerIds.size,
    lastResults: rouletteState.lastResults.slice(0, 10),
  };
}

function projectedRouletteMaxPayout(extraBet = null, settings = getRouletteSettings()) {
  const projectedBets = { ...rouletteState.bets };
  if (extraBet) projectedBets.__new = extraBet;
  let maxPayout = 0;
  for (let n = 0; n <= 36; n++) {
    // Use raw (uncapped) payouts for vault sufficiency check — the caps handle actual payout
    const result = rouletteLogic.calculatePayouts(projectedBets, n);
    maxPayout = Math.max(maxPayout, result.totalPayout);
  }
  // Cap at round maximum
  return Math.min(maxPayout, settings.maxRoundPayout);
}

function broadcastRouletteState() {
  io.to('roulette-room').emit('rouletteState', getRouletteState());
  // Also broadcast counts for lobby
  io.emit('rouletteRoomCounts', {
    players: new Set(Object.values(rouletteState.bets).map(b => b.playerId)).size,
    status: rouletteState.status,
    roundNumber: rouletteState.roundNumber,
    totalBets: Object.values(rouletteState.bets).reduce((sum, b) => sum + b.amount, 0),
  });
  broadcastCounts();
}

function emitPersonalRouletteResult(socket, playerId) {
  if (!playerId) return false;
  const playerResult = rouletteState.playerResults?.[playerId];
  if (!playerResult) return false;
  if (playerResult.expiresAt && Date.now() > playerResult.expiresAt) {
    delete rouletteState.playerResults[playerId];
    return false;
  }
  if (rouletteState.status !== 'result' && !playerResult.manual) return false;
  const wallets = loadWallets();
  const wallet = wallets.players[playerId];
  socket.emit('rouletteResult', {
    roundNumber: playerResult.roundNumber || rouletteState.roundNumber,
    winningNumber: playerResult.winningNumber ?? rouletteState.winningNumber,
    winningColor: playerResult.winningColor || rouletteState.winningColor,
    proof: playerResult.proof || rouletteState.proof,
    serverSeedHash: playerResult.proof?.serverSeedHash || rouletteState.proof?.serverSeedHash || '',
    playerResult,
    account: wallet ? publicWallet(playerId, wallet) : null,
    replay: true,
  });
  return true;
}

function relinkRouletteBetsToSocket(playerId, socketId) {
  if (!playerId) return 0;
  let count = 0;
  for (const bet of Object.values(rouletteState.bets)) {
    if (bet.playerId === playerId) {
      bet.socketId = socketId;
      count++;
    }
  }
  return count;
}

function spinRouletteWheel() {
  if (rouletteState.status !== 'betting' && rouletteState.status !== 'spinning') return;
  clearInterval(rouletteState.countdownTimer);
  rouletteState.countdownTimer = null;
  rouletteState.status = 'spinning';
  prepareRouletteCommit();
  rouletteState.roundNumber++;
  const result = rouletteLogic.spinWheel(rouletteState.serverSeed, rouletteState.roundNumber);
  rouletteState.winningNumber = result.number;
  rouletteState.winningColor = result.color;
  rouletteState.proof = result.proof;
  broadcastRouletteState();

  // Process results after the client-side spin + slow landing animation.
  setTimeout(() => processRouletteResults(), ROULETTE_RESULT_PROCESS_DELAY_MS);
}

function processRouletteResults() {
  rouletteState.status = 'result';
  const settings = getRouletteSettings();
  const { totalPayout, results: betResults, roundCapped, playerCaps, totalCommission } = rouletteLogic.calculateCappedPayouts(
    rouletteState.bets,
    rouletteState.winningNumber,
    settings
  );

  // Log cap events for audit
  if (roundCapped) {
    console.warn(`⚠️ Roulette round #${rouletteState.roundNumber} AGGREGATE CAP triggered: all payouts scaled to 500,000 ETB`);
  }
  for (const cap of playerCaps) {
    console.warn(`⚠️ Roulette round #${rouletteState.roundNumber} PLAYER CAP for ${cap.playerId}: raw ${cap.rawTotal} → capped ${cap.cappedTotal} ETB`);
  }

  const wallets = loadWallets();
  const rouletteVault = gamePrizeVault('roulette');
  const rouletteHouseVault = gameHouseWinVault('roulette');
  const totalBets = Object.values(rouletteState.bets).reduce((sum, b) => sum + b.amount, 0);
  const commission = totalCommission;
  const playerPayouts = {}; // { playerId: { playerName, totalBet, totalPayout, bets: [] } }
  for (const bet of Object.values(rouletteState.bets)) {
    if (!playerPayouts[bet.playerId]) {
      playerPayouts[bet.playerId] = { playerName: bet.playerName, totalBet: 0, totalPayout: 0, bets: [] };
    }
    playerPayouts[bet.playerId].totalBet += bet.amount;
  }

  // Pay out winners
  for (const br of betResults) {
    if (!br.won || br.payout <= 0) continue;
    const bet = rouletteState.bets[br.betId];
    if (!bet) continue;
    const wallet = wallets.players[bet.playerId];
    if (!wallet) continue;

    const payout = finance.accountToPlayer(
      wallets, rouletteVault, bet.playerId, wallet, br.payout,
      `Roulette payout to ${bet.playerName}`,
      'roulette_payout', { round: rouletteState.roundNumber, type: bet.type, number: rouletteState.winningNumber, vault: rouletteVault }
    );
    if (payout.error) {
      console.error('Roulette payout error:', payout.error);
      const refunded = finance.accountToPlayer(
        wallets, 'gameEscrow', bet.playerId, wallet, bet.amount,
        `Roulette stake refunded after payout failure for ${bet.playerName}`,
        'roulette_stake_refund', { round: rouletteState.roundNumber, betId: br.betId, reason: payout.error }
      );
      if (!refunded.error) bet.stakeSettled = true;
      br.won = false;
      br.payout = 0;
      continue;
    }
    const promoReclaim = reclaimSignupPromoAfterWin(wallets, bet.playerId, wallet, br.payout, 'roulette', { round: rouletteState.roundNumber, type: bet.type, number: rouletteState.winningNumber });
    br.promoReclaim = finance.money(promoReclaim.reclaimed || 0);
    playerPayouts[bet.playerId].totalPayout += br.payout;
    wallet.totalWon = (wallet.totalWon || 0) + br.payout;
    wallet.wins = (wallet.wins || 0) + 1;

    // Record game history
    recordGameHistory(wallets, {
      game: 'roulette',
      playerId: bet.playerId,
      playerName: bet.playerName,
      bet: bet.amount,
      payout: br.payout,
      status: 'won',
      details: {
        round: rouletteState.roundNumber,
        winningNumber: rouletteState.winningNumber,
        winningColor: rouletteState.winningColor,
        proof: rouletteState.proof,
        type: bet.type,
        numbers: bet.numbers,
        promoReclaim: finance.money(br.promoReclaim || 0),
      },
    });
  }

  // Record losses
  for (const br of betResults) {
    if (br.won) continue;
    const bet = rouletteState.bets[br.betId];
    if (!bet) continue;
    recordGameHistory(wallets, {
      game: 'roulette',
      playerId: bet.playerId,
      playerName: bet.playerName,
      bet: bet.amount,
      payout: 0,
      status: 'lost',
      details: {
        round: rouletteState.roundNumber,
        winningNumber: rouletteState.winningNumber,
        winningColor: rouletteState.winningColor,
        proof: rouletteState.proof,
        type: bet.type,
        numbers: bet.numbers,
      },
    });
  }

  let stakeRevenue = 0;
  for (const bet of Object.values(rouletteState.bets)) {
    if (bet.stakeSettled) continue;
    const moved = finance.accountTransfer(
      wallets, 'gameEscrow', rouletteHouseVault, bet.amount,
      `Roulette house win from ${bet.playerName}`,
      'roulette_house_win', { game: 'roulette', round: rouletteState.roundNumber, type: bet.type, vault: rouletteHouseVault }
    );
    if (moved.error) console.error('Roulette house win transfer error:', moved.error);
    else {
      bet.stakeSettled = true;
      stakeRevenue += bet.amount;
    }
  }

  if (commission > 0) {
    const movedCommission = finance.accountTransfer(wallets, rouletteVault, rouletteHouseVault, commission, `Roulette commission round #${rouletteState.roundNumber}`, 'roulette_commission', { game: 'roulette', round: rouletteState.roundNumber, vault: rouletteHouseVault });
    if (movedCommission.error) console.error('Roulette commission transfer error:', movedCommission.error);
  }
  wallets.company.totalCommission += stakeRevenue + commission;

  rouletteState.lastResults.unshift({
    number: rouletteState.winningNumber,
    color: rouletteState.winningColor,
    totalBets,
    totalPayouts: totalPayout,
    playerCount: Object.keys(playerPayouts).length,
    proof: rouletteState.proof,
  });
  if (rouletteState.lastResults.length > 10) rouletteState.lastResults.length = 10;

  clearActiveGameStakesForRound(wallets, 'roulette', rouletteState.roundNumber);
  saveWallets(wallets);

  // Build player-specific results
  const playerResults = {};
  for (const [pid, pp] of Object.entries(playerPayouts)) {
    const wallet = wallets.players[pid];
    playerResults[pid] = {
      totalBet: pp.totalBet,
      totalPayout: pp.totalPayout,
      netResult: pp.totalPayout - pp.totalBet,
      balance: wallet ? wallet.balance : 0,
    };
    const netWin = playerResults[pid].netResult;
    if (wallet && netWin > 0) {
      notifyPlayerWin(wallets, pid, wallet, 'roulette', netWin, { round: rouletteState.roundNumber, returnedAmount: pp.totalPayout });
    }
  }
  rouletteState.playerResults = playerResults;

  // Emit individual results to players
  const emittedRouletteResults = new Set();
  for (const [betId, bet] of Object.entries(rouletteState.bets)) {
    if (emittedRouletteResults.has(bet.playerId)) continue;
    emittedRouletteResults.add(bet.playerId);
    const sock = io.sockets.sockets.get(bet.socketId);
    if (sock && playerResults[bet.playerId]) {
      sock.emit('rouletteResult', {
        roundNumber: rouletteState.roundNumber,
        winningNumber: rouletteState.winningNumber,
        winningColor: rouletteState.winningColor,
        playerResult: playerResults[bet.playerId],
        account: publicWallet(bet.playerId, wallets.players[bet.playerId]),
      });
      sock.emit('receiptRecorded', {});
    }
  }

  // Notify admins
  emitAdminDataToAll();

  broadcastRouletteState();
  broadcastCounts();

  // Reset for next round
  rouletteState.resultTimer = setTimeout(() => {
    resetRouletteRound();
    broadcastRouletteState();
    // Auto-restart countdown
    startRouletteCountdown();
  }, settings.resultDisplaySeconds * 1000);
}

function applyPendingRouletteIfIdle(wallets) {
  if (Object.keys(rouletteState.bets || {}).length > 0 || rouletteSpinningPlayers.size > 0) return false;
  const changed = activatePendingGameSettings(wallets, 'roulette', 'roulette_idle_apply');
  if (changed) saveWallets(wallets);
  return changed;
}

function processPlayerRouletteSpin(playerId, socketId, forcedSpin = null) {
  const entries = Object.entries(rouletteState.bets).filter(([, bet]) => bet.playerId === playerId);
  const targetSocket = io.sockets.sockets.get(socketId);
  if (!entries.length) {
    rouletteSpinningPlayers.delete(playerId);
    if (targetSocket) targetSocket.emit('rouletteSpinResult', { success: false, message: 'Place a bet first.' });
    return;
  }

  const playerBets = Object.fromEntries(entries);
  const wallets = loadWallets();
  const settings = activeGameSettings(wallets, 'roulette');
  const rouletteVault = gamePrizeVault('roulette');
  const rouletteHouseVault = gameHouseWinVault('roulette');
  const roundNumber = forcedSpin?.roundNumber || ++rouletteState.roundNumber;
  if (forcedSpin?.roundNumber && rouletteState.roundNumber < forcedSpin.roundNumber) rouletteState.roundNumber = forcedSpin.roundNumber;
  const result = forcedSpin?.result || rouletteLogic.spinWheel(fairRng.randomServerSeed(), roundNumber);
  const winningNumber = result.number;
  const winningColor = result.color;
  const proof = result.proof;
  const { totalPayout, results: betResults, roundCapped, playerCaps, totalCommission } = rouletteLogic.calculateCappedPayouts(
    playerBets,
    winningNumber,
    settings
  );

  if (roundCapped) {
    console.warn(`Roulette spin #${roundNumber} aggregate cap triggered for ${playerId}.`);
  }
  for (const cap of playerCaps) {
    console.warn(`Roulette spin #${roundNumber} player cap for ${cap.playerId}: raw ${cap.rawTotal} -> capped ${cap.cappedTotal} ETB`);
  }

  const playerPayout = { totalBet: 0, totalPayout: 0, bets: [] };
  for (const [, bet] of entries) playerPayout.totalBet += bet.amount;
  const realTotalCommission = betResults.reduce((sum, br) => {
    const bet = playerBets[br.betId];
    return sum + (!bet?.freePlay ? finance.money(br.commission || 0) : 0);
  }, 0);

  for (const br of betResults) {
    const bet = playerBets[br.betId];
    if (!bet) continue;
    const wallet = wallets.players[bet.playerId];
    if (!wallet) continue;

    if (bet.freePlay) {
      if (br.won && br.payout > 0) playerPayout.totalPayout += br.payout;
      continue;
    }

    if (br.won && br.payout > 0) {
      const payout = finance.accountToPlayer(
        wallets, rouletteVault, bet.playerId, wallet, br.payout,
        `Roulette payout to ${bet.playerName}`,
        'roulette_payout', { round: roundNumber, type: bet.type, number: winningNumber, vault: rouletteVault }
      );
      if (payout.error) {
        console.error('Roulette payout error:', payout.error);
        const refunded = finance.accountToPlayer(
          wallets, 'gameEscrow', bet.playerId, wallet, bet.amount,
          `Roulette stake refunded after payout failure for ${bet.playerName}`,
          'roulette_stake_refund', { round: roundNumber, betId: br.betId, reason: payout.error }
        );
        if (!refunded.error) bet.stakeSettled = true;
        br.won = false;
        br.payout = 0;
      } else {
        const promoReclaim = reclaimSignupPromoAfterWin(wallets, bet.playerId, wallet, br.payout, 'roulette', { round: roundNumber, type: bet.type, number: winningNumber });
        br.promoReclaim = finance.money(promoReclaim.reclaimed || 0);
        playerPayout.totalPayout += br.payout;
        wallet.totalWon = (wallet.totalWon || 0) + br.payout;
        wallet.wins = (wallet.wins || 0) + 1;
      }
    }

    recordGameHistory(wallets, {
      game: 'roulette',
      playerId: bet.playerId,
      playerName: bet.playerName,
      bet: bet.amount,
      payout: br.won ? br.payout : 0,
      status: br.won && br.payout > 0 ? 'won' : 'lost',
      details: {
        round: roundNumber,
        winningNumber,
        winningColor,
        proof,
        type: bet.type,
        numbers: bet.numbers,
        promoReclaim: finance.money(br.promoReclaim || 0),
      },
    });
  }

  let stakeRevenue = 0;
  for (const [, bet] of entries) {
    if (bet.freePlay) continue;
    if (bet.stakeSettled) continue;
    const moved = finance.accountTransfer(
      wallets, 'gameEscrow', rouletteHouseVault, bet.amount,
      `Roulette house win from ${bet.playerName}`,
      'roulette_house_win', { game: 'roulette', round: roundNumber, type: bet.type, vault: rouletteHouseVault }
    );
    if (moved.error) console.error('Roulette house win transfer error:', moved.error);
    else {
      bet.stakeSettled = true;
      stakeRevenue += bet.amount;
    }
  }

  const hasRealBets = entries.some(([, bet]) => !bet.freePlay);
  if (hasRealBets && realTotalCommission > 0) {
    const movedCommission = finance.accountTransfer(wallets, rouletteVault, rouletteHouseVault, realTotalCommission, `Roulette commission spin #${roundNumber}`, 'roulette_commission', { game: 'roulette', round: roundNumber, vault: rouletteHouseVault });
    if (movedCommission.error) console.error('Roulette commission transfer error:', movedCommission.error);
  }
  wallets.company.totalCommission += stakeRevenue + realTotalCommission;

  for (const [betId, bet] of entries) {
    if (!bet.freePlay) clearActiveGameStake(wallets, bet.activeStakeKey || activeStakeId('roulette', roundNumber, bet.playerId, betId));
    delete rouletteState.bets[betId];
  }

  const wallet = wallets.players[playerId];
  const playerResult = {
    totalBet: playerPayout.totalBet,
    totalPayout: playerPayout.totalPayout,
    netResult: playerPayout.totalPayout - playerPayout.totalBet,
    balance: wallet ? wallet.balance : 0,
    manual: true,
    freePlay: entries.every(([, bet]) => !!bet.freePlay),
    roundNumber,
    winningNumber,
    winningColor,
    proof,
    expiresAt: Date.now() + 2 * 60 * 1000,
  };
  if (playerResult.freePlay) {
    const firstFreeBet = entries.find(([, bet]) => bet.freePlay)?.[1];
    recordAuditEvent(wallets, {
      category: 'admin',
      type: 'admin_free_play_round',
      status: 'completed',
      actorType: 'admin',
      actorId: firstFreeBet?.freePlayAdminId || '',
      actorName: adminDisplayName(wallets, firstFreeBet?.freePlayAdminId || ''),
      targetType: 'player',
      targetId: playerId,
      targetName: wallet?.name || playerId,
      amount: playerPayout.totalBet,
      game: 'roulette',
      details: { roundNumber, winningNumber, winningColor, totalPayout: playerPayout.totalPayout, netResult: playerResult.netResult },
    });
  }
  rouletteState.playerResults[playerId] = playerResult;

  rouletteState.winningNumber = winningNumber;
  rouletteState.winningColor = winningColor;
  rouletteState.proof = proof;
  rouletteState.lastResults.unshift({
    number: winningNumber,
    color: winningColor,
    totalBets: playerPayout.totalBet,
    totalPayouts: totalPayout,
    playerCount: 1,
    proof,
  });
  if (rouletteState.lastResults.length > 10) rouletteState.lastResults.length = 10;

  if (wallet && !playerResult.freePlay && playerResult.netResult > 0) {
    notifyPlayerWin(wallets, playerId, wallet, 'roulette', playerResult.netResult, { round: roundNumber, returnedAmount: playerPayout.totalPayout });
  }

  saveWallets(wallets);
  rouletteSpinningPlayers.delete(playerId);
  applyPendingRouletteIfIdle(wallets);

  const sock = io.sockets.sockets.get(socketId);
  if (sock) {
    sock.emit('rouletteResult', {
      roundNumber,
      winningNumber,
      winningColor,
      proof,
      serverSeedHash: proof.serverSeedHash,
      playerResult,
      account: wallet ? publicWallet(playerId, wallet) : null,
    });
    sock.emit('myRouletteBets', { bets: [] });
    sock.emit('receiptRecorded', {});
  }
  if (wallet) io.emit('balanceUpdate', publicWallet(playerId, wallet));
  emitAdminDataToAll();
  broadcastRouletteState();
  broadcastCounts();
}

function startRouletteCountdown() {
  if (rouletteState.status !== 'betting') return;
  const wallets = loadWallets();
  const rouletteSettingsChanged = activatePendingGameSettings(wallets, 'roulette', 'roulette_round_start');
  const settings = activeGameSettings(wallets, 'roulette');
  if (rouletteSettingsChanged) saveWallets(wallets);
  clearInterval(rouletteState.countdownTimer);
  rouletteState.countdownTimer = null;
  prepareRouletteCommit();
  rouletteState.countdownRemaining = 0;
  broadcastRouletteState();
}

// ──────────────────────────────────────
// HELPERS
// ──────────────────────────────────────
function getRoom(socketId) { const bet = socketRoom.get(socketId); return bet ? gameRooms[bet] : null; }

function clearBingoDisconnectTimer(player) {
  if (player?.disconnectTimer) clearTimeout(player.disconnectTimer);
  if (player) player.disconnectTimer = null;
}

function bingoConnectedPlayers(room) {
  return (room?.players || []).filter(player => player.connected !== false);
}

function removeBingoPlayerFromRoom(room, player) {
  if (!room || !player) return;
  clearBingoDisconnectTimer(player);
  if (player.cartelaId && room.takenCartelas.has(player.cartelaId)) room.takenCartelas.delete(player.cartelaId);
  if (player.socketId) socketRoom.delete(player.socketId);
  room.players = room.players.filter(pl => pl !== player && pl.playerId !== player.playerId);
}

function reattachBingoPlayer(room, player, socket) {
  if (!room || !player || !socket) return null;
  if (player.socketId && player.socketId !== socket.id) socketRoom.delete(player.socketId);
  clearBingoDisconnectTimer(player);
  player.socketId = socket.id;
  player.connected = true;
  player.disconnectedAt = 0;
  socketRoom.set(socket.id, room.bet);
  socket.join(`room-${room.bet}`);
  return player;
}

function bingoStatePayload(room, player = null) {
  const latest = room.calledNumbers[room.calledNumbers.length - 1] || null;
  const pot = room.escrowPot || room.players.length * room.bet;
  const settings = getBingoSettings();
  const payload = {
    status: room.status,
    bet: room.bet,
    calledNumbers: room.calledNumbers,
    calledCount: room.calledNumbers.length,
    latestNumber: latest,
    latestLetter: latest ? getBingoLetter(latest) : '',
    playerCount: room.players.length,
    connectedCount: bingoConnectedPlayers(room).length,
    pot,
    winnerShare: Math.floor(pot * settings.winnerShare),
    commission: pot - Math.floor(pot * settings.winnerShare),
    penaltyRemaining: player?.penaltyUntil ? Math.max(0, Math.ceil((player.penaltyUntil - Date.now()) / 1000)) : 0,
  };
  if (player && player.cartelaIndex != null) {
    payload.cartelaGrid = CARTELAS[player.cartelaIndex];
    payload.cartelaId = player.cartelaId;
    payload.cartelaName = `Cartela ${player.cartelaId}`;
    payload.autoAssignedCartela = !!player.autoAssignedCartela;
    payload.markedCells = Array.from(player.markedCells || []);
    payload.autoCheck = !!player.autoCheck;
  }
  return payload;
}

function emitBingoState(socket, room, player = null) {
  if (!socket || !room) return;
  if (room.status === 'playing' || room.status === 'paused') socket.emit('bingoState', bingoStatePayload(room, player));
  else socket.emit('lobbyUpdate', getRoomState(room));
}

function finalizeBingoDisconnect(bet, playerId) {
  const room = gameRooms[bet];
  if (!room) return;
  const player = room.players.find(pl => pl.playerId === playerId);
  if (!player || player.connected !== false) return;
  const name = player.name;
  removeBingoPlayerFromRoom(room, player);
  const remaining = room.players.length;
  const connectedRemaining = bingoConnectedPlayers(room).length;
  if ((room.status === 'countdown' || room.status === 'lobby') && remaining < getBingoSettings().minPlayers) cancelCountdown(room);
  if (room.status === 'playing' || room.status === 'paused') {
    io.to(`room-${bet}`).emit('notification', { type: 'warning', message: `${name} disconnected — forfeited ${room.bet} ETB!` });
    if (remaining === 1 && connectedRemaining === 1) resolveLastPlayerBingoWin(room, `${name} disconnected`);
    else if (remaining === 0) { moveAbandonedEscrowToCommission(room, `All players disconnected from Bingo ${bet}B`); resetRoom(room); }
  }
  io.to(`room-${bet}`).emit('lobbyUpdate', getRoomState(room));
  io.to(`room-${bet}`).emit('playerLeft', { name, remainingCount: remaining });
  broadcastCounts();
}

function resetRoom(room) {
  for (const player of room.players || []) clearBingoDisconnectTimer(player);
  clearInterval(room.countdownTimer); clearTimeout(room.drawTimer); clearTimeout(room.pendingDrawTimer); clearTimeout(room.winnerDisplayTimer); room.status = 'lobby'; room.players = []; room.calledNumbers = []; room.calledNumberSet = new Set(); room.takenCartelas = new Set(); room.countdownTimer = null; room.drawTimer = null; room.pendingDrawTimer = null; room.winnerDisplayTimer = null; room.countdownRemaining = 0; room.drawOrder = []; room.drawIndex = 0; room.pendingDraw = null; room.claimPending = false; room.escrowPot = 0; room.roundId = ''; room.proof = null; room.serverSeed = ''; room.serverSeedHash = ''; prepareBingoCommit(room);
}

function prepareBingoCommit(room) {
  if (!room) return;
  if (room.serverSeed && room.serverSeedHash) return;
  room.serverSeed = fairRng.randomServerSeed();
  room.serverSeedHash = fairRng.sha256Hex(room.serverSeed);
}

function getRoomState(room) {
  const settings = getBingoSettings();
  const cartelaMap = {};
  for (const p of room.players) { if (p.cartelaId) cartelaMap[p.cartelaId] = p.name; }
  const pot = room.escrowPot || room.players.length * room.bet;
  prepareBingoCommit(room);
  return { bet: room.bet, status: room.status, players: room.players.map(p => ({ name: p.name, cartelaId: p.cartelaId, connected: p.connected !== false })), playerCount: room.players.length, connectedCount: bingoConnectedPlayers(room).length, countdown: room.countdownRemaining, cartelaMap, totalCartelas: CARTELAS.length, pot, winnerShare: Math.floor(pot * settings.winnerShare), commission: pot - Math.floor(pot * settings.winnerShare), serverSeedHash: room.serverSeedHash };
}

function getAllRoomCounts() {
  const wallets = loadWallets();
  const counts = {};
  for (const room of getBingoRoomList(wallets)) {
    counts[room.bet] = (room.status === 'lobby' || room.status === 'countdown') ? room.players.length : 0;
  }
  return counts;
}
function shuffle(arr) { return fairRng.cryptoShuffle(arr); }

function moveAbandonedEscrowToCommission(room, reason) {
  if (!room || !room.escrowPot) return;
  const wallets = loadWallets();
  const moved = finance.accountTransfer(wallets, 'gameEscrow', 'commission', room.escrowPot, reason, 'bingo_abandoned_escrow', { bet: room.bet, vault: 'commission' });
  if (moved.error) console.error('Abandoned escrow recovery error:', moved.error);
  else saveWallets(wallets);
  room.escrowPot = 0;
}

function clientKey(socket) {
  return socket.handshake.address || socket.id;
}

function isRateLimited(socket) {
  const key = clientKey(socket);
  const now = Date.now();
  const record = adminLoginAttempts.get(key) || { count: 0, first: now };
  if (now - record.first > ADMIN_LOGIN_WINDOW_MS) {
    adminLoginAttempts.set(key, { count: 1, first: now });
    return false;
  }
  record.count += 1;
  adminLoginAttempts.set(key, record);
  return record.count > ADMIN_MAX_LOGIN_ATTEMPTS;
}

function playerLoginKey(socket, login) {
  const cleanLogin = String(login || '').trim().toLowerCase().slice(0, 40);
  return `login:${clientKey(socket)}:${cleanLogin}`;
}

function isPlayerLoginRateLimited(socket, login) {
  const key = playerLoginKey(socket, login);
  const now = Date.now();
  const record = playerLoginAttempts.get(key) || { count: 0, first: now };
  if (now - record.first > PLAYER_LOGIN_WINDOW_MS) {
    playerLoginAttempts.set(key, { count: 1, first: now });
    return false;
  }
  record.count += 1;
  playerLoginAttempts.set(key, record);
  return record.count > PLAYER_MAX_LOGIN_ATTEMPTS;
}

function clearPlayerLoginRateLimit(socket, login) {
  playerLoginAttempts.delete(playerLoginKey(socket, login));
}

function socketRateKey(socket, bucket) {
  const player = socket?.data?.playerId || '';
  return `${bucket}:${player || clientKey(socket)}:${socket.id}`;
}

function allowSocketAction(socket, bucket, maxRequests, windowMs, message = 'Too many actions. Slow down and try again.') {
  const key = socketRateKey(socket, bucket);
  const now = Date.now();
  const record = socketActionLimits.get(key) || { count: 0, first: now };
  if (now - record.first > windowMs) {
    socketActionLimits.set(key, { count: 1, first: now });
    return true;
  }
  record.count += 1;
  socketActionLimits.set(key, record);
  if (record.count > maxRequests) {
    socket.emit('notification', { type: 'error', message });
    return false;
  }
  return true;
}

function allowProductionAdminGameControl(socket, actionName) {
  if (!IS_PRODUCTION) return true;
  socket.emit('notification', { type: 'error', message: `${actionName} is disabled in production.` });
  return false;
}

function clearSocketActionLimits(socket) {
  const suffix = `:${socket.id}`;
  for (const key of socketActionLimits.keys()) {
    if (key.endsWith(suffix)) socketActionLimits.delete(key);
  }
}

function adminSession(socket) {
  const session = adminSessions.get(socket.id);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    adminSessions.delete(socket.id);
    adminSockets.delete(socket.id);
    return null;
  }
  return session;
}

function makeAdminSocketSession(socket, adminId, admin, token = '') {
  const nowIso = new Date().toISOString();
  const session = {
    adminId,
    username: admin.username || ADMIN_USERNAME,
    name: admin.name || admin.username || ADMIN_USERNAME,
    phone: admin.phone || '',
    role: normalizeAdminRole(admin.role),
    mustChangePassword: !!admin.forcePasswordChange,
    loginAt: nowIso,
    lastSeenAt: nowIso,
    expiresAt: Date.now() + ADMIN_SESSION_MS,
    token,
  };
  adminSockets.add(socket.id);
  adminSessions.set(socket.id, session);
  return session;
}

function createAdminBrowserToken(adminId) {
  const token = `${fairRng.randomId('adm')}${crypto.randomBytes(18).toString('hex')}`;
  adminBrowserSessions.set(token, {
    adminId,
    expiresAt: Date.now() + ADMIN_SESSION_MS,
    createdAt: new Date().toISOString(),
  });
  return token;
}

function pruneAdminBrowserSessions() {
  const now = Date.now();
  for (const [token, session] of adminBrowserSessions.entries()) {
    if (!session || now > session.expiresAt) adminBrowserSessions.delete(token);
  }
}

function requireAdmin(socket) {
  const session = adminSession(socket);
  if (!session) {
    socket.emit('adminAuth', { success: false, message: 'Admin session expired. Please log in again.' });
    socket.emit('notification', { type: 'error', message: 'Admin session expired. Please log in again.' });
    return null;
  }
  session.lastSeenAt = new Date().toISOString();
  return session;
}

function auditAdmin(wallets, socket, action, details = {}) {
  if (!wallets.adminAudit) wallets.adminAudit = [];
  const session = adminSession(socket) || {};
  const entry = {
    id: fairRng.randomId('aud'),
    time: new Date().toISOString(),
    admin: session.username || 'unknown',
    adminId: session.adminId || '',
    role: session.role || 'unknown',
    socketId: socket.id,
    ip: socket.handshake.address || '',
    action,
    details,
  };
  wallets.adminAudit.unshift(entry);
  if (wallets.adminAudit.length > 1000) wallets.adminAudit.length = 1000;
  recordAuditEvent(wallets, {
    id: entry.id,
    time: entry.time,
    category: 'admin',
    event: action,
    actorType: 'admin',
    actorId: entry.adminId || '',
    actorName: entry.admin || 'unknown',
    actorRole: entry.role || 'unknown',
    playerId: details.playerId || '',
    playerName: details.playerName || '',
    game: details.game || '',
    amount: details.amount || 0,
    status: 'ok',
    details: {
      ...details,
      socketId: entry.socketId,
      ip: entry.ip,
    },
  });
  return entry;
}

function cleanNote(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function requireNote(socket, note, label = 'reason') {
  const clean = cleanNote(note);
  if (clean.length < 3) {
    socket.emit('notification', { type: 'error', message: `Enter a ${label} before continuing.` });
    return '';
  }
  return clean;
}

const ADMIN_ROLES = Object.freeze({
  master: 'Master Admin',
  senior: 'Senior Admin',
  support: 'Support Admin',
  auditor: 'Read-only Auditor',
});

const ROLE_PERMISSIONS = Object.freeze({
  master: new Set(['view', 'manage_admins', 'resolve_requests', 'game_control', 'player_control', 'player_penalty', 'finance_transfer', 'external_funding', 'dividend_withdrawal', 'player_balance_adjust', 'settings', 'roulette_control', 'reset_pin', 'analytics', 'audit_all']),
  senior: new Set(['view', 'resolve_requests', 'game_control', 'player_control', 'player_penalty', 'finance_transfer', 'external_funding', 'reset_pin', 'analytics', 'audit_senior']),
  support: new Set(['view', 'resolve_requests']),
  auditor: new Set(['view']),
});

const ADMIN_LIMITS = Object.freeze({
  support: { depositApprove: 5000, withdrawApprove: 10000, playerAdjust: 0, vaultTransfer: 0 },
  senior: { depositApprove: 50000, withdrawApprove: 50000, playerAdjust: 0, vaultTransfer: 100000, capitalInjection: 100000 },
  master: { depositApprove: Infinity, withdrawApprove: Infinity, playerAdjust: Infinity, vaultTransfer: Infinity },
  auditor: { depositApprove: 0, withdrawApprove: 0, playerAdjust: 0, vaultTransfer: 0 },
});

function normalizeAdminRole(role) {
  return Object.prototype.hasOwnProperty.call(ADMIN_ROLES, role) ? role : 'support';
}

function normalizeAdminLogin(login) {
  return String(login || '').trim().toLowerCase().slice(0, 80);
}

function adminGeneratedUsername(name, phone) {
  const first = String(name || '')
    .trim()
    .split(/\s+/)[0]
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase() || 'admin';
  const last2 = String(phone || '').replace(/\D/g, '').slice(-2);
  return normalizeAdminLogin(`${first}${last2}`);
}

function normalizeReferralCode(value) {
  const raw = String(value || '')
    .trim()
    .replace(/^https?:\/\/t\.me\/[^?\s]+\?start=/i, '')
    .replace(/^ref(?:erral)?[_:-]?/i, '')
    .replace(/^agent[_:-]?/i, '')
    .toLowerCase();
  const clean = raw.replace(/[^a-z0-9_-]/g, '').slice(0, 48);
  return clean.replace(/^agent_/, '');
}

function referralCodeBaseForAdmin(admin) {
  const phoneLast5 = String(admin?.phone || '').replace(/\D/g, '').slice(-5);
  return normalizeReferralCode(phoneLast5 || admin.username || adminGeneratedUsername(admin.name, admin.phone) || admin.id || 'admin');
}

function referralLinkForCode(code, wallets = null) {
  const username = getTelegramSettings(wallets).botUsername || 'zbingo111_bot';
  return code ? `https://t.me/${username}?start=${encodeURIComponent(code)}` : '';
}

function ensureAdminReferralCodes(wallets) {
  if (!wallets.adminUsers) wallets.adminUsers = {};
  const used = new Set();
  let changed = false;
  for (const admin of Object.values(wallets.adminUsers)) {
    if (!admin || admin.deleted || admin.role !== 'senior') continue;
    let code = referralCodeBaseForAdmin(admin) || normalizeReferralCode(adminGeneratedUsername(admin.name, admin.phone) || admin.id || fairRng.randomId('ref'));
    if (used.has(code)) {
      let i = 2;
      const base = code;
      while (used.has(`${base}_${i}`)) i += 1;
      code = `${base}_${i}`;
    }
    if (normalizeReferralCode(admin.referralCode) !== code) {
      admin.referralCode = code;
      changed = true;
    }
    if (admin.referralActive === undefined) {
      admin.referralActive = true;
      changed = true;
    }
    used.add(code);
  }
  return changed;
}

function findAdminByReferralCode(wallets, code) {
  const clean = normalizeReferralCode(code);
  if (!clean) return null;
  return Object.values(wallets.adminUsers || {}).find(admin =>
    admin &&
    !admin.deleted &&
    admin.active !== false &&
    admin.role === 'senior' &&
    admin.referralActive !== false &&
    normalizeReferralCode(admin.referralCode) === clean
  ) || null;
}

function assignPlayerReferral(wallets, playerId, wallet, code, source = '') {
  if (!wallet || wallet.referredByAdminId) return { assigned: false };
  ensureAdminReferralCodes(wallets);
  const admin = findAdminByReferralCode(wallets, code);
  if (!admin) return { assigned: false, error: code ? 'Referral code is not active.' : '' };
  wallet.referredByAdminId = admin.id;
  wallet.referralCode = admin.referralCode;
  wallet.referredAt = new Date().toISOString();
  wallet.referralSource = String(source || '').slice(0, 80);
  recordAuditEvent(wallets, {
    category: 'account',
    event: 'player_referred',
    actorType: 'system',
    actorId: admin.id,
    actorName: admin.name || '',
    playerId,
    playerName: wallet.name || '',
    status: 'assigned',
    details: {
      adminId: admin.id,
      adminName: admin.name || '',
      referralCode: admin.referralCode,
      source,
    },
  });
  return { assigned: true, admin };
}

function buildReferralPerformance(wallets, session = null) {
  ensureAdminReferralCodes(wallets);
  const canSeeAll = !session || session.role === 'master' || adminHasPermission(session, 'manage_admins');
  const admins = Object.values(wallets.adminUsers || {})
    .filter(admin => admin && !admin.deleted && admin.role === 'senior' && (canSeeAll || admin.id === session.adminId));
  const rows = new Map(admins.map(admin => [admin.id, {
    adminId: admin.id,
    name: admin.name || 'Senior Admin',
    username: admin.username || '',
    phone: admin.phone || '',
    referralCode: admin.referralCode || '',
    referralLink: referralLinkForCode(admin.referralCode, wallets),
    referralActive: admin.referralActive !== false && admin.active !== false,
    totalPlayers: 0,
    activePlayers: 0,
    totalDeposits: 0,
    totalWithdrawals: 0,
    totalBet: 0,
    totalPayout: 0,
    netHouseProfit: 0,
    byGame: {},
  }]));

  const playerToAdmin = new Map();
  for (const [playerId, wallet] of Object.entries(wallets.players || {})) {
    const adminId = wallet.referredByAdminId || '';
    const row = rows.get(adminId);
    if (!row) continue;
    playerToAdmin.set(playerId, adminId);
    row.totalPlayers += 1;
    if ((wallet.gamesPlayed || 0) > 0 || (wallet.balance || 0) > 0) row.activePlayers += 1;
  }

  for (const request of wallets.requests || []) {
    const adminId = playerToAdmin.get(request.playerId);
    const row = rows.get(adminId);
    if (!row || !['approved', 'approved_auto', 'approved_manual', 'paid', 'auto_credited'].includes(String(request.status || ''))) continue;
    if (request.type === 'deposit') row.totalDeposits += finance.money(request.amount);
    if (request.type === 'withdraw') row.totalWithdrawals += finance.money(request.amount);
  }

  for (const receipt of wallets.gameHistory || []) {
    const adminId = playerToAdmin.get(receipt.playerId);
    const row = rows.get(adminId);
    if (!row) continue;
    const game = String(receipt.game || 'game').toLowerCase();
    if (!row.byGame[game]) row.byGame[game] = { game, games: 0, totalBet: 0, totalPayout: 0, netHouseProfit: 0 };
    const bet = finance.money(receipt.bet);
    const payout = finance.money(receipt.payout);
    row.totalBet += bet;
    row.totalPayout += payout;
    row.netHouseProfit += bet - payout;
    row.byGame[game].games += 1;
    row.byGame[game].totalBet += bet;
    row.byGame[game].totalPayout += payout;
    row.byGame[game].netHouseProfit += bet - payout;
  }

  return Array.from(rows.values())
    .map(row => ({ ...row, byGame: Object.values(row.byGame).sort((a, b) => b.totalBet - a.totalBet) }))
    .sort((a, b) => b.netHouseProfit - a.netHouseProfit || b.totalPlayers - a.totalPlayers);
}

function publicAdminUser(admin, wallets = null) {
  return {
    id: admin.id,
    name: admin.name,
    phone: admin.phone || '',
    username: admin.username || '',
    role: admin.role,
    roleLabel: ADMIN_ROLES[admin.role] || admin.role,
    active: admin.active !== false,
    telegramChatId: admin.telegramChatId || '',
    telegramUsername: admin.telegramUsername || '',
    referralCode: admin.referralCode || '',
    referralLink: referralLinkForCode(admin.referralCode || '', wallets),
    referralActive: admin.role === 'senior' && admin.referralActive !== false,
    freePlayActive: !!admin.freePlayActive,
    withdrawalFloatBalance: finance.money(admin.withdrawalFloatBalance || 0),
    depositAccountCount: admin.depositAccountCount || 0,
    mustConnectTelegram: !!admin.mustConnectTelegram,
    forcePasswordChange: !!admin.forcePasswordChange,
    createdAt: admin.createdAt || '',
    lastLoginAt: admin.lastLoginAt || '',
  };
}

function adminFreePlayForWallet(wallets, playerId, wallet) {
  const phone = normalizePhone(wallet?.phone || '');
  if (!phone) return null;
  return Object.values(wallets.adminUsers || {}).find(admin =>
    admin &&
    !admin.deleted &&
    admin.active !== false &&
    admin.freePlayActive === true &&
    admin.phone === phone
  ) || null;
}

function isAdminFreePlay(wallets, playerId, wallet) {
  return !!adminFreePlayForWallet(wallets, playerId, wallet);
}

function findAdminDuplicate(wallets, adminId, phone, username) {
  const cleanUsername = normalizeAdminLogin(username);
  return Object.values(wallets.adminUsers || {}).find(admin =>
    admin.id !== adminId &&
    !admin.deleted &&
    ((phone && admin.phone === phone) || (cleanUsername && normalizeAdminLogin(admin.username) === cleanUsername))
  );
}

function findAdminUser(wallets, login) {
  const clean = normalizeAdminLogin(login);
  const phone = normalizePhone(login);
  return Object.entries(wallets.adminUsers || {}).find(([, admin]) => {
    return admin.active !== false && (
      normalizeAdminLogin(admin.username) === clean ||
      (phone && admin.phone === phone)
    );
  });
}

function ensureBootstrapMaster(wallets) {
  if (!wallets.adminUsers) wallets.adminUsers = {};
  const id = `master:${normalizeAdminLogin(ADMIN_USERNAME) || 'admin'}`;
  const existing = wallets.adminUsers[id] || {};
  wallets.adminUsers[id] = {
    ...existing,
    id,
    name: existing.name || 'Master Admin',
    username: ADMIN_USERNAME,
    phone: existing.phone || '',
    role: 'master',
    active: true,
    source: 'env',
    createdAt: existing.createdAt || new Date().toISOString(),
  };
  return wallets.adminUsers[id];
}

function createAdminUser(wallets, payload = {}, createdBy = 'system') {
  if (!wallets.adminUsers) wallets.adminUsers = {};
  const name = normalizeName(payload.name);
  const phone = normalizePhone(payload.phone);
  const role = normalizeAdminRole(payload.role);
  const username = role === 'master'
    ? normalizeAdminLogin(payload.username || phone || name)
    : adminGeneratedUsername(name, phone);
  const password = String(payload.password || '').trim();
  const telegramChatId = String(payload.telegramChatId || payload.chatId || '').trim().replace(/[^\d-]/g, '').slice(0, 80);
  const telegramUsername = String(payload.telegramUsername || '').trim().replace(/^@/, '').slice(0, 80);
  if (!name || name === 'Anonymous') return { error: 'Admin name is required.' };
  if (!phone) return { error: 'Admin phone must be 09xxxxxxxx, 07xxxxxxxx, +2519xxxxxxxx, or +2517xxxxxxxx.' };
  if (password.length < 4) return { error: 'Admin password must be at least 4 characters.' };
  if (role === 'master' && createdBy !== 'master' && !String(createdBy).startsWith('master:')) return { error: 'Only Master Admin can create another Master Admin.' };
  const duplicate = Object.values(wallets.adminUsers).find(admin =>
    admin.phone === phone || normalizeAdminLogin(admin.username) === username
  );
  if (duplicate) return { error: 'Admin phone/username already exists.' };
  const id = `admin:${phone}`;
  wallets.adminUsers[id] = {
    id,
    name,
    phone,
    username,
    role,
    active: true,
    referralCode: '',
    referralActive: role === 'senior',
    freePlayActive: payload.freePlayActive === true,
    withdrawalFloatBalance: role === 'senior' ? normalizeAdminFloat(payload.withdrawalFloatBalance || payload.floatBalance || 0) : 0,
    telegramChatId,
    telegramUsername,
    passwordHash: hashSecret(password),
    mustConnectTelegram: role === 'senior' && !telegramChatId,
    forcePasswordChange: role !== 'master',
    createdBy,
    createdAt: new Date().toISOString(),
  };
  ensureAdminReferralCodes(wallets);
  return { admin: wallets.adminUsers[id] };
}

function updateAdminPassword(admin, password) {
  const clean = String(password || '').trim();
  if (clean.length < 4) return { error: 'Admin password must be at least 4 characters.' };
  admin.passwordHash = hashSecret(clean);
  admin.passwordChangedAt = new Date().toISOString();
  return { success: true };
}

function adminHasPermission(session, permission) {
  if (!session) return false;
  return ROLE_PERMISSIONS[session.role]?.has(permission) || false;
}

function requireAdminPermission(socket, permission) {
  const session = requireAdmin(socket);
  if (!session) return null;
  if (session.mustChangePassword && permission !== 'view') {
    socket.emit('notification', { type: 'error', message: 'Change your temporary admin password before continuing.' });
    return null;
  }
  if (!adminHasPermission(session, permission)) {
    socket.emit('notification', { type: 'error', message: 'You do not have permission for that admin action.' });
    return null;
  }
  return session;
}

function verifyAdminPasswordForSession(wallets, session, password) {
  const cleanPassword = String(password || '');
  if (!session || session.role !== 'master' || !cleanPassword) return false;
  const admin = session.adminId ? wallets.adminUsers?.[session.adminId] : null;
  if (admin?.passwordHash && verifySecret(admin.passwordHash, cleanPassword)) return true;
  return session.username === ADMIN_USERNAME && safeEqual(cleanPassword, ADMIN_PASSWORD);
}

function adminLimit(session, key) {
  return ADMIN_LIMITS[session?.role || 'auditor']?.[key] ?? 0;
}

function isSensitiveFinanceAccount(account) {
  return ['commission', 'kenoHouseWinVault', 'rouletteHouseWinVault', 'withdrawalFeeVault', 'operating', 'playerLiability', 'withdrawals', 'gameEscrow'].includes(String(account || ''));
}

function isAdminTransferLockedAccount(account) {
  return ADMIN_TRANSFER_LOCKED_ACCOUNTS.includes(String(account || ''));
}

function requireRequestPermission(socket, session, request, action) {
  if (!adminHasPermission(session, 'resolve_requests')) {
    socket.emit('notification', { type: 'error', message: 'You do not have permission to resolve wallet requests.' });
    return false;
  }
  if (action === 'approve' && request.type === 'deposit' && !['senior', 'master'].includes(session.role)) {
    socket.emit('notification', { type: 'error', message: 'Only Senior Admin or Master Admin can approve deposits.' });
    return false;
  }
  if (request.type === 'withdraw' && action === 'approve' && session.role === 'senior' && request.assignedWithdrawAdminId !== session.adminId) {
    socket.emit('notification', { type: 'error', message: 'This withdrawal is assigned to another admin.' });
    return false;
  }
  if (request.type === 'withdraw' && action === 'approve' && session.role === 'senior') {
    const wallets = loadWallets();
    const admin = wallets.adminUsers?.[session.adminId];
    if (finance.money(admin?.withdrawalFloatBalance || 0) < finance.money(request.amount || 0)) {
      socket.emit('notification', { type: 'error', message: 'Your admin float balance cannot cover this withdrawal. Use No Balance / Reassign.' });
      return false;
    }
  }
  if (action !== 'approve') return true;
  const key = request.type === 'withdraw' ? 'withdrawApprove' : 'depositApprove';
  const limit = adminLimit(session, key);
  if (request.amount > limit) {
    socket.emit('notification', { type: 'error', message: `${session.role} admins can approve ${request.type} requests up to ${limit} ETB.` });
    return false;
  }
  return true;
}

function isSuspended(wallets, playerId) {
  const suspension = wallets.suspendedPlayers?.[playerId];
  if (!suspension) return false;
  if (suspension.cooldown) return false;
  if (suspension.until && Date.parse(suspension.until) <= Date.now()) return false;
  return true;
}

function suspensionMessage(wallets, playerId) {
  const suspension = wallets.suspendedPlayers?.[playerId];
  if (suspension?.cooldown) return suspension.reason || "Today seems to be an unlucky day! Take a short break to recharge, and we look forward to seeing you back soon.";
  if (suspension?.reason) return `Your account is suspended. Reason: ${suspension.reason}`;
  return 'Your account is suspended. Please contact support.';
}

function makeTempPin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

function validateConfigValue(key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return { error: 'Invalid number.' };
  const integerKeys = new Set(['MIN_PLAYERS', 'MAX_PLAYERS', 'COUNTDOWN_SECONDS', 'DRAW_INTERVAL_MS', 'PENALTY_SECONDS', 'WINNER_DISPLAY_SECONDS', 'STARTING_BALANCE', 'COOL_DOWN_LOSS_THRESHOLD', 'COOL_DOWN_HOURS']);
  const val = integerKeys.has(key) ? Math.round(number) : number;
  const ranges = {
    MIN_PLAYERS: [2, 20],
    MAX_PLAYERS: [2, 100],
    COUNTDOWN_SECONDS: [5, 300],
    DRAW_INTERVAL_MS: [1000, 15000],
    PENALTY_SECONDS: [3, 120],
    WINNER_DISPLAY_SECONDS: [3, 120],
    COMMISSION_RATE: [0, 0.5],
    WINNER_SHARE: [0.5, 1],
    STARTING_BALANCE: [0, 100000],
    COOL_DOWN_LOSS_THRESHOLD: [20, 50],
    COOL_DOWN_HOURS: [1, 24],
  };
  const range = ranges[key];
  if (!range) return { error: `Unknown config key: ${key}` };
  if (val < range[0] || val > range[1]) return { error: `${key} must be between ${range[0]} and ${range[1]}.` };
  return { value: val };
}

// ──────────────────────────────────────
// VERIFICATION
// ──────────────────────────────────────
function checkBingo(cartelaGrid, drawnSet) {
  const hits = [];
  for (let r = 0; r < 5; r++) { hits[r] = []; for (let c = 0; c < 5; c++) { hits[r][c] = cartelaGrid[r][c] === -1 || drawnSet.has(cartelaGrid[r][c]); } }
  const patterns = [];
  for (let r = 0; r < 5; r++) if (hits[r].every(Boolean)) patterns.push(`Row ${r + 1}`);
  for (let c = 0; c < 5; c++) if ([0, 1, 2, 3, 4].every(r => hits[r][c])) patterns.push(`Column ${c + 1}`);
  if ([0, 1, 2, 3, 4].every(i => hits[i][i])) patterns.push('Diagonal ↘');
  if ([0, 1, 2, 3, 4].every(i => hits[i][4 - i])) patterns.push('Diagonal ↙');
  if (hits.flat().every(Boolean)) patterns.push('Full House');
  return patterns;
}
function checkMarkedBingo(cartelaGrid, markedSet, drawnSet) {
  const hits = [];
  for (let r = 0; r < 5; r++) {
    hits[r] = [];
    for (let c = 0; c < 5; c++) {
      const val = cartelaGrid[r][c];
      hits[r][c] = val === -1 || (markedSet.has(`${r},${c}`) && drawnSet.has(val));
    }
  }
  const patterns = [];
  for (let r = 0; r < 5; r++) if (hits[r].every(Boolean)) patterns.push(`Row ${r + 1}`);
  for (let c = 0; c < 5; c++) if ([0, 1, 2, 3, 4].every(r => hits[r][c])) patterns.push(`Column ${c + 1}`);
  if ([0, 1, 2, 3, 4].every(i => hits[i][i])) patterns.push('Diagonal ↘');
  if ([0, 1, 2, 3, 4].every(i => hits[i][4 - i])) patterns.push('Diagonal ↙');
  if (hits.flat().every(Boolean)) patterns.push('Full House');
  return patterns;
}
function verifyMarks(cartelaGrid, markedSet, drawnSet, missedGraceSet = new Set()) {
  const verified = [], wrong = [], missed = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) { const val = cartelaGrid[r][c]; if (val === -1) continue; const isMarked = markedSet.has(`${r},${c}`), isCalled = drawnSet.has(val); if (isMarked && isCalled) verified.push([r, c]); else if (isMarked && !isCalled) wrong.push([r, c]); else if (!isMarked && isCalled && !missedGraceSet.has(val)) missed.push([r, c]); }
  return { verified, wrong, missed };
}
function getBingoLetter(num) { if (num <= 15) return 'B'; if (num <= 30) return 'I'; if (num <= 45) return 'N'; if (num <= 60) return 'G'; return 'O'; }

// ──────────────────────────────────────
// GAME FLOW
// ──────────────────────────────────────
function startCountdown(room) {
  if (room.status !== 'lobby') return;
  const settings = getBingoSettings();
  prepareBingoCommit(room);
  room.status = 'countdown'; room.countdownRemaining = settings.countdownSeconds;
  io.to(`room-${room.bet}`).emit('lobbyUpdate', getRoomState(room)); broadcastCounts();
  room.countdownTimer = setInterval(() => { room.countdownRemaining--; if (room.countdownRemaining <= 0) { clearInterval(room.countdownTimer); room.countdownTimer = null; startGame(room); return; } io.to(`room-${room.bet}`).emit('lobbyUpdate', getRoomState(room)); }, 1000);
}
function cancelCountdown(room) { clearInterval(room.countdownTimer); room.countdownTimer = null; room.status = 'lobby'; room.countdownRemaining = 0; io.to(`room-${room.bet}`).emit('lobbyUpdate', getRoomState(room)); broadcastCounts(); }

function pruneDisconnectedBingoPlayers(room) {
  const before = room.players.length;
  room.players = room.players.filter(player => {
    const connected = io.sockets.sockets.has(player.socketId);
    if (!connected) {
      if (player.cartelaId && room.takenCartelas.has(player.cartelaId)) room.takenCartelas.delete(player.cartelaId);
      socketRoom.delete(player.socketId);
    }
    return connected;
  });
  return before - room.players.length;
}

function startGame(room) {
  const wallets = loadWallets();
  const activated = activatePendingGameSettings(wallets, 'bingo', 'bingo_round_start');
  const settings = activeGameSettings(wallets, 'bingo');
  if (activated) syncBingoRooms(wallets);
  if (room.players.length < settings.minPlayers) {
    if (activated) saveWallets(wallets);
    room.status = 'lobby';
    room.countdownRemaining = 0;
    io.to(`room-${room.bet}`).emit('lobbyUpdate', getRoomState(room));
    broadcastCounts();
    return;
  }
  // Auto-assign Cartela at the final countdown moment so the round can start.
  for (const p of room.players) {
    if (p.cartelaId === null) {
      const available = [];
      for (let i = 1; i <= CARTELAS.length; i++) { if (!room.takenCartelas.has(i)) available.push(i); }
      if (available.length > 0) {
        const id = available[fairRng.randomInt(available.length)];
        p.cartelaId = id; p.cartelaIndex = id - 1; p.autoAssignedCartela = true; room.takenCartelas.add(id);
        const sock = io.sockets.sockets.get(p.socketId);
        if (sock) sock.emit('cartelaSelected', { cartelaId: id, cartelaName: `Cartela ${id} (auto)` });
      }
    }
  }
  const readyPlayers = room.players.filter(p => p.cartelaId !== null);
  if (readyPlayers.length < settings.minPlayers) { if (activated) saveWallets(wallets); room.status = 'lobby'; room.countdownRemaining = 0; io.to(`room-${room.bet}`).emit('lobbyUpdate', getRoomState(room)); io.to(`room-${room.bet}`).emit('notification', { type: 'error', message: `Need ${settings.minPlayers}+ players with Cartelas!` }); if (room.players.length >= settings.minPlayers) setTimeout(() => startCountdown(room), 3000); return; }

  const solvent = readyPlayers.filter(p => { const w = wallets.players[p.playerId]; return w && w.balance >= room.bet && !isSuspended(wallets, p.playerId); });
  for (const p of readyPlayers) { if (!solvent.includes(p)) { const s = io.sockets.sockets.get(p.socketId); const w = wallets.players[p.playerId]; if (s) s.emit('notification', { type: 'error', message: w ? `Insufficient balance! ${w.balance} ETB, need ${room.bet}.` : 'Please log in again.' }); } }
  if (solvent.length < settings.minPlayers) { if (activated) saveWallets(wallets); room.status = 'lobby'; room.countdownRemaining = 0; io.to(`room-${room.bet}`).emit('lobbyUpdate', getRoomState(room)); return; }
  room.players = solvent;

  const roundId = fairRng.randomId(`bingo_${room.bet}`);
  room.roundId = roundId;
  room.proof = fairRng.makeProof(room.serverSeed, roundId, `bingo:${room.bet}`);
  room.escrowPot = 0;
  const debited = [];
  let startFailed = false;
  for (const p of room.players) {
    const w = wallets.players[p.playerId];
    const moved = finance.debitPlayerToAccount(wallets, p.playerId, w, 'gameEscrow', room.bet, `Bingo ${room.bet} ETB stake from ${p.name}`, 'bingo_stake', { game: 'bingo', bet: room.bet });
    if (moved.error) { p.skipStart = true; startFailed = true; break; }
    p.activeStakeKey = recordActiveGameStake(wallets, {
      id: activeStakeId('bingo', roundId, p.playerId),
      game: 'bingo',
      round: roundId,
      playerId: p.playerId,
      playerName: p.name,
      amount: room.bet,
      account: 'gameEscrow',
      meta: { bet: room.bet, cartelaId: p.cartelaId },
    });
    debited.push({ player: p, wallet: w });
    room.escrowPot += room.bet;
    w.totalLost += room.bet;
    w.gamesPlayed++;
  }
  room.players = room.players.filter(p => !p.skipStart);
  if (startFailed || room.players.length < settings.minPlayers) {
    for (const item of debited) {
      const refunded = finance.accountToPlayer(wallets, 'gameEscrow', item.player.playerId, item.wallet, room.bet, `Bingo start refund to ${item.player.name}`, 'bingo_start_refund', { game: 'bingo', bet: room.bet });
      if (!refunded.error) {
        room.escrowPot = Math.max(0, room.escrowPot - room.bet);
        item.wallet.totalLost = Math.max(0, (item.wallet.totalLost || 0) - room.bet);
        item.wallet.gamesPlayed = Math.max(0, (item.wallet.gamesPlayed || 0) - 1);
        clearActiveGameStake(wallets, item.player.activeStakeKey);
      }
    }
    room.status = 'lobby';
    room.countdownRemaining = 0;
    saveWallets(wallets);
    io.to(`room-${room.bet}`).emit('lobbyUpdate', getRoomState(room));
    return;
  }
  saveWallets(wallets);
  prepareBingoCommit(room);
  room.drawOrder = fairRng.seededShuffle(Array.from({ length: 75 }, (_, i) => i + 1), room.serverSeed, `bingo:${roundId}`); room.drawIndex = 0; room.calledNumbers = []; room.calledNumberSet = new Set(); room.status = 'playing';

  const pot = room.escrowPot, ws = Math.floor(pot * settings.winnerShare), comm = pot - ws;
  for (const player of room.players) { const sock = io.sockets.sockets.get(player.socketId); if (sock) { player.markedCells = new Set(); player.penaltyUntil = 0; player.falseBingoClaims = 0; const w = getPlayerWallet(wallets, player.playerId, player.name); const autoAssigned = !!player.autoAssignedCartela; sock.emit('gameStart', { cartelaGrid: CARTELAS[player.cartelaIndex], cartelaId: player.cartelaId, cartelaName: `Cartela ${player.cartelaId}`, autoAssignedCartela: autoAssigned, autoAssignedMessage: autoAssigned ? `Cartela ${player.cartelaId} was chosen for you because you did not choose a Cartela within 1 minute.` : '', autoCheck: !!player.autoCheck, bet: room.bet, pot, winnerShare: ws, commission: comm, balance: w.balance, proof: { roundId, serverSeedHash: room.proof.serverSeedHash, hash: room.proof.hash }, players: room.players.map(p => ({ name: p.name, cartelaId: p.cartelaId })) }); } }
  io.to(`room-${room.bet}`).emit('gameStatusUpdate', { status: 'playing', playerCount: room.players.length, calledCount: 0, pot, winnerShare: ws, commission: comm });
  broadcastCounts();
  console.log(`🎮 [${room.bet}B] ${room.players.length}p · Pot:${pot} · W:${ws} · C:${comm}`);
  scheduleBingoDraw(room, 1500);
}

function finishBingoNoClaim(room) {
  clearTimeout(room.drawTimer);
  clearTimeout(room.pendingDrawTimer);
  room.drawTimer = null;
  room.pendingDrawTimer = null;
  room.pendingDraw = null;
  room.status = 'finished';
  console.log(`⚪ [${room.bet}B] All drawn. No manual Bingo claim — walkover.`);

  const wallets = loadWallets();
  const settings = activeGameSettings(wallets, 'bingo');
  const refund = Math.floor(room.bet * (1 - settings.commissionRate));
  for (const player of room.players) {
    const wWallet = getPlayerWallet(wallets, player.playerId, player.name);
    finance.accountToPlayer(wallets, 'gameEscrow', player.playerId, wWallet, refund, `Bingo walkover refund to ${player.name}`, 'bingo_walkover', { game: 'bingo', bet: room.bet });
    recordGameHistory(wallets, { id: makeReceiptId('bingo_walkover'), game: 'bingo', playerId: player.playerId, playerName: player.name, bet: room.bet, payout: refund, status: 'walkover', details: { calledCount: room.calledNumbers.length, cartelaId: player.cartelaId, reason: 'no_manual_claim' } });
  }
  const comm = room.players.length * (room.bet - refund);
  if (comm > 0) {
    finance.accountTransfer(wallets, 'gameEscrow', 'commission', comm, `Bingo walkover commission ${room.bet}B`, 'bingo_commission', { game: 'bingo', bet: room.bet, vault: 'commission' });
    wallets.company.totalCommission += comm;
  }
  clearActiveGameStakesForRound(wallets, 'bingo', room.roundId);
  saveWallets(wallets);
  room.escrowPot = 0;
  io.to(`room-${room.bet}`).emit('gameOver', { winner: null, patterns: [], isWalkover: true, bet: room.bet, pot: 0, walkover: true, message: 'No player claimed Bingo before the draw ended.' });
  broadcastCounts();
  room.winnerDisplayTimer = setTimeout(() => { resetRoom(room); io.to(`room-${room.bet}`).emit('gameReset', { bet: room.bet }); broadcastCounts(); }, settings.winnerDisplaySeconds * 1000);
}

function scheduleBingoDraw(room, delayMs = null) {
  if (!room || room.status !== 'playing') return;
  const settings = getBingoSettings();
  const effectiveDrawIntervalMs = Math.max(1000, settings.drawIntervalMs - BINGO_DRAW_DISPLAY_REDUCTION_MS);
  clearTimeout(room.drawTimer);
  room.drawTimer = setTimeout(() => {
    room.drawTimer = null;
    drawNextNumber(room);
  }, Math.max(250, Number(delayMs) || effectiveDrawIntervalMs));
}

function drawNextNumber(room) {
  if (room.status !== 'playing') return;
  if (room.pendingDraw) return;
  while (room.drawIndex < room.drawOrder.length && room.calledNumberSet.has(room.drawOrder[room.drawIndex])) {
    console.warn(`Duplicate Bingo draw skipped before emit: ${room.drawOrder[room.drawIndex]} in ${room.bet}B round ${room.roundId || '-'}`);
    room.drawIndex++;
  }
  if (room.drawIndex >= room.drawOrder.length) {
    finishBingoNoClaim(room);
    return;
  }
  const number = room.drawOrder[room.drawIndex];
  const drawIndex = room.drawIndex + 1;
  const serverNow = Date.now();
  const settings = getBingoSettings();
  const revealDelayMs = settings.revealDelayMs || BINGO_REVEAL_DELAY_MS;
  const revealAt = serverNow + revealDelayMs;
  room.pendingDraw = { number, drawIndex, revealAt };
  io.to(`room-${room.bet}`).emit('numberQueued', { number, letter: getBingoLetter(number), drawIndex, total: room.drawOrder.length, revealAt, serverNow });
  console.log(`🎲 [${room.bet}B] #${drawIndex}: ${number} (${room.players.length}p)`);
  room.pendingDrawTimer = setTimeout(() => {
    if (room.status !== 'playing' || !room.pendingDraw || room.pendingDraw.number !== number) return;
    room.drawIndex = Math.max(room.drawIndex + 1, drawIndex);
    if (!room.calledNumberSet.has(number)) {
      room.calledNumbers.push(number);
      room.calledNumberSet.add(number);
    } else {
      console.warn(`Duplicate Bingo draw suppressed at reveal: ${number} in ${room.bet}B round ${room.roundId || '-'}`);
    }
    room.pendingDraw = null;
    room.pendingDrawTimer = null;
    applyBingoAutoCheckForNumber(room, number);
    io.to(`room-${room.bet}`).emit('numberDrawn', { number, letter: getBingoLetter(number), calledNumbers: room.calledNumbers, drawIndex: room.drawIndex, total: room.drawOrder.length, revealAt, serverNow: Date.now() });
    const freshSettings = getBingoSettings();
    const effectiveDrawIntervalMs = Math.max(1000, freshSettings.drawIntervalMs - BINGO_DRAW_DISPLAY_REDUCTION_MS);
    scheduleBingoDraw(room, Math.max(1000, effectiveDrawIntervalMs - revealDelayMs));
  }, revealDelayMs);
}

function autoMarkBingoNumberForPlayer(room, player, number) {
  if (!room || !player || !player.autoCheck || player.cartelaIndex == null) return false;
  const card = CARTELAS[player.cartelaIndex];
  if (!card) return false;
  let marked = false;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (card[r][c] !== number) continue;
      const key = `${r},${c}`;
      if (player.markedCells.has(key)) continue;
      player.markedCells.add(key);
      marked = true;
      const sock = io.sockets.sockets.get(player.socketId);
      if (sock) sock.emit('markToggled', { row: r, col: c, marked: true, autoMarked: true });
    }
  }
  return marked;
}

function applyBingoAutoCheckForNumber(room, number) {
  if (!room || !Number.isFinite(Number(number))) return;
  for (const player of room.players || []) autoMarkBingoNumberForPlayer(room, player, Number(number));
}

function officialBingoDrawSet(room) {
  const drawnSet = new Set(room.calledNumberSet);
  const pending = room.pendingDraw;
  if (pending && Date.now() >= pending.revealAt - 100) drawnSet.add(pending.number);
  return drawnSet;
}

function commitDuePendingDraw(room) {
  const pending = room.pendingDraw;
  if (!pending || Date.now() < pending.revealAt - 100) return;
  clearTimeout(room.pendingDrawTimer);
  room.pendingDrawTimer = null;
  room.pendingDraw = null;
  room.drawIndex = Math.max(room.drawIndex, pending.drawIndex);
  if (!room.calledNumberSet.has(pending.number)) {
    room.calledNumbers.push(pending.number);
    room.calledNumberSet.add(pending.number);
  }
}

function endGame(room, winner, patterns, isWalkover = false) {
  if (room.status === 'finished') return;
  clearTimeout(room.drawTimer); clearTimeout(room.pendingDrawTimer); room.drawTimer = null; room.pendingDrawTimer = null; room.pendingDraw = null; room.status = 'finished';
  const wallets = loadWallets(), settings = activeGameSettings(wallets, 'bingo'), pot = room.escrowPot || room.players.length * room.bet, ws = Math.floor(pot * settings.winnerShare), comm = pot - ws;
  const roundId = room.roundId || makeReceiptId('bingo_round');
  const wWallet = getPlayerWallet(wallets, winner.playerId, winner.name);
  const payout = finance.accountToPlayer(wallets, 'gameEscrow', winner.playerId, wWallet, ws, `Bingo payout to ${winner.name}`, 'bingo_payout', { game: 'bingo', bet: room.bet, pot });
  if (payout.error) { console.error('Bingo payout error:', payout.error); return; }
  const promoReclaim = reclaimSignupPromoAfterWin(wallets, winner.playerId, wWallet, ws, 'bingo', { roundId, bet: room.bet, pot });
  const house = finance.accountTransfer(wallets, 'gameEscrow', 'commission', comm, `Bingo commission ${room.bet}B - ${winner.name} won`, 'bingo_commission', { game: 'bingo', bet: room.bet, pot, vault: 'commission' });
  if (house.error) { console.error('Bingo commission error:', house.error); return; }
  clearActiveGameStakesForRound(wallets, 'bingo', roundId);
  wWallet.totalWon += ws; wWallet.wins = (wWallet.wins || 0) + 1;
  wallets.company.totalCommission += comm;
  for (const player of room.players) {
    const receipt = recordGameHistory(wallets, {
      id: player.playerId === winner.playerId ? roundId : makeReceiptId('bingo'),
      game: 'bingo',
      playerId: player.playerId,
      playerName: player.name,
      bet: room.bet,
      payout: player.playerId === winner.playerId ? ws : 0,
      status: player.playerId === winner.playerId ? 'won' : 'lost',
      details: {
        roundId,
        pot,
        commission: comm,
        winnerName: winner.name,
        winnerPlayerId: winner.playerId,
        cartelaId: player.cartelaId,
        winnerCartelaId: winner.cartelaId,
        patterns,
        calledNumbers: room.calledNumbers,
        calledCount: room.calledNumbers.length,
        isWalkover,
        promoReclaim: player.playerId === winner.playerId ? finance.money(promoReclaim.reclaimed || 0) : 0,
        proof: room.proof || null,
      },
    });
    const sock = io.sockets.sockets.get(player.socketId);
    if (sock) sock.emit('receiptRecorded', publicReceipt(receipt, true));
    // Send personal balance to each losing player
    if (player.playerId !== winner.playerId && sock) {
      const lWallet = getPlayerWallet(wallets, player.playerId, player.name);
      sock.emit('playerLoss', { bet: room.bet, pot, winnerShare: ws, winnerName: winner.name, winnerCartelaId: winner.cartelaId, patterns, newBalance: lWallet.balance });
    }
  }
  room.escrowPot = 0;
  notifyPlayerWin(wallets, winner.playerId, wWallet, 'bingo', ws, { round: roundId });
  saveWallets(wallets);
  console.log(`🏆 [${room.bet}B] ${winner.name} +${ws} ETB (Pot:${pot} C:${comm})`);
  io.to(`room-${room.bet}`).emit('gameOver', { winner: { name: winner.name, cartelaId: winner.cartelaId, playerId: winner.playerId }, patterns, isWalkover, bet: room.bet, pot, winnerShare: ws, commission: comm, newBalance: wWallet.balance, roundId });
  broadcastCounts();
  room.winnerDisplayTimer = setTimeout(() => { console.log(`🔄 [${room.bet}B] Reset`); resetRoom(room); io.to(`room-${room.bet}`).emit('gameReset', { bet: room.bet }); broadcastCounts(); }, settings.winnerDisplaySeconds * 1000);
}

function resolveLastPlayerBingoWin(room, reason) {
  if (!room || room.claimPending || (room.status !== 'playing' && room.status !== 'paused')) return false;
  if (room.players.length !== 1) return false;
  const winner = room.players[0];
  clearTimeout(room.drawTimer);
  clearTimeout(room.pendingDrawTimer);
  room.drawTimer = null;
  room.pendingDrawTimer = null;
  room.pendingDraw = null;
  room.status = 'paused';
  room.claimPending = true;
  const pot = room.escrowPot || room.players.length * room.bet;
  const settings = getBingoSettings();
  const ws = Math.floor(pot * settings.winnerShare);
  const comm = pot - ws;
  const patterns = ['Default win - all other players left'];
  console.log(`🏁 [${room.bet}B] Default Bingo win: ${winner.name} (${reason})`);
  io.to(`room-${room.bet}`).emit('bingoAnnouncement', {
    claimer: winner.name,
    playerId: winner.playerId,
    cartelaId: winner.cartelaId,
    isValid: true,
    isWalkover: true,
    bet: room.bet,
    pot,
    winnerShare: ws,
    commission: comm,
    message: 'All other players left. Default win.',
  });
  setTimeout(() => {
    if (room.claimPending && room.status === 'paused') endGame(room, winner, patterns, true);
  }, 2000);
  return true;
}

// In-memory cache for company stats — updated on saveWallets, avoids disk reads in broadcasts
let _cachedCompanyStats={totalCommission:0,balance:0};
function updateCachedCompanyStats(wallets){if(wallets&&wallets.company){_cachedCompanyStats.totalCommission=wallets.company.totalCommission||0;_cachedCompanyStats.balance=wallets.company.balance||0}}
function broadcastCounts() { io.emit('roomCounts', getAllRoomCounts()); io.emit('companyStats', _cachedCompanyStats); }

function recordTransaction(wallets, type, amount, desc) {
  finance.recordLedger(wallets, { type, amount, desc, from: 'system', to: 'system' });
}

function activeStakeId(game, round, playerId, extra = '') {
  return [game, round, playerId, extra].filter(v => v !== undefined && v !== null && String(v).trim()).map(String).join(':');
}

function recordActiveGameStake(wallets, stake = {}) {
  if (!wallets.activeGameStakes) wallets.activeGameStakes = {};
  const amount = finance.money(stake.amount);
  if (!stake.game || !stake.playerId || amount <= 0) return '';
  const id = stake.id || activeStakeId(stake.game, stake.round || 'active', stake.playerId, stake.extra || '');
  wallets.activeGameStakes[id] = {
    id,
    game: String(stake.game).toLowerCase(),
    round: stake.round || '',
    playerId: String(stake.playerId),
    playerName: stake.playerName || '',
    amount,
    account: stake.account || gamePrizeVault(stake.game),
    createdAt: stake.createdAt || new Date().toISOString(),
    meta: stake.meta || {},
  };
  return id;
}

function clearActiveGameStake(wallets, id) {
  if (!id || !wallets.activeGameStakes) return;
  delete wallets.activeGameStakes[id];
}

function clearActiveGameStakesForRound(wallets, game, round) {
  if (!wallets.activeGameStakes) return 0;
  const gameKey = String(game || '').toLowerCase();
  const roundKey = String(round || '');
  let count = 0;
  for (const [id, stake] of Object.entries(wallets.activeGameStakes)) {
    if (String(stake.game || '').toLowerCase() !== gameKey) continue;
    if (roundKey && String(stake.round || '') !== roundKey) continue;
    delete wallets.activeGameStakes[id];
    count += 1;
  }
  return count;
}

function voidActiveGameStakes(wallets, reason = 'system_interruption') {
  if (!wallets.activeGameStakes) wallets.activeGameStakes = {};
  const stakes = Object.values(wallets.activeGameStakes);
  if (!stakes.length) return { count: 0, refunded: 0, failed: 0 };
  let refunded = 0;
  let failed = 0;
  const affected = new Set();
  for (const stake of stakes) {
    const wallet = wallets.players?.[stake.playerId];
    if (!wallet) {
      failed += 1;
      continue;
    }
    const refund = finance.accountToPlayer(
      wallets,
      stake.account || gamePrizeVault(stake.game),
      stake.playerId,
      wallet,
      stake.amount,
      `${String(stake.game || 'game').toUpperCase()} round void refund to ${wallet.name}`,
      'game_void_refund',
      { game: stake.game, round: stake.round, reason, activeStakeId: stake.id, ...(stake.meta || {}) }
    );
    if (refund.error) {
      failed += 1;
      continue;
    }
    refunded += finance.money(stake.amount);
    affected.add(stake.playerId);
    recordGameHistory(wallets, {
      game: stake.game || 'game',
      playerId: stake.playerId,
      playerName: stake.playerName || wallet.name,
      bet: stake.amount,
      payout: stake.amount,
      status: 'void',
      details: { round: stake.round, reason, refunded: stake.amount, ...(stake.meta || {}) },
    });
    clearActiveGameStake(wallets, stake.id);
  }
  recordAuditEvent(wallets, {
    category: 'system',
    event: 'active_games_voided',
    actorType: 'system',
    status: failed ? 'partial' : 'success',
    amount: refunded,
    details: { reason, stakes: stakes.length, players: affected.size, refunded, failed },
  });
  const message = `System interruption recovery\nActive games voided: ${stakes.length}\nPlayers refunded: ${affected.size}\nTotal refunded: ${formatEtb(refunded)}${failed ? `\nFailed refunds needing review: ${failed}` : ''}\nReason: ${reason}`;
  notifySeniorAndMasterAdmins(wallets, message);
  return { count: stakes.length, refunded, failed };
}

function recoverStaleEscrow() {
  const wallets = loadWallets();
  const voided = voidActiveGameStakes(wallets, 'server_startup_recovery');
  if (voided.count > 0) saveWallets(wallets);
  const stale = finance.money(wallets.company.accounts?.gameEscrow);
  if (stale <= 0) return;
  console.warn(`Startup found ${stale} ETB in game escrow. It was not auto-moved; resolve from admin after checking interrupted rounds.`);
  notifySeniorAndMasterAdmins(wallets, `System startup recovery warning\nFound ${formatEtb(stale)} in Bingo game escrow without recoverable active stake records.\nPlease review interrupted rounds from the admin finance/audit pages.`);
}

// ──────────────────────────────────────
// ADMIN HELPERS
// ──────────────────────────────────────
function suspensionLabel(suspension = {}) {
  if (!suspension) return '';
  if (suspension.permanent) return 'Permanent ban';
  if (!suspension.until) return 'Suspended';
  const until = Date.parse(suspension.until);
  if (!Number.isFinite(until)) return 'Suspended';
  const remainingMs = Math.max(0, until - Date.now());
  if (remainingMs <= 0) return 'Expired';
  const minutes = Math.ceil(remainingMs / 60000);
  if (minutes < 120) return `${minutes} min remaining`;
  return `${Math.ceil(minutes / 60)} hr remaining`;
}

function publicSuspension(wallets, playerId) {
  const suspension = wallets.suspendedPlayers?.[playerId];
  if (!suspension || (suspension.until && Date.parse(suspension.until) <= Date.now())) return null;
  return {
    suspendedAt: suspension.suspendedAt || '',
    until: suspension.until || null,
    permanent: !!suspension.permanent,
    duration: suspension.duration || '',
    reason: suspension.reason || '',
    by: suspension.by || '',
    byRole: suspension.byRole || '',
    label: suspensionLabel(suspension),
  };
}

function emptyGameStats(game = '') {
  return { game, gamesPlayed: 0, totalBet: 0, totalPaidOut: 0, totalWon: 0, totalLost: 0, netPnL: 0, wins: 0, losses: 0 };
}

function buildAdminPlayerStats(wallets) {
  const stats = new Map();
  for (const [id, wallet] of Object.entries(wallets.players || {})) {
    stats.set(id, { playerId: id, name: wallet.name || id, gamesPlayed: 0, totalBet: 0, totalPaidOut: 0, totalWon: 0, totalLost: 0, netPnL: 0, byGame: {} });
  }
  for (const receipt of wallets.gameHistory || []) {
    if (!receipt.playerId) continue;
    const player = stats.get(receipt.playerId) || { playerId: receipt.playerId, name: receipt.playerName || receipt.playerId, gamesPlayed: 0, totalBet: 0, totalPaidOut: 0, totalWon: 0, totalLost: 0, netPnL: 0, byGame: {} };
    const game = receipt.game || 'game';
    const gameStats = player.byGame[game] || emptyGameStats(game);
    const bet = finance.money(receipt.bet);
    const payout = finance.money(receipt.payout);
    const net = payout - bet;
    player.gamesPlayed += 1;
    player.totalBet += bet;
    player.totalPaidOut += payout;
    player.totalWon += Math.max(0, payout);
    player.totalLost += Math.max(0, bet);
    player.netPnL += net;
    gameStats.gamesPlayed += 1;
    gameStats.totalBet += bet;
    gameStats.totalPaidOut += payout;
    gameStats.totalWon += Math.max(0, payout);
    gameStats.totalLost += Math.max(0, bet);
    gameStats.netPnL += net;
    if (net > 0) gameStats.wins += 1;
    else gameStats.losses += 1;
    player.byGame[game] = gameStats;
    stats.set(receipt.playerId, player);
  }
  return stats;
}

function buildAdminGameAnalytics(wallets) {
  const byGame = {};
  for (const receipt of wallets.gameHistory || []) {
    const game = receipt.game || 'game';
    const item = byGame[game] || { game, totalPlayersToDate: 0, totalGamesPlayed: 0, totalBetAmount: 0, totalPaidOutAmount: 0, houseProfitToDate: 0, houseLossesToDate: 0, netHouseProfit: 0, averageProfitPerGame: 0, _players: new Set() };
    const bet = finance.money(receipt.bet);
    const payout = finance.money(receipt.payout);
    item.totalGamesPlayed += 1;
    item.totalBetAmount += bet;
    item.totalPaidOutAmount += payout;
    if (receipt.playerId) item._players.add(receipt.playerId);
    byGame[game] = item;
  }
  for (const item of Object.values(byGame)) {
    item.totalPlayersToDate = item._players.size;
    item.netHouseProfit = item.totalBetAmount - item.totalPaidOutAmount;
    item.houseProfitToDate = Math.max(0, item.netHouseProfit);
    item.houseLossesToDate = Math.max(0, -item.netHouseProfit);
    item.averageProfitPerGame = item.totalGamesPlayed ? Math.round((item.netHouseProfit / item.totalGamesPlayed) * 100) / 100 : 0;
    delete item._players;
  }
  return { byGame: Object.values(byGame).sort((a, b) => b.totalGamesPlayed - a.totalGamesPlayed) };
}

function filterAdminAuditForSession(wallets, session) {
  const all = (wallets.adminAudit || []).slice(0, 200);
  if (!session) return [];
  if (adminHasPermission(session, 'audit_all')) return all;
  if (adminHasPermission(session, 'audit_senior')) return all.filter(entry => entry.role !== 'master' && entry.role !== 'unknown');
  return [];
}

function filterAuditEventsForSession(wallets, session) {
  rotateAuditLog(wallets);
  const all = (wallets.auditLog || []).slice(0, 500);
  if (!session) return [];
  if (adminHasPermission(session, 'audit_all')) return all;
  if (adminHasPermission(session, 'audit_senior')) {
    return all.filter(entry =>
      !(entry.category === 'admin' && ['master', 'unknown'].includes(entry.actorRole)) &&
      entry.event !== 'dividend_withdrawal' &&
      !(entry.details && isSensitiveFinanceAccount(entry.details.account))
    );
  }
  return [];
}

function publicSupportRequestsForSession(wallets, session) {
  const all = (wallets.supportRequests || []).slice(0, 200);
  if (!session) return [];
  const canSeeAll = session.role === 'master' || adminHasPermission(session, 'manage_admins');
  return all
    .filter(request => canSeeAll || request.assignedAdminId === session.adminId)
    .map(request => ({
      id: request.id,
      status: request.status || 'open',
      source: request.source || '',
      playerId: request.playerId || '',
      playerName: request.playerName || request.telegramName || '',
      playerPhone: request.playerPhone || '',
      balance: finance.money(request.balance || 0),
      telegramId: request.telegramId || '',
      telegramUsername: request.telegramUsername || '',
      message: request.message || '',
      assignedAdminId: request.assignedAdminId || '',
      assignedAdminName: request.assignedAdminName || '',
      assignmentStatus: request.assignmentStatus || '',
      createdAt: request.createdAt || request.time || '',
      updatedAt: request.updatedAt || '',
    }));
}

const SENIOR_VISIBLE_ACCOUNTS = new Set([
  'prizeVault',
  'bingoPrizeVault',
  'kenoPrizeVault',
  'roulettePrizeVault',
  'crashVault',
]);

function publicCompanyForSession(wallets, session) {
  const company = wallets.company || {};
  if (adminHasPermission(session, 'audit_all')) return company;
  const accounts = {};
  for (const [key, value] of Object.entries(company.accounts || {})) {
    if (SENIOR_VISIBLE_ACCOUNTS.has(key)) accounts[key] = value;
  }
  return {
    accounts,
    totalPaidOut: company.totalPaidOut || 0,
    transactions: [],
  };
}

function publicFinanceSummaryForSession(summary = {}, session) {
  if (adminHasPermission(session, 'audit_all')) return summary;
  const labels = {};
  for (const [key, label] of Object.entries(summary.accountLabels || {})) {
    if (SENIOR_VISIBLE_ACCOUNTS.has(key)) labels[key] = label;
  }
  return { ...summary, accountLabels: labels };
}

function publicTransactionsForSession(wallets, session) {
  const rows = (wallets.company.transactions || []).slice(0, 200);
  if (adminHasPermission(session, 'audit_all')) return rows;
  return rows.filter(txn => {
    const type = String(txn.type || '').toLowerCase();
    const from = String(txn.from || '').toLowerCase();
    const to = String(txn.to || '').toLowerCase();
    const desc = String(txn.desc || '').toLowerCase();
    return !type.includes('commission') &&
      !type.includes('dividend') &&
      !from.includes('commission') &&
      !from.includes('housewin') &&
      !from.includes('operating') &&
      !to.includes('commission') &&
      !to.includes('housewin') &&
      !to.includes('operating') &&
      !desc.includes('commission') &&
      !desc.includes('house win') &&
      !desc.includes('dividend');
  });
}

function requestVisibleToAdminSession(request, session) {
  if (!session) return false;
  if (session.role === 'master' || adminHasPermission(session, 'audit_all')) return true;
  if (request.type === 'withdraw') return request.assignedWithdrawAdminId === session.adminId;
  if (request.type === 'deposit') {
    if (!request.depositAccountOwnerAdminId) return true;
    return request.depositAccountOwnerAdminId === session.adminId;
  }
  return true;
}

function getAdminData(socket = null) {
  const wallets = loadWallets();
  const expiredDepositCount = expirePendingDepositRequests(wallets);
  const referralCodesChanged = ensureAdminReferralCodes(wallets);
  if (expiredDepositCount > 0 || referralCodesChanged) saveWallets(wallets);
  const session = socket ? adminSession(socket) : null;
  const playerStats = buildAdminPlayerStats(wallets);
  const playerList = Object.entries(wallets.players).map(([id, w]) => ({
    ...publicWallet(id, w),
    phone: w.phone || '',
    totalPlayed: playerStats.get(id)?.totalBet || ((w.totalWon || 0) + (w.totalLost || 0)),
    netPnL: playerStats.get(id)?.netPnL || ((w.totalWon || 0) - (w.totalLost || 0)),
    adminStats: playerStats.get(id) || null,
    suspended: isSuspended(wallets, id),
    suspension: publicSuspension(wallets, id),
    createdAt: w.createdAt || '',
    referredByAdminId: w.referredByAdminId || '',
    referralCode: w.referralCode || '',
    referredAt: w.referredAt || '',
    referredByAdminName: w.referredByAdminId ? adminDisplayName(wallets, w.referredByAdminId) : '',
  }));
  playerList.sort((a, b) => b.balance - a.balance);
  const gameSummary = getBingoRoomList(wallets).map(r => ({ game: 'bingo', bet: r.bet, status: r.status, playerCount: r.players.length, calledCount: r.calledNumbers.length, pot: r.escrowPot || r.players.length * r.bet, players: r.players.map(p => ({ playerId: p.playerId, name: p.name, cartelaId: p.cartelaId })) }));
  const requests = (wallets.requests || [])
    .filter(request => requestVisibleToAdminSession(request, session))
    .slice()
    .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 100)
    .map(publicRequest);
  const transactions = publicTransactionsForSession(wallets, session);
  const adminAudit = filterAdminAuditForSession(wallets, session);
  const auditEvents = filterAuditEventsForSession(wallets, session);
  const gameHistory = (wallets.gameHistory || []).slice(0, 200).map(receipt => publicReceipt(receipt, true));
  const paymentSmsInbox = (wallets.paymentSmsInbox || []).slice(0, 100).map(item => ({
    id: item.id,
    sender: item.sender,
    status: item.status,
    receivedAt: item.receivedAt,
    createdAt: item.createdAt,
    parsed: item.parsed || {},
    matchReason: item.matchReason || '',
    matchedRequestId: item.matchedRequestId || '',
    matchedPlayerId: item.matchedPlayerId || '',
    message: item.message,
  }));
  const financeHealth = finance.financeHealth(wallets);
  const currentAdmin = session ? { id: session.adminId, username: session.username, name: session.name, phone: wallets.adminUsers?.[session.adminId]?.phone || '', role: session.role, roleLabel: ADMIN_ROLES[session.role] || session.role, permissions: Array.from(ROLE_PERMISSIONS[session.role] || []), mustChangePassword: !!session.mustChangePassword, telegramChatId: wallets.adminUsers?.[session.adminId]?.telegramChatId || '', telegramUsername: wallets.adminUsers?.[session.adminId]?.telegramUsername || '', mustConnectTelegram: !!wallets.adminUsers?.[session.adminId]?.mustConnectTelegram, freePlayActive: !!wallets.adminUsers?.[session.adminId]?.freePlayActive, withdrawalFloatBalance: finance.money(wallets.adminUsers?.[session.adminId]?.withdrawalFloatBalance || 0), referralCode: wallets.adminUsers?.[session.adminId]?.referralCode || '', referralLink: referralLinkForCode(wallets.adminUsers?.[session.adminId]?.referralCode || '', wallets), referralActive: wallets.adminUsers?.[session.adminId]?.referralActive !== false } : null;
  const adminUsers = session && adminHasPermission(session, 'manage_admins')
    ? Object.values(wallets.adminUsers || {})
      .filter(admin => !admin.deleted)
      .map(admin => publicAdminUser({
        ...admin,
        depositAccountCount: activeDepositAccountCountForOwner(wallets, admin.id),
      }, wallets))
      .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))
    : [];
  const rouletteActivePlayers = new Set(Object.values(rouletteState.bets).map(b => b.playerId)).size;
  const rouletteBetCount = Object.keys(rouletteState.bets).length;
  const activeGameCount = gameSummary.filter(g => ['countdown', 'playing', 'paused'].includes(g.status)).length
    + (crashState.status === 'running' ? 1 : 0)
    + (rouletteActivePlayers > 0 || ['spinning', 'result'].includes(rouletteState.status) ? 1 : 0);
  return { company: publicCompanyForSession(wallets, session), finance: publicFinanceSummaryForSession(financeHealth.summary, session), financeIssues: financeHealth.issues, database: safeWalletStoreInfo(), configWarnings: systemWarnings(wallets), currentAdmin, adminRoles: ADMIN_ROLES, adminUsers, adminFloatSummary: publicAdminFloatSummary(wallets, session), adminCashStatements: publicAdminCashStatements(wallets, session), referralPerformance: adminHasPermission(session, 'analytics') ? buildReferralPerformance(wallets, session) : [], players: playerList, requests, supportRequests: publicSupportRequestsForSession(wallets, session), depositAccounts: depositAccountStats(wallets), games: gameSummary, transactions, adminAudit, auditEvents, auditRetentionDays: AUDIT_LIVE_DAYS, auditArchiveDays: Object.keys(wallets.auditArchive || {}).length, analytics: adminHasPermission(session, 'analytics') ? buildAdminGameAnalytics(wallets) : null, gameHistory, paymentSmsInbox, telegramSettings: publicTelegramSettings(wallets), policies: publicPolicySettings(wallets), gameSettings: publicGameSettings(wallets), totalPlayers: playerList.length, activeGames: activeGameCount, suspendedPlayers: wallets.suspendedPlayers || {}, config: { ...runtimeConfig }, crash: { status: crashState.status, roundNumber: crashState.roundNumber, currentMultiplier: crashState.currentMultiplier, totalBets: Object.values(crashState.bets).reduce((s,b)=>s+b.amount,0), activeBets: Object.values(crashState.bets).filter(b=>!b.cashedOut).length, crashVault: crashState.crashVaultBalance, maxRoundPayout: crashState.maxRoundPayout, maxPayoutVaultShare: CRASH_MAX_PAYOUT_VAULT_SHARE }, roulette: { status: rouletteState.status, roundNumber: rouletteState.roundNumber, totalBets: Object.values(rouletteState.bets).reduce((s,b)=>s+b.amount,0), playerCount: rouletteActivePlayers, betCount: rouletteBetCount, winningNumber: rouletteState.winningNumber } };
}

function emitAdminDataToAll() {
  for (const adminId of adminSockets) {
    const adminSocket = io.sockets.sockets.get(adminId);
    if (adminSocket) adminSocket.emit('adminData', getAdminData(adminSocket));
  }
}

function localDateParts(date = new Date(), timeZone = REPORT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);
  const data = {};
  for (const part of parts) {
    if (part.type !== 'literal') data[part.type] = part.value;
  }
  return {
    key: `${data.year}-${data.month}-${data.day}`,
    hour: Number(data.hour),
    minute: Number(data.minute),
    weekday: data.weekday,
  };
}

function localDateKey(date = new Date()) {
  return localDateParts(date).key;
}

function recentLocalDateKeys(days) {
  const keys = [];
  const now = Date.now();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    keys.push(localDateKey(new Date(now - offset * 24 * 60 * 60 * 1000)));
  }
  return new Set(keys);
}

function eventLocalDateKey(event = {}) {
  const when = new Date(event.time || event.createdAt || Date.now());
  return localDateKey(Number.isNaN(when.getTime()) ? new Date() : when);
}

function normalizeAuditEvent(entry = {}) {
  return {
    id: entry.id || fairRng.randomId('aud_evt'),
    time: entry.time || new Date().toISOString(),
    category: String(entry.category || 'system').slice(0, 40),
    event: String(entry.event || entry.type || 'event').slice(0, 80),
    actorType: String(entry.actorType || 'system').slice(0, 40),
    actorId: String(entry.actorId || '').slice(0, 120),
    actorName: String(entry.actorName || '').slice(0, 120),
    actorRole: String(entry.actorRole || '').slice(0, 40),
    playerId: String(entry.playerId || '').slice(0, 120),
    playerName: String(entry.playerName || '').slice(0, 120),
    game: String(entry.game || '').slice(0, 40),
    amount: finance.money(entry.amount || 0),
    status: String(entry.status || '').slice(0, 40),
    details: entry.details && typeof entry.details === 'object' ? entry.details : {},
  };
}

function rotateAuditLog(wallets) {
  if (!wallets) return;
  if (!wallets.auditLog) wallets.auditLog = [];
  if (!wallets.auditArchive) wallets.auditArchive = {};
  if (!wallets.auditState) wallets.auditState = {};
  const liveKeys = recentLocalDateKeys(AUDIT_LIVE_DAYS);
  const live = [];
  for (const rawEvent of wallets.auditLog || []) {
    const event = normalizeAuditEvent(rawEvent);
    const key = eventLocalDateKey(event);
    if (liveKeys.has(key)) {
      live.push(event);
    } else {
      if (!wallets.auditArchive[key]) wallets.auditArchive[key] = [];
      wallets.auditArchive[key].push(event);
    }
  }
  wallets.auditLog = live.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  const archiveKeys = Object.keys(wallets.auditArchive).sort();
  for (const key of archiveKeys) {
    const rows = Array.isArray(wallets.auditArchive[key]) ? wallets.auditArchive[key] : [];
    wallets.auditArchive[key] = rows
      .map(normalizeAuditEvent)
      .sort((a, b) => String(b.time).localeCompare(String(a.time)))
      .slice(0, 20000);
  }
  for (const oldKey of archiveKeys.slice(0, Math.max(0, archiveKeys.length - 370))) {
    delete wallets.auditArchive[oldKey];
  }
  wallets.auditState.liveRetentionDays = AUDIT_LIVE_DAYS;
  wallets.auditState.archiveDays = Object.keys(wallets.auditArchive).length;
}

function recordAuditEvent(wallets, entry = {}) {
  if (!wallets.auditLog) wallets.auditLog = [];
  if (!wallets.auditArchive) wallets.auditArchive = {};
  const event = normalizeAuditEvent(entry);
  wallets.auditLog.unshift(event);
  rotateAuditLog(wallets);
  return event;
}

function createAccountingReport(wallets, period = 'daily') {
  const keys = period === 'weekly' ? recentLocalDateKeys(7) : new Set([localDateKey()]);
  const title = period === 'weekly' ? 'Weekly accounting report' : 'Daily accounting report';
  const gameNames = ['bingo', 'keno', 'roulette', 'crash', 'dino', 'hilo'];
  const byGame = Object.fromEntries(gameNames.map(game => [game, { entries: 0, bet: 0, payout: 0, net: 0 }]));
  let totalEntries = 0;
  let totalBet = 0;
  let totalPayout = 0;

  for (const receipt of wallets.gameHistory || []) {
    if (!keys.has(localDateKey(new Date(receipt.time || receipt.createdAt || Date.now())))) continue;
    const game = String(receipt.game || 'other').toLowerCase();
    if (!byGame[game]) byGame[game] = { entries: 0, bet: 0, payout: 0, net: 0 };
    const bet = finance.money(receipt.bet);
    const payout = finance.money(receipt.payout);
    byGame[game].entries += 1;
    byGame[game].bet += bet;
    byGame[game].payout += payout;
    byGame[game].net += bet - payout;
    totalEntries += 1;
    totalBet += bet;
    totalPayout += payout;
  }

  let deposits = 0;
  let paidWithdrawals = 0;
  for (const request of wallets.requests || []) {
    const dateValue = request.resolvedAt || request.createdAt;
    if (!keys.has(localDateKey(new Date(dateValue || Date.now())))) continue;
    if (request.type === 'deposit' && ['approved', 'approved_auto', 'approved_manual'].includes(request.status)) deposits += finance.money(request.amount);
    if (request.type === 'withdraw' && request.status === 'approved') paidWithdrawals += finance.money(request.amount);
  }

  const accounts = finance.ensureFinance(wallets);
  const gameLines = Object.entries(byGame)
    .filter(([, row]) => row.entries || row.bet || row.payout)
    .map(([game, row]) => `- ${game.toUpperCase()}: ${row.entries} entries | bets ${formatEtb(row.bet)} | payouts ${formatEtb(row.payout)} | net ${formatEtb(row.net)}`);

  return [
    `HabeshaBingo ${title}`,
    `Period: ${Array.from(keys).join(' to ')}`,
    '',
    `Net game result: ${formatEtb(totalBet - totalPayout)}`,
    `Total players: ${Object.keys(wallets.players || {}).length}`,
    `Game entries: ${totalEntries}`,
    `Deposits confirmed: ${formatEtb(deposits)}`,
    `Withdrawals paid: ${formatEtb(paidWithdrawals)}`,
    '',
    'By game:',
    ...(gameLines.length ? gameLines : ['- No game activity in this period.']),
    '',
    'Vault snapshot:',
    `- Bingo prize vault: ${formatEtb(accounts.bingoPrizeVault)}`,
    `- Keno prize vault: ${formatEtb(accounts.kenoPrizeVault)}`,
    `- Roulette prize vault: ${formatEtb(accounts.roulettePrizeVault)}`,
    `- Legacy shared reserve: ${formatEtb(accounts.prizeVault)}`,
    `- Player wallet pool: ${formatEtb(accounts.playerLiability)}`,
    `- Commission: ${formatEtb(accounts.commission)}`,
    `- Pending withdrawals: ${formatEtb(accounts.withdrawals)}`,
  ].join('\n');
}

function maybeSendScheduledReports() {
  const parts = localDateParts();
  const wallets = loadWallets();
  if (!wallets.notificationState) wallets.notificationState = {};
  let changed = false;
  if ((parts.hour > 22 || (parts.hour === 22 && parts.minute >= 0)) && wallets.notificationState.lastDailyReportKey !== parts.key) {
    notifySeniorAndMasterAdmins(wallets, createAccountingReport(wallets, 'daily'));
    wallets.notificationState.lastDailyReportKey = parts.key;
    changed = true;
  }
  if (parts.weekday === 'Fri' && (parts.hour > 19 || (parts.hour === 19 && parts.minute >= 0)) && wallets.notificationState.lastWeeklyReportKey !== parts.key) {
    notifySeniorAndMasterAdmins(wallets, createAccountingReport(wallets, 'weekly'));
    wallets.notificationState.lastWeeklyReportKey = parts.key;
    changed = true;
  }
  if (changed) saveWallets(wallets);
}

function startAccountingReportScheduler() {
  setInterval(() => {
    try {
      maybeSendScheduledReports();
    } catch (error) {
      console.error('Accounting report scheduler error:', error.message);
    }
  }, 60 * 1000);
}

// ──────────────────────────────────────
// SOCKET.IO
// ──────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 ${socket.id}`);
  socket.emit('roomCounts', getAllRoomCounts());
  socket.on('getRoomCounts', () => socket.emit('roomCounts', getAllRoomCounts()));

  // ── PLAYER PROFILE ──
  socket.on('registerAccount', (payload = {}) => {
    if (!allowSocketAction(socket, 'auth-register', 5, 5 * 60 * 1000, 'Too many registration attempts. Try again shortly.')) return;
    const wallets = loadWallets();
    const telegram = payload.telegram;
    const result = telegram?.id
      ? linkTelegramAccount(wallets, {
          telegramId: telegram.id,
          username: telegram.username || '',
          firstName: telegram.firstName || payload.name || '',
          name: payload.name || telegram.firstName || '',
          phone: payload.phone,
          pin: payload.pin,
          ageConfirmed: payload.ageConfirmed,
          policyAccepted: payload.policyAccepted,
          referralCode: payload.referralCode,
        })
      : createAccount(wallets, payload || {});
    if (result.error) { socket.emit('authResult', { success: false, message: result.error }); return; }
    socket.data.playerId = result.id;
    saveWallets(wallets);
    emitAdminDataToAll();
    notifyPlayerRegistered(wallets, result.id, result.wallet, { existing: !!result.existing, source: telegram?.id ? 'telegram_mini_app' : 'mini_app' });
    const source = telegram?.id ? (result.existing ? 'telegram_link' : 'telegram_register') : 'register';
    socket.emit('authResult', { success: true, account: publicWallet(result.id, result.wallet), sessionToken: issuePlayerSession(result.id), source });
    if (!result.existing) {
      const promoAmount = finance.money(result.wallet.signupPromoAmount || result.wallet.signupPromoLockedBalance || 0);
      if (promoAmount > 0) {
        socket.emit('notification', {
          type: 'success',
          message: `${formatEtb(promoAmount)} starter credit added. It is playable, not withdrawable, and returns first after wins or deposits while your balance stays at least ${formatEtb(50)}.`,
        });
      }
    }
  });

  socket.on('loginAccount', (payload = {}) => { if (isPlayerLoginRateLimited(socket, payload.login)) { socket.emit('authResult', { success: false, message: 'Too many login attempts. Try again in a few minutes.' }); return; } const wallets = loadWallets(); const result = loginAccount(wallets, payload || {}); if (result.error) { socket.emit('authResult', { success: false, message: result.error }); return; } clearPlayerLoginRateLimit(socket, payload.login); socket.data.playerId = result.id; saveWallets(wallets); socket.emit('authResult', { success: true, account: publicWallet(result.id, result.wallet), sessionToken: issuePlayerSession(result.id) }); });

  socket.on('telegramAuth', ({ initData, explicit, loginSource, referralCode } = {}) => {
    const botToken = getTelegramSettings().botToken;
    console.log('TELEGRAM_AUTH_ATTEMPT:', 'explicit:', !!explicit, 'initDataLen:', String(initData||'').length);
    const verified = verifyTelegramInitData(initData, botToken);
    if (!verified.ok) {
      console.log('TELEGRAM_AUTH_FAIL:', verified.error, 'botToken exists:', !!botToken, 'initData preview:', String(initData||'').slice(0, 80));
      socket.emit('telegramAuthResult', { success: false, message: verified.error }); return;
    }
    console.log('TELEGRAM_AUTH_SUCCESS:', 'userId:', verified.user.id, 'username:', verified.user.username);
    const wallets = loadWallets();
    const match = findWalletByTelegram(wallets, verified.user.id);
    if (match) {
      const logoutSource = match[1].telegramLogoutSource || '';
      if (match[1].telegramAutoLoginDisabled && !explicit) {
        socket.emit('telegramAuthResult', {
          success: true,
          loggedOut: true,
          message: 'You are logged out. Press Login with Telegram to enter again.',
          telegram: verified.user,
        });
        return;
      }
      if (match[1].telegramAutoLoginDisabled && logoutSource === 'bot' && loginSource !== 'bot') {
        socket.emit('telegramAuthResult', {
          success: true,
          loggedOut: true,
          message: 'This Telegram account is logged out from the bot. Open the bot and press Login first.',
          telegram: verified.user,
        });
        return;
      }
      socket.data.playerId = match[0];
      assignPlayerReferral(wallets, match[0], match[1], referralCode, explicit ? 'telegram_explicit_login' : 'telegram_auto_login');
      if (explicit && match[1].telegramAutoLoginDisabled) {
        match[1].telegramAutoLoginDisabled = false;
        match[1].telegramLogoutSource = '';
        match[1].telegramLoggedOutAt = '';
      }
      recordAuditEvent(wallets, {
        category: 'account',
        event: 'telegram_auto_login',
        actorType: 'player',
        actorId: match[0],
        actorName: match[1].name || '',
        playerId: match[0],
        playerName: match[1].name || '',
        status: 'success',
        details: { telegramId: String(verified.user.id || ''), username: verified.user.username || '' },
      });
      saveWallets(wallets);
      socket.emit('authResult', { success: true, account: publicWallet(match[0], match[1]), sessionToken: issuePlayerSession(match[0]), source: 'telegram' });
      return;
    }
    socket.emit('telegramAuthResult', { success: true, needsRegistration: true, telegram: verified.user });
  });

  socket.on('playerLogout', (payload = {}, ack) => {
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) {
      if (typeof ack === 'function') ack({ success: false, message: auth.error });
      return;
    }
    const { id, wallet } = auth;
    wallet.sessionToken = '';
    wallet.sessionExpiresAt = 0;
    wallet.currentSocketId = null;
    if (wallet.telegramId) {
      wallet.telegramAutoLoginDisabled = true;
      wallet.telegramLogoutSource = payload.source || 'mini_app';
      wallet.telegramLoggedOutAt = new Date().toISOString();
    }
    socket.data.playerId = '';
    recordAuditEvent(wallets, {
      category: 'account',
      event: 'account_logout',
      actorType: 'player',
      actorId: id,
      actorName: wallet.name || '',
      playerId: id,
      playerName: wallet.name || '',
      status: 'success',
      details: { source: payload.source || 'mini_app', telegramAutoLoginDisabled: !!wallet.telegramId },
    });
    saveWallets(wallets);
    if (typeof ack === 'function') ack({ success: true });
  });

  socket.on('getProfile', (payload = {}) => {
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('authResult', { success: false, message: auth.error }); return; }
    const { id, wallet } = auth;
    socket.emit('profileData', { ...publicWallet(id, wallet), receipts: getPlayerReceipts(wallets, id) });
  });

  socket.on('getGameReceipts', (payload = {}) => {
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('authResult', { success: false, message: auth.error }); return; }
    socket.emit('gameReceipts', { receipts: getPlayerReceipts(wallets, auth.id) });
  });

  socket.on('getPlayerHistory', (payload = {}) => {
    const wallets = loadWallets();
    const expiredDepositCount = expirePendingDepositRequests(wallets);
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('authResult', { success: false, message: auth.error }); return; }
    if (expiredDepositCount > 0) saveWallets(wallets);
    socket.emit('playerHistory', buildPlayerHistory(wallets, auth.id));
  });

  socket.on('getWalletRequests', (payload = {}) => { const wallets = loadWallets(); const expiredDepositCount = expirePendingDepositRequests(wallets); const auth = authenticatePlayer(wallets, payload, socket); if (auth.error) { socket.emit('authResult', { success: false, message: auth.error }); return; } if (expiredDepositCount > 0) saveWallets(wallets); socket.emit('walletRequests', { requests: getPlayerRequests(wallets, auth.id) }); });

  socket.on('createDepositRequest', (payload = {}) => {
    if (!allowSocketAction(socket, 'wallet-request', 8, 60 * 1000)) return;
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('walletRequestResult', { success: false, message: auth.error }); return; }
    const { id, wallet } = auth;
    const result = createDepositRequest(wallets, id, wallet, payload, 'mini_app');
    if (result.error) { socket.emit('walletRequestResult', { success: false, message: result.error }); return; }
    saveWallets(wallets);
    socket.emit('walletRequestResult', { success: true, message: 'Deposit request created. Pay to the Telebirr account shown below. Once confirmed, your game wallet is credited automatically and usually immediately.', request: publicRequest(result.request), account: publicWallet(id, wallet), requests: getPlayerRequests(wallets, id) });
    if (!result.existing) notifyDepositRequest(wallets, wallet, result.request);
    emitAdminDataToAll();
  });

  socket.on('createWithdrawRequest', (payload = {}) => {
    if (!allowSocketAction(socket, 'wallet-request', 8, 60 * 1000)) return;
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('walletRequestResult', { success: false, message: auth.error }); return; }
    const { id, wallet } = auth;
    const result = createWithdrawRequest(wallets, id, wallet, payload, 'mini_app');
    if (result.error) { socket.emit('walletRequestResult', { success: false, message: result.error }); return; }
    saveWallets(wallets);
    socket.emit('walletRequestResult', { success: true, message: 'Withdrawal request sent. Funds reserved.', request: publicRequest(result.request), account: publicWallet(id, wallet), requests: getPlayerRequests(wallets, id) });
    notifyWithdrawalRequest(wallets, wallet, result.request);
    io.emit('balanceUpdate', publicWallet(id, wallet));
    emitAdminDataToAll();
  });

  socket.on('changePin', (payload = {}) => {
    if (!allowSocketAction(socket, 'change-pin', 5, 60 * 1000)) return;
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('pinChangeResult', { success: false, message: auth.error }); return; }
    const oldPin = normalizePin(payload.oldPin);
    const newPin = normalizePin(payload.newPin);
    if (!verifyPin(auth.wallet, oldPin)) { socket.emit('pinChangeResult', { success: false, message: 'Current PIN is wrong.' }); return; }
    if (!/^\d{4}$/.test(newPin)) { socket.emit('pinChangeResult', { success: false, message: 'New PIN must be exactly 4 digits.' }); return; }
    auth.wallet.pinHash = hashPin(newPin);
    delete auth.wallet.pin;
    auth.wallet.mustChangePin = false;
    auth.wallet.pinChangedAt = new Date().toISOString();
    saveWallets(wallets);
    socket.emit('pinChangeResult', { success: true, message: 'PIN changed.', account: publicWallet(auth.id, auth.wallet) });
  });

  socket.on('playKeno', (payload = {}) => {
    if (!allowSocketAction(socket, 'keno-play', 20, 60 * 1000)) return;
    const betAmount = parseInt(payload.bet, 10);
    const wallets = loadWallets();
    const kenoSettingsChanged = activatePendingGameSettings(wallets, 'keno', 'keno_round_start');
    if (kenoSettingsChanged) saveWallets(wallets);
    const kenoSettings = activeGameSettings(wallets, 'keno');
    const betValidation = kenoLogic.validateKenoBet(betAmount, kenoSettings);
    if (betValidation.error) { socket.emit('kenoResult', { success: false, message: betValidation.error }); return; }
    const validated = kenoLogic.validateKenoPicks(payload.picks, kenoSettings);
    if (validated.error) { socket.emit('kenoResult', { success: false, message: validated.error }); return; }
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('kenoResult', { success: false, message: auth.error }); return; }
    const { id: playerKey, wallet } = auth;
    if (isSuspended(wallets, playerKey)) { socket.emit('kenoResult', { success: false, message: suspensionMessage(wallets, playerKey) }); return; }
    const freePlayAdmin = adminFreePlayForWallet(wallets, playerKey, wallet);
    const freePlay = !!freePlayAdmin;
    if (!freePlay && wallet.balance < betAmount) { socket.emit('kenoResult', { success: false, message: `Insufficient balance! ${wallet.balance} ETB, need ${betAmount}.` }); return; }
    const kenoVault = gamePrizeVault('keno');
    const maxPayout = kenoLogic.maxKenoPayout(validated.picks.length, betAmount, kenoSettings);
    const availableKenoVault = finance.money(wallets.company.accounts[kenoVault]);
    if (!freePlay && ENFORCE_KENO_VAULT_CHECK && maxPayout > availableKenoVault) {
      socket.emit('kenoResult', {
        success: false,
        code: 'KENO_VAULT_LOW',
        message: `Keno is temporarily unavailable for ${validated.picks.length} picks. Admin must fund the Keno Prize Vault.`,
        requiredVault: Math.max(0, maxPayout - availableKenoVault),
        currentVault: finance.money(wallets.company.accounts[kenoVault]),
      });
      return;
    }

    if (!freePlay) {
      const stake = finance.debitPlayerToAccount(wallets, playerKey, wallet, 'gameEscrow', betAmount, `Keno stake from ${wallet.name}`, 'keno_stake', { game: 'keno', picks: validated.picks.length, escrow: 'gameEscrow' });
      if (stake.error) { socket.emit('kenoResult', { success: false, message: stake.error }); return; }
      wallet.totalLost = (wallet.totalLost || 0) + betAmount;
      wallet.gamesPlayed = (wallet.gamesPlayed || 0) + 1;
    }

    const roundId = makeReceiptId('keno_round');
    const { drawn, proof } = kenoLogic.drawKenoRound(roundId);
    const result = kenoLogic.calculateKenoResult(validated.picks, drawn, betAmount, kenoSettings);
    const kenoHouseVault = gameHouseWinVault('keno');

    if (freePlay) {
      recordAuditEvent(wallets, {
        category: 'admin',
        type: 'admin_free_play_round',
        status: 'completed',
        actorType: 'admin',
        actorId: freePlayAdmin.id,
        actorName: freePlayAdmin.name || freePlayAdmin.username || '',
        targetType: 'player',
        targetId: playerKey,
        targetName: wallet.name,
        amount: betAmount,
        game: 'keno',
        details: { roundId, picks: validated.picks, drawn, matches: result.matches, matchCount: result.matchCount, payout: result.payout },
      });
      saveWallets(wallets);
      socket.emit('kenoResult', { success: true, freePlay: true, roundId, bet: betAmount, picks: validated.picks, drawn, proof, ...result, balance: wallet.balance, account: publicWallet(playerKey, wallet), receipt: null });
      return;
    }

    if (result.payout > 0) {
      const payout = finance.accountToPlayer(wallets, kenoVault, playerKey, wallet, result.payout, `Keno payout to ${wallet.name}`, 'keno_payout', { game: 'keno', picks: validated.picks.length, matches: result.matchCount, vault: kenoVault });
      if (payout.error) {
        const refunded = finance.accountToPlayer(wallets, 'gameEscrow', playerKey, wallet, betAmount, `Keno stake refunded after payout failure for ${wallet.name}`, 'keno_stake_refund', { game: 'keno', roundId, reason: payout.error });
        if (!refunded.error) {
          wallet.totalLost = Math.max(0, (wallet.totalLost || 0) - betAmount);
          wallet.gamesPlayed = Math.max(0, (wallet.gamesPlayed || 0) - 1);
          saveWallets(wallets);
          io.emit('balanceUpdate', publicWallet(playerKey, wallet));
        }
        socket.emit('kenoResult', { success: false, message: `Keno Prize Vault cannot cover this payout yet: ${payout.error}` });
        return;
      }
      const promoReclaim = reclaimSignupPromoAfterWin(wallets, playerKey, wallet, result.payout, 'keno', { roundId, picks: validated.picks.length, matches: result.matchCount });
      result.promoReclaim = finance.money(promoReclaim.reclaimed || 0);
      wallet.totalWon = (wallet.totalWon || 0) + result.payout;
      wallet.wins = (wallet.wins || 0) + 1;
    }
    const house = finance.accountTransfer(wallets, 'gameEscrow', kenoHouseVault, betAmount, `Keno house win from ${wallet.name}`, 'keno_house_win', { game: 'keno', roundId, picks: validated.picks.length, vault: kenoHouseVault });
    if (house.error) { socket.emit('kenoResult', { success: false, message: house.error }); return; }
    wallets.company.totalCommission += betAmount;

    const receipt = recordGameHistory(wallets, {
      game: 'keno',
      playerId: playerKey,
      playerName: wallet.name,
      bet: betAmount,
      payout: result.payout,
      status: result.payout > 0 ? 'won' : 'lost',
      details: {
        roundId,
        picks: validated.picks,
        drawn,
        matches: result.matches,
        matchCount: result.matchCount,
        promoReclaim: finance.money(result.promoReclaim || 0),
        multiplier: result.multiplier,
        houseWin: betAmount,
        houseWinVault: kenoHouseVault,
        telegramWinNotified: false,
        proof,
      },
    });
    saveWallets(wallets);
    socket.emit('kenoResult', { success: true, roundId, bet: betAmount, picks: validated.picks, drawn, proof, ...result, balance: wallet.balance, account: publicWallet(playerKey, wallet), receipt: publicReceipt(receipt, true) });
    io.emit('balanceUpdate', publicWallet(playerKey, wallet));
    broadcastCounts();
  });

  socket.on('kenoRevealComplete', (payload = {}) => {
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) return;
    const receiptId = String(payload.receiptId || '').trim();
    const roundId = String(payload.roundId || '').trim();
    const receipt = (wallets.gameHistory || []).find(item =>
      item.playerId === auth.id &&
      item.game === 'keno' &&
      item.status === 'won' &&
      ((receiptId && item.id === receiptId) || (roundId && item.details?.roundId === roundId))
    );
    if (!receipt || receipt.details?.telegramWinNotified) return;
    receipt.details = { ...(receipt.details || {}), telegramWinNotified: true, telegramWinNotifiedAt: new Date().toISOString() };
    notifyPlayerWin(wallets, auth.id, auth.wallet, 'keno', receipt.payout, { round: receipt.details.roundId || receipt.id });
    saveWallets(wallets);
  });

  socket.on('adminForgotPasswordRequest', ({ username, phone }) => {
    const cleanUsername = normalizeAdminLogin(username);
    const cleanPhone = normalizePhone(phone);
    if (!cleanUsername || !cleanPhone) {
      socket.emit('notification', { type: 'error', message: 'Enter username and phone number.' });
      return;
    }
    const wallets = loadWallets();
    const match = Object.values(wallets.adminUsers || {}).find(admin =>
      !admin.deleted &&
      normalizeAdminLogin(admin.username) === cleanUsername &&
      admin.phone === cleanPhone
    );
    const requestedAt = new Date().toISOString();
    recordAuditEvent(wallets, {
      time: requestedAt,
      category: 'admin',
      event: 'admin_password_reset_requested',
      actorType: 'admin',
      actorName: cleanUsername,
      actorRole: match?.role || '',
      status: match ? 'matched' : 'unmatched',
      details: { username: cleanUsername, phone: cleanPhone, adminId: match?.id || '' },
    });
    if (match) {
      notifyMasterAdmins(wallets, `Admin password reset requested\n\nAdmin: ${match.name} (${match.role})\nUsername: ${match.username}\nPhone: ${match.phone}\nRequested at: ${requestedAt}\n\nOpen Admins tab and reset this admin password.`);
      socket.emit('notification', { type: 'success', message: 'Password reset request sent to Master Admin.' });
    } else {
      notifyMasterAdmins(wallets, `Unmatched admin password reset attempt\n\nUsername: ${cleanUsername}\nPhone: ${cleanPhone}\nRequested at: ${requestedAt}`);
      socket.emit('notification', { type: 'warning', message: 'If the details match an admin account, Master Admin will be notified.' });
    }
    saveWallets(wallets);
  });

  // ADMIN LOGIN
  socket.on('adminLogin', ({ username, password }) => {
    if (isRateLimited(socket)) { socket.emit('adminAuth', { success: false, message: 'Too many login attempts. Try again in a minute.' }); return; }
    const cleanUser = String(username || ADMIN_USERNAME).trim() || ADMIN_USERNAME;
    const wallets = loadWallets();
    let adminEntry = findAdminUser(wallets, cleanUser);
    let adminId = adminEntry?.[0] || '';
    let admin = adminEntry?.[1] || null;
    const envMasterLogin = cleanUser === ADMIN_USERNAME && safeEqual(password, ADMIN_PASSWORD);
    if (envMasterLogin) {
      admin = ensureBootstrapMaster(wallets);
      adminId = admin.id;
    }
    const passwordOk = envMasterLogin || (admin && verifySecret(admin.passwordHash, password));
    if (!admin || !passwordOk || admin.active === false) {
      socket.emit('adminAuth', { success: false, message: 'Wrong admin login.' });
      return;
    }
    admin.lastLoginAt = new Date().toISOString();
    pruneAdminBrowserSessions();
    const adminToken = createAdminBrowserToken(adminId);
    makeAdminSocketSession(socket, adminId, admin, adminToken);
    auditAdmin(wallets, socket, 'admin_login', {});
    saveWallets(wallets);
    socket.emit('adminAuth', { success: true, admin: publicAdminUser(admin, wallets), token: adminToken, expiresInMs: ADMIN_SESSION_MS, data: getAdminData(socket) });
    console.log(`Admin login: ${admin.username || cleanUser} (${admin.role}) (${socket.id})`);
  });

  socket.on('adminResumeSession', ({ token } = {}) => {
    const cleanToken = String(token || '').trim();
    pruneAdminBrowserSessions();
    const remembered = adminBrowserSessions.get(cleanToken);
    if (!remembered) {
      socket.emit('adminAuth', { success: false, resume: true, message: 'Admin session expired. Please log in again.' });
      return;
    }
    const wallets = loadWallets();
    const admin = wallets.adminUsers?.[remembered.adminId];
    if (!admin || admin.deleted || admin.active === false) {
      adminBrowserSessions.delete(cleanToken);
      socket.emit('adminAuth', { success: false, resume: true, message: 'Admin account is no longer active.' });
      return;
    }
    remembered.expiresAt = Date.now() + ADMIN_SESSION_MS;
    makeAdminSocketSession(socket, remembered.adminId, admin, cleanToken);
    socket.emit('adminAuth', { success: true, resumed: true, admin: publicAdminUser(admin, wallets), token: cleanToken, expiresInMs: ADMIN_SESSION_MS, data: getAdminData(socket) });
  });

  socket.on('adminLogout', ({ token } = {}) => {
    const wallets = loadWallets();
    auditAdmin(wallets, socket, 'admin_logout', {});
    saveWallets(wallets);
    const session = adminSessions.get(socket.id);
    if (session?.token) adminBrowserSessions.delete(session.token);
    const cleanToken = String(token || '').trim();
    if (cleanToken) adminBrowserSessions.delete(cleanToken);
    adminSockets.delete(socket.id);
    adminSessions.delete(socket.id);
    socket.emit('notification', { type: 'success', message: 'Admin logged out.' });
  });

  socket.on('adminChangeOwnPassword', ({ currentPassword, newPassword }) => {
    const session = requireAdmin(socket);
    if (!session) return;
    const wallets = loadWallets();
    const admin = wallets.adminUsers?.[session.adminId];
    if (!admin) { socket.emit('notification', { type: 'error', message: 'Admin account not found.' }); return; }
    if (!verifySecret(admin.passwordHash, currentPassword)) {
      socket.emit('notification', { type: 'error', message: 'Current password is wrong.' });
      return;
    }
    const changed = updateAdminPassword(admin, newPassword);
    if (changed.error) { socket.emit('notification', { type: 'error', message: changed.error }); return; }
    admin.forcePasswordChange = false;
    session.mustChangePassword = false;
    auditAdmin(wallets, socket, 'change_own_admin_password', { adminId: admin.id });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: 'Admin password changed.' });
    socket.emit('adminData', getAdminData(socket));
  });

  socket.on('adminUpdateOwnTelegram', ({ chatId, username }) => {
    const session = requireAdmin(socket);
    if (!session) return;
    const cleanChatId = String(chatId || '').trim().replace(/[^\d-]/g, '').slice(0, 80);
    const cleanUsername = String(username || '').trim().replace(/^@/, '').slice(0, 80);
    if (!cleanChatId) { socket.emit('notification', { type: 'error', message: 'Telegram chat ID is required.' }); return; }
    const wallets = loadWallets();
    const admin = wallets.adminUsers?.[session.adminId];
    if (!admin) { socket.emit('notification', { type: 'error', message: 'Admin account not found.' }); return; }
    admin.telegramChatId = cleanChatId;
    admin.telegramUsername = cleanUsername || admin.telegramUsername || '';
    admin.mustConnectTelegram = false;
    auditAdmin(wallets, socket, 'connect_admin_telegram', { adminId: admin.id, telegramUsername: admin.telegramUsername || '' });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: 'Telegram notifications connected.' });
    socket.emit('adminData', getAdminData(socket));
    notifyAdminChatId(cleanChatId, 'HabeshaBingo admin alert notifications are connected.', wallets);
  });

  socket.on('adminGetData', () => { if (!requireAdmin(socket)) return; socket.emit('adminData', getAdminData(socket)); });

  // ADMIN ADD BALANCE
  socket.on('adminAddBalance', ({ playerName, amount, note }) => {
    if (!requireAdminPermission(socket, 'player_balance_adjust')) return;
    const cleanName = String(playerName || '').trim();
    const parsedAmount = parseInt(amount, 10);
    const reason = requireNote(socket, note);
    if (!reason) return;
    if (!cleanName || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 100000) { socket.emit('notification', { type: 'error', message: 'Enter a valid player and amount.' }); return; }
    const w = loadWallets();
    const match = findWalletByLogin(w, cleanName) || Object.entries(w.players).find(([id]) => id === cleanName);
    if (!match) { socket.emit('notification', { type: 'error', message: `No wallet found for ${cleanName}.` }); return; }
    const [id, wallet] = match;
    finance.externalCredit(w, 'promotion', parsedAmount, `Admin funded credit for ${wallet.name}: ${reason}`, 'promo_funding');
    const credited = finance.accountToPlayer(w, 'promotion', id, wallet, parsedAmount, `Admin credit to ${wallet.name}: ${reason}`, 'admin_credit');
    if (credited.error) { socket.emit('notification', { type: 'error', message: credited.error }); return; }
    auditAdmin(w, socket, 'admin_add_balance', { playerId: id, amount: parsedAmount, reason });
    saveWallets(w);
    socket.emit('adminData', getAdminData(socket));
    socket.emit('notification', { type: 'success', message: `Added ${parsedAmount} ETB to ${wallet.name}` });
    io.emit('balanceUpdate', publicWallet(id, wallet));
    emitAdminDataToAll();
    console.log(`Admin: +${parsedAmount} ETB -> ${wallet.name} (now ${wallet.balance})`);
  });

  socket.on('adminResolveWalletRequest', ({ requestId, action, note }) => {
    const session = requireAdminPermission(socket, 'resolve_requests');
    if (!session) return;
    const adminNote = requireNote(socket, note);
    if (!adminNote) return;
    const wallets = loadWallets();
    const request = (wallets.requests || []).find(req => req.id === requestId);
    if (!request || request.status !== 'pending') { socket.emit('notification', { type: 'error', message: 'Request is not pending.' }); return; }
    const wallet = wallets.players[request.playerId];
    if (!wallet) { socket.emit('notification', { type: 'error', message: 'Player wallet not found.' }); return; }
    if (!requireRequestPermission(socket, session, request, action)) return;
    if (action === 'decline') {
      if (request.type !== 'withdraw') {
        socket.emit('notification', { type: 'error', message: 'Only withdrawal requests can be reassigned.' });
        return;
      }
      if (session.role === 'senior' && request.assignedWithdrawAdminId !== session.adminId) {
        socket.emit('notification', { type: 'error', message: 'This withdrawal is assigned to another admin.' });
        return;
      }
      request.assignmentAttempts = Array.isArray(request.assignmentAttempts) ? request.assignmentAttempts : [];
      request.assignmentAttempts.push({
        adminId: session.adminId || request.assignedWithdrawAdminId || '',
        adminName: session.name || session.username || request.assignedWithdrawAdminName || '',
        declinedAt: new Date().toISOString(),
        reason: adminNote,
      });
      const exclude = request.assignmentAttempts.map(item => item.adminId).filter(Boolean);
      const reassigned = assignWithdrawalRequest(wallets, request, request.amount, exclude);
      auditAdmin(wallets, socket, 'decline_withdrawal_assignment', { requestId, amount: request.amount, playerId: request.playerId, reason: adminNote, reassignedTo: request.assignedWithdrawAdminId || '' });
      saveWallets(wallets);
      if (reassigned.admin) {
        notifyAdminChatId(reassigned.admin.telegramChatId || reassigned.admin.telegramId, `Withdrawal reassigned to you\n\nPlayer: ${playerSummaryLine(request.playerId, wallet)}\nAmount: ${formatEtb(request.amount)}\nPayout phone: ${request.payoutPhone || wallet.phone || '-'}\nRequest: ${request.id}\n\nPrevious admin could not cover it. Please process from your dashboard.`, wallets);
        socket.emit('notification', { type: 'success', message: `Withdrawal reassigned to ${request.assignedWithdrawAdminName}.` });
      } else {
        notifyMasterAdmins(wallets, `Withdrawal assignment needs Master Admin\n\nPlayer: ${playerSummaryLine(request.playerId, wallet)}\nAmount: ${formatEtb(request.amount)}\nPayout phone: ${request.payoutPhone || wallet.phone || '-'}\nRequest: ${request.id}\nReason: ${reassigned.error || adminNote}`);
        socket.emit('notification', { type: 'warning', message: 'No Senior Admin float can cover this withdrawal. Master Admin has been notified.' });
      }
      socket.emit('adminData', getAdminData(socket));
      emitAdminDataToAll();
      return;
    }
    if (action === 'approve') {
      if (request.type === 'deposit') {
        const reference = request.reference || extractPaymentReference(adminNote);
        let approvedReference = '';
        if (reference) {
          const reservedReference = reservePaymentReference(wallets, reference, {
            requestId,
            playerId: request.playerId,
            amount: request.amount,
            source: 'manual_admin_approval',
          });
          if (reservedReference.error) { socket.emit('notification', { type: 'error', message: reservedReference.error }); return; }
          approvedReference = reservedReference.reference;
        } else {
          approvedReference = request.reference || `MANUAL-${requestId}`;
        }
        request.reference = approvedReference;
        const credited = finance.creditPlayer(wallets, request.playerId, wallet, request.amount, `Deposit approved for ${wallet.name}: ${adminNote}`, 'deposit_approved', { requestId, reference: approvedReference });
        if (credited.error) { socket.emit('notification', { type: 'error', message: credited.error }); return; }
        markRealDeposit(wallet, request.amount, 'manual_deposit_approval');
        reclaimSignupPromoCredit(wallets, request.playerId, wallet, 'deposit', { requestId, amount: request.amount, source: 'manual_deposit_approval' });
        recordAdminCashMovement(wallets, {
          adminId: request.depositAccountOwnerAdminId || session.adminId || '',
          type: 'deposit_collected',
          direction: 'in',
          amount: request.amount,
          requestId,
          playerId: request.playerId,
          playerName: wallet.name || '',
          reference: approvedReference,
          note: adminNote,
          source: 'manual_deposit_approval',
          applyToFloat: !!request.depositAccountOwnerAdminId,
        });
      }
      if (request.type === 'withdraw') {
        const assignedAdmin = request.assignedWithdrawAdminId ? wallets.adminUsers?.[request.assignedWithdrawAdminId] : null;
        const approvingAdmin = wallets.adminUsers?.[session.adminId];
        const floatAdmin = assignedAdmin || (session.role === 'senior' ? approvingAdmin : null);
        if (floatAdmin) {
          const currentFloat = finance.money(floatAdmin.withdrawalFloatBalance || 0);
          if (currentFloat < finance.money(request.amount || 0)) {
            socket.emit('notification', { type: 'error', message: `${adminDisplayName(wallets, floatAdmin.id)} does not have enough admin float for this withdrawal.` });
            return;
          }
        }
        const feeCharged = chargeWithdrawalFeeOnApproval(wallets, request, wallet, adminNote);
        if (feeCharged.error) { socket.emit('notification', { type: 'error', message: feeCharged.error }); return; }
        const paid = finance.approveWithdrawal(wallets, request.playerId, wallet, request.amount, `Withdrawal paid to ${wallet.name}: ${adminNote}`, { requestId });
        if (paid.error) {
          if (!feeCharged.alreadyCharged && request.fee > 0) {
            finance.accountToPlayer(wallets, 'withdrawalFeeVault', request.playerId, wallet, request.fee, `Withdrawal fee rollback for ${wallet.name}: ${adminNote}`, 'withdrawal_fee_rollback', { requestId });
            request.feeStatus = 'pending_approval';
            request.feeChargedAt = '';
          }
          socket.emit('notification', { type: 'error', message: paid.error });
          return;
        }
        if (floatAdmin) {
          recordAdminCashMovement(wallets, {
            adminId: floatAdmin.id,
            type: 'withdrawal_paid',
            direction: 'out',
            amount: request.amount,
            requestId,
            playerId: request.playerId,
            playerName: wallet.name || '',
            reference: request.reference || '',
            note: adminNote,
            source: 'withdrawal_approval',
            applyToFloat: true,
          });
          request.paidByAdminId = floatAdmin.id;
          request.paidByAdminName = adminDisplayName(wallets, floatAdmin.id);
          request.floatDebited = finance.money(request.amount || 0);
        }
      }
      request.status = 'approved';
    } else if (action === 'reject') {
      request.status = 'rejected';
      if (request.type === 'withdraw') {
        const returned = finance.rejectWithdrawal(wallets, request.playerId, wallet, request.amount, `Withdrawal rejected for ${wallet.name}: ${adminNote}`, { requestId });
        if (returned.error) { socket.emit('notification', { type: 'error', message: returned.error }); return; }
        if (withdrawalFeeWasChargedAtRequest(request)) {
          const feeReturned = finance.accountToPlayer(wallets, 'withdrawalFeeVault', request.playerId, wallet, request.fee, `Withdrawal fee returned to ${wallet.name}: ${adminNote}`, 'withdrawal_fee_return', { requestId });
          if (feeReturned.error) { socket.emit('notification', { type: 'error', message: feeReturned.error }); return; }
          request.feeStatus = 'returned';
          request.feeReturnedAt = new Date().toISOString();
        }
      }
    } else {
      socket.emit('notification', { type: 'error', message: 'Invalid request action.' });
      return;
    }
    request.resolvedAt = new Date().toISOString();
    request.resolvedBy = socket.id;
    request.resolutionNote = adminNote;
    auditAdmin(wallets, socket, 'resolve_wallet_request', { requestId, action, type: request.type, amount: request.amount, playerId: request.playerId, note: adminNote });
    saveWallets(wallets);
    if (action === 'approve' && request.type === 'deposit') {
      notifyPlayerTelegram(wallet, `Deposit approved\n\n${formatEtb(request.amount)} has been added to your wallet.\nBalance: ${formatEtb(wallet.balance)}`);
      const depositApprovalText = `Manual deposit approval\n\nAdmin: ${session.name || session.username} (${session.role})\nPlayer: ${playerSummaryLine(request.playerId, wallet)}\nAmount: ${formatEtb(request.amount)}\nRequest: ${request.id}\nReference: ${request.reference || '-'}\nNote: ${adminNote}`;
      // Notify only the deposit account owner admin
      if (request.depositAccountOwnerAdminId) {
        const ownerAdmin = wallets.adminUsers?.[request.depositAccountOwnerAdminId];
        if (ownerAdmin?.telegramChatId || ownerAdmin?.telegramId) {
          notifyAdminChatId(ownerAdmin.telegramChatId || ownerAdmin.telegramId, depositApprovalText, wallets);
        } else {
          notifyMasterAdmins(wallets, `${depositApprovalText}\n\nWarning: account owner admin has no Telegram alert chat linked.`);
        }
      } else {
        // Legacy deposit accounts without owner — notify all master admins
        notifyMasterAdmins(wallets, depositApprovalText);
      }
    }
    if (action === 'approve' && request.type === 'withdraw') notifyPlayerTelegram(wallet, `Withdrawal paid\n\n${formatEtb(request.amount)} has been marked as paid.${request.fee > 0 ? `\nWithdrawal fee: ${formatEtb(request.fee)}` : ''}\nBalance: ${formatEtb(wallet.balance)}\nThank you for playing HabeshaBingo.`);
    if (action === 'reject') notifyPlayerTelegram(wallet, `${request.type === 'deposit' ? 'Deposit' : 'Withdrawal'} request rejected.\n\nAmount: ${formatEtb(request.amount)}\nReason: ${adminNote}`);
    socket.emit('adminData', getAdminData(socket));
    io.emit('balanceUpdate', publicWallet(request.playerId, wallet));
    emitAdminDataToAll();
    io.to(socket.id).emit('notification', { type: 'success', message: `${request.type} ${action}d.` });
  });

  // ── ADMIN FORCE START ──
  socket.on('adminManualDeposit', ({ playerQuery, amount, reference, note }) => {
    const session = requireAdminPermission(socket, 'resolve_requests');
    if (!session) return;
    if (!['senior', 'master'].includes(session.role)) {
      socket.emit('notification', { type: 'error', message: 'Only Senior Admin or Master Admin can manually confirm deposits.' });
      return;
    }
    const parsedAmount = parseInt(amount, 10);
    const reason = requireNote(socket, note);
    if (!reason) return;
    const limit = adminLimit(session, 'depositApprove');
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > limit) {
      socket.emit('notification', { type: 'error', message: `${session.role} admins can manually confirm deposits up to ${limit} ETB.` });
      return;
    }
    const wallets = loadWallets();
    const match = findWalletForAdmin(wallets, playerQuery);
    if (!match) {
      socket.emit('notification', { type: 'error', message: 'No player found. Search by name, phone, HB code, or player ID.' });
      return;
    }
    const [playerId, wallet] = match;
    const requestId = makeRequestId();
    const cleanReference = String(reference || '').trim().toUpperCase().slice(0, 80);
    if (cleanReference) {
      const reservedReference = reservePaymentReference(wallets, cleanReference, {
        requestId,
        playerId,
        amount: parsedAmount,
        source: 'manual_admin_deposit',
      });
      if (reservedReference.error) {
        socket.emit('notification', { type: 'error', message: reservedReference.error });
        return;
      }
    }
    const credited = finance.creditPlayer(
      wallets,
      playerId,
      wallet,
      parsedAmount,
      `Manual deposit credit for ${wallet.name}: ${reason}`,
      'deposit_manual_credit',
      {
        requestId,
        reference: cleanReference,
        adminId: session.adminId || '',
        adminRole: session.role,
      }
    );
    if (credited.error) {
      socket.emit('notification', { type: 'error', message: credited.error });
      return;
    }
    markRealDeposit(wallet, parsedAmount, 'admin_manual_deposit');
    reclaimSignupPromoCredit(wallets, playerId, wallet, 'deposit', { requestId, amount: parsedAmount, source: 'admin_manual_deposit' });
    const request = {
      id: requestId,
      type: 'deposit',
      playerId,
      name: wallet.name,
      phone: wallet.phone || '',
      amount: parsedAmount,
      reference: cleanReference,
      note: reason,
      source: 'admin_manual_deposit',
      status: 'approved_manual',
      createdAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
      resolvedBy: socket.id,
      resolutionNote: reason,
    };
    if (!wallets.requests) wallets.requests = [];
    wallets.requests.unshift(request);
    recordAuditEvent(wallets, {
      category: 'wallet',
      event: 'manual_deposit_credit',
      actorType: 'admin',
      actorId: session.adminId || '',
      actorName: session.name || session.username || '',
      actorRole: session.role,
      playerId,
      playerName: wallet.name || '',
      amount: parsedAmount,
      status: 'approved_manual',
      details: { requestId, reference: cleanReference || '', reason },
    });
    recordAdminCashMovement(wallets, {
      adminId: session.adminId || '',
      type: 'manual_deposit_credit',
      direction: 'system',
      amount: parsedAmount,
      requestId,
      playerId,
      playerName: wallet.name || '',
      reference: cleanReference,
      note: reason,
      source: 'admin_manual_deposit',
      applyToFloat: false,
    });
    auditAdmin(wallets, socket, 'manual_deposit_credit', {
      playerId,
      playerName: wallet.name,
      amount: parsedAmount,
      reference: cleanReference || '',
      reason,
    });
    saveWallets(wallets);
    notifyPlayerTelegram(wallet, `Deposit approved\n\n${formatEtb(parsedAmount)} has been added to your wallet.\nBalance: ${formatEtb(wallet.balance)}`);
    notifyMasterAdmins(wallets, `Manual deposit credit\n\nAdmin: ${session.name || session.username} (${session.role})\nPlayer: ${playerSummaryLine(playerId, wallet)}\nAmount: ${formatEtb(parsedAmount)}\nReference: ${cleanReference || 'No digital reference'}\nReason: ${reason}`);
    socket.emit('adminData', getAdminData(socket));
    io.emit('balanceUpdate', publicWallet(playerId, wallet));
    emitAdminDataToAll();
    io.to(socket.id).emit('notification', { type: 'success', message: `Manual deposit credited to ${wallet.name}.` });
  });

  socket.on('adminForceStart', ({ bet, note }) => {
    if (!requireAdminPermission(socket, 'game_control')) return;
    const reason = requireNote(socket, note);
    if (!reason) return;
    const room = gameRooms[bet];
    if (!room || room.status !== 'countdown') { socket.emit('notification', { type: 'error', message: 'No countdown in progress for that bet.' }); return; }
    const wallets = loadWallets();
    auditAdmin(wallets, socket, 'force_start_game', { bet, reason });
    saveWallets(wallets);
    clearInterval(room.countdownTimer); room.countdownTimer = null; room.countdownRemaining = 0; startGame(room);
    console.log(`Admin force-started ${bet}B game`);
  });

  // ADMIN CANCEL GAME
  socket.on('adminCancelGame', ({ bet, note }) => {
    if (!requireAdminPermission(socket, 'game_control')) return;
    const reason = requireNote(socket, note);
    if (!reason) return;
    const room = gameRooms[bet];
    if (!room) return;
    const wallets = loadWallets();
    for (const p of room.players) {
      const w = getPlayerWallet(wallets, p.playerId, p.name);
      if (room.status === 'playing' || room.status === 'paused') {
        const refunded = finance.accountToPlayer(wallets, 'gameEscrow', p.playerId, w, room.bet, `Bingo refund to ${p.name}`, 'bingo_refund', { bet });
        if (!refunded.error) {
          room.escrowPot = Math.max(0, (room.escrowPot || 0) - room.bet);
          w.totalLost = Math.max(0, w.totalLost - room.bet);
          w.gamesPlayed = Math.max(0, w.gamesPlayed - 1);
          clearActiveGameStake(wallets, p.activeStakeKey);
        }
      }
    }
    if ((room.escrowPot || 0) > 0) finance.accountTransfer(wallets, 'gameEscrow', 'commission', room.escrowPot, `Unclaimed cancelled Bingo ${bet}B escrow`, 'bingo_cancel_remainder', { bet, vault: 'commission' });
    clearActiveGameStakesForRound(wallets, 'bingo', room.roundId);
    auditAdmin(wallets, socket, 'cancel_game', { bet, reason, refundedPlayers: room.players.length });
    saveWallets(wallets);
    resetRoom(room);
    io.to(`room-${bet}`).emit('gameReset', { bet });
    io.to(`room-${bet}`).emit('notification', { type: 'warning', message: 'Game cancelled by admin. Bets refunded.' });
    broadcastCounts();
    socket.emit('adminData', getAdminData(socket));
    console.log(`Admin cancelled ${bet}B game - bets refunded`);
  });

  // ADMIN TOGGLE PLAYER STATUS ──
  socket.on('adminTogglePlayer', ({ playerId, action, reason }) => {
    const session = requireAdminPermission(socket, 'player_penalty');
    if (!session) return;
    const note = requireNote(socket, reason);
    if (!note) return;
    const wallets = loadWallets();
    const wallet = wallets.players[playerId];
    if (!wallet) { socket.emit('notification', { type: 'error', message: 'Player not found.' }); return; }
    if (!wallets.suspendedPlayers) wallets.suspendedPlayers = {};
    const now = Date.now();
    const durations = {
      '30m': { ms: 30 * 60 * 1000, label: '30-minute suspension' },
      '2h': { ms: 2 * 60 * 60 * 1000, label: '2-hour suspension' },
      '24h': { ms: 24 * 60 * 60 * 1000, label: '24-hour suspension' },
      permanent: { ms: null, label: 'permanent ban' },
      suspend: { ms: 30 * 60 * 1000, label: '30-minute suspension' },
    };
    let actionLabel = '';
    if (action === 'activate') {
      delete wallets.suspendedPlayers[playerId];
      actionLabel = 'account reactivated';
      socket.emit('notification', { type: 'success', message: `Player ${wallet.name} activated.` });
      notifyPlayerTelegram(wallet, `Your HabeshaBingo account is active again.\n\nReason: ${note}`);
    } else {
      const duration = durations[action];
      if (!duration) { socket.emit('notification', { type: 'error', message: 'Invalid penalty action.' }); return; }
      actionLabel = duration.label;
      wallets.suspendedPlayers[playerId] = {
        suspendedAt: new Date(now).toISOString(),
        until: duration.ms ? new Date(now + duration.ms).toISOString() : null,
        permanent: action === 'permanent',
        duration: action,
        reason: note,
        by: session.username || session.name || '',
        byRole: session.role,
      };
      socket.emit('notification', { type: 'success', message: `${wallet.name}: ${duration.label}.` });
      notifyPlayerTelegram(wallet, `Your HabeshaBingo account has been suspended.\n\nDuration: ${duration.label}\nReason: ${note}`);
    }
    auditAdmin(wallets, socket, 'player_penalty', { playerId, playerName: wallet.name, action, actionLabel, reason: note });
    saveWallets(wallets);
    if (session.role === 'senior') {
      notifyMasterAdmins(wallets, `Senior Admin player action\n\nAdmin: ${session.name || session.username}\nPlayer: ${wallet.name} (${wallet.phone || playerId})\nAction: ${actionLabel}\nReason: ${note}`);
    }
    socket.emit('adminData', getAdminData(socket));
    console.log(`Admin: ${actionLabel} for player ${playerId}`);
  });

  // ── ADMIN UPDATE CONFIG ──
  socket.on('adminUpdateConfig', ({ key, value, password, note }) => {
    const session = requireAdminPermission(socket, 'settings');
    if (!session) return;
    const reason = requireNote(socket, note);
    if (!reason) return;
    const wallets = loadWallets();
    if (!verifyAdminPasswordForSession(wallets, session, password)) {
      socket.emit('notification', { type: 'error', message: 'Master Admin password confirmation failed.' });
      return;
    }
    if (!(key in runtimeConfig)) { socket.emit('notification', { type: 'error', message: `Unknown config key: ${key}` }); return; }
    const checked = validateConfigValue(key, value);
    if (checked.error) { socket.emit('notification', { type: 'error', message: checked.error }); return; }
    const old = runtimeConfig[key];
    runtimeConfig[key] = checked.value;
    auditAdmin(wallets, socket, 'update_config', { key, old, value: checked.value, reason });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: `${key}: ${old} -> ${checked.value}` });
    socket.emit('adminData', getAdminData(socket));
    console.log(`Admin config: ${key} ${old} -> ${checked.value}`);
  });
  // ── ADMIN ADJUST BALANCE ──
  socket.on('adminUpdateGameSettings', ({ game, settings, password, note }) => {
    const session = requireAdminPermission(socket, 'settings');
    if (!session) return;
    const gameKey = String(game || '').trim().toLowerCase();
    if (!['bingo', 'keno', 'roulette', 'wallet'].includes(gameKey)) {
      socket.emit('notification', { type: 'error', message: 'Unknown game settings section.' });
      return;
    }
    const reason = requireNote(socket, note);
    if (!reason) return;
    const wallets = loadWallets();
    if (!verifyAdminPasswordForSession(wallets, session, password)) {
      socket.emit('notification', { type: 'error', message: 'Master Admin password confirmation failed.' });
      return;
    }
    wallets.gameSettings = normalizeGameSettings(wallets.gameSettings);
    const current = wallets.gameSettings.active[gameKey] || defaultGameSettings()[gameKey];
    const next = normalizeGameSettingsBlock(gameKey, { ...current, ...(settings || {}) });
    if (next.minBet && next.maxBet && next.minBet > next.maxBet) {
      socket.emit('notification', { type: 'error', message: 'Minimum bet cannot be higher than maximum bet.' });
      return;
    }
    if (next.minWithdrawEtb && next.maxWithdrawEtb && next.minWithdrawEtb > next.maxWithdrawEtb) {
      socket.emit('notification', { type: 'error', message: 'Minimum withdrawal cannot be higher than maximum withdrawal.' });
      return;
    }
    if (next.minPlayers && next.maxPlayers && next.minPlayers > next.maxPlayers) {
      socket.emit('notification', { type: 'error', message: 'Minimum players cannot be higher than maximum players.' });
      return;
    }
    const applyNow = gameKey === 'wallet' || canApplyGameSettingsImmediately(gameKey);
    if (applyNow) {
      wallets.gameSettings.active[gameKey] = next;
      if (wallets.gameSettings.pending?.[gameKey]) delete wallets.gameSettings.pending[gameKey];
      wallets.gameSettings.updatedAt = new Date().toISOString();
      wallets.gameSettings.updatedBy = session.username || session.name || 'master';
    } else {
      wallets.gameSettings.pending[gameKey] = next;
      wallets.gameSettings.pendingUpdatedAt = new Date().toISOString();
      wallets.gameSettings.pendingUpdatedBy = session.username || session.name || 'master';
    }
    auditAdmin(wallets, socket, 'update_game_settings', { game: gameKey, reason, pending: !applyNow, appliedImmediately: applyNow, settings: next });
    saveWallets(wallets);
    if (gameKey === 'bingo') syncBingoRooms(wallets);
    io.emit('publicSettingsUpdated', {
      gameSettings: publicGameSettings(wallets).active,
      responsibleGaming: {
        coolDownLossThreshold: runtimeConfig.COOL_DOWN_LOSS_THRESHOLD,
        coolDownHours: runtimeConfig.COOL_DOWN_HOURS,
      },
    });
    socket.emit('notification', {
      type: 'success',
      message: applyNow
        ? `${gameKey} settings updated immediately.`
        : `${gameKey} settings saved. They apply when the current active round finishes.`,
    });
    socket.emit('adminData', getAdminData(socket));
    emitAdminDataToAll();
  });

  socket.on('adminUpdateTelegramSettings', ({ botToken, adminBotToken, botUsername, adminChatIds, note, password }) => {
    const session = requireAdminPermission(socket, 'settings');
    if (!session) return;
    const reason = requireNote(socket, note);
    if (!reason) return;
    const wallets = loadWallets();
    if (!verifyAdminPasswordForSession(wallets, session, password)) {
      socket.emit('notification', { type: 'error', message: 'Master Admin password confirmation failed.' });
      return;
    }
    if (!wallets.telegramSettings) wallets.telegramSettings = {};
    const cleanToken = cleanTelegramToken(botToken);
    const cleanAdminToken = cleanTelegramToken(adminBotToken);
    if (cleanToken && !isTelegramBotToken(cleanToken)) {
      socket.emit('notification', { type: 'error', message: 'Game bot token format is invalid. Copy the complete token from BotFather, including the numeric ID, colon, and full secret.' });
      return;
    }
    if (cleanAdminToken && !isTelegramBotToken(cleanAdminToken)) {
      socket.emit('notification', { type: 'error', message: 'Admin alert bot token format is invalid. Copy the complete token from BotFather, including the numeric ID, colon, and full secret.' });
      return;
    }
    const cleanBotUsername = cleanTelegramBotUsername(botUsername);
    if (String(botUsername || '').trim() && !cleanBotUsername) {
      socket.emit('notification', { type: 'error', message: 'Enter a valid Telegram bot username (5-32 letters, numbers, or underscores).' });
      return;
    }
    const cleanChatIds = cleanAdminChatIds(adminChatIds);
    if (cleanToken) wallets.telegramSettings.botToken = cleanToken;
    if (cleanAdminToken) wallets.telegramSettings.adminBotToken = cleanAdminToken;
    if (cleanBotUsername) wallets.telegramSettings.botUsername = cleanBotUsername;
    if (Array.isArray(adminChatIds) || String(adminChatIds || '').trim()) wallets.telegramSettings.adminChatIds = cleanChatIds;
    auditAdmin(wallets, socket, 'update_telegram_settings', { botTokenChanged: !!cleanToken, adminBotTokenChanged: !!cleanAdminToken, botUsername: cleanBotUsername || '', adminChatIds: cleanChatIds, reason });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: 'Telegram settings updated.' });
    socket.emit('adminData', getAdminData(socket));
    notifyAdminTelegram(`Admin alert bot settings updated.\nAdmins configured: ${getTelegramSettings(wallets).adminChatIds.length}\nDedicated admin bot: ${getTelegramSettings(wallets).hasDedicatedAdminBot ? 'yes' : 'fallback to game bot'}`);
  });

  socket.on('adminUpdatePolicies', ({ title, body, note, password }) => {
    const session = requireAdminPermission(socket, 'settings');
    if (!session) return;
    const reason = requireNote(socket, note);
    if (!reason) return;
    const clean = normalizePolicySettings({ title, body });
    const wallets = loadWallets();
    if (!verifyAdminPasswordForSession(wallets, session, password)) {
      socket.emit('notification', { type: 'error', message: 'Master Admin password confirmation failed.' });
      return;
    }
    wallets.policySettings = {
      ...clean,
      updatedAt: new Date().toISOString(),
      updatedBy: session.username || session.name || 'admin',
    };
    auditAdmin(wallets, socket, 'update_policies', { title: clean.title, reason });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: 'Policies updated.' });
    socket.emit('adminData', getAdminData(socket));
  });

  // ── ADMIN UPDATE APP GATE PASSWORD (SMS forwarder app auth) ──
  socket.on('adminUpdateAppGate', ({ password: newPassword, note, adminPassword }) => {
    const session = requireAdminPermission(socket, 'settings');
    if (!session) return;
    const reason = requireNote(socket, note);
    if (!reason) return;
    const wallets = loadWallets();
    if (!verifyAdminPasswordForSession(wallets, session, adminPassword)) {
      socket.emit('notification', { type: 'error', message: 'Master Admin password confirmation failed.' });
      return;
    }
    const clean = String(newPassword || '').trim();
    if (!clean || clean.length < 4) {
      socket.emit('notification', { type: 'error', message: 'App gate password must be at least 4 characters.' });
      return;
    }
    if (!wallets.appGate) wallets.appGate = { password: APP_GATE_PASSWORD, version: 1 };
    const oldVersion = wallets.appGate.version || 1;
    wallets.appGate.password = clean;
    wallets.appGate.version = oldVersion + 1;
    wallets.appGate.updatedAt = new Date().toISOString();
    wallets.appGate.updatedBy = session.username || session.name || 'admin';
    auditAdmin(wallets, socket, 'update_app_gate_password', { reason, version: wallets.appGate.version });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: `App gate password updated (v${wallets.appGate.version}). All devices will re-auth on next open.` });
    socket.emit('adminData', getAdminData(socket));
  });

  // Also expose current app gate info (masked) in admin data
  socket.on('adminGetAppGateConfig', () => {
    const wallets = loadWallets();
    const cfg = getAppGateConfig(wallets);
    socket.emit('appGateConfig', {
      version: cfg.version,
      passwordHint: cfg.password.slice(0, 2) + '***' + cfg.password.slice(-1),
      length: cfg.password.length,
      updatedAt: (wallets.appGate || {}).updatedAt || null,
      updatedBy: (wallets.appGate || {}).updatedBy || null,
    });
  });

  socket.on('adminCreateDepositAccount', (payload = {}) => {
    if (!requireAdminPermission(socket, 'settings')) return;
    const clean = cleanDepositAccount(payload);
    if (!clean.label || !clean.receiverName || !clean.accountNumber) {
      socket.emit('notification', { type: 'error', message: 'Enter label, receiver name, and Telebirr account number.' });
      return;
    }
    const wallets = loadWallets();
    if (!wallets.depositAccounts) wallets.depositAccounts = [];
    const created = createDepositAccountRecord(wallets, clean, payload.ownerAdminId || '', adminSession(socket)?.adminId || '');
    if (created.error) { socket.emit('notification', { type: 'error', message: created.error }); return; }
    const account = created.account;
    auditAdmin(wallets, socket, 'create_deposit_account', { accountId: account.id, label: account.label, accountNumber: account.accountNumber, ownerAdminId: account.ownerAdminId });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: 'Deposit account created.' });
    socket.emit('adminData', getAdminData(socket));
  });

  socket.on('adminSetDepositAccountStatus', ({ accountId, status, note }) => {
    const session = requireAdmin(socket);
    if (!session || !['senior', 'master'].includes(session.role) || !adminHasPermission(session, 'resolve_requests')) {
      socket.emit('notification', { type: 'error', message: 'You do not have permission to pause or activate deposit accounts.' });
      return;
    }
    if (session.mustChangePassword) {
      socket.emit('notification', { type: 'error', message: 'Change your temporary admin password before continuing.' });
      return;
    }
    const nextStatus = status === 'active' ? 'active' : 'paused';
    const reason = requireNote(socket, note);
    if (!reason) return;
    const wallets = loadWallets();
    const account = (wallets.depositAccounts || []).find(item => item.id === accountId && item.status !== 'deleted');
    if (!account) { socket.emit('notification', { type: 'error', message: 'Deposit account not found.' }); return; }
    if (session.role !== 'master' && account.ownerAdminId !== session.adminId) {
      socket.emit('notification', { type: 'error', message: 'Senior Admins can manage only their own deposit accounts.' });
      return;
    }
    account.status = nextStatus;
    account.updatedAt = new Date().toISOString();
    auditAdmin(wallets, socket, 'set_deposit_account_status', { accountId, status: nextStatus, reason });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: `Deposit account ${nextStatus}.` });
    socket.emit('adminData', getAdminData(socket));
  });

  socket.on('adminUpdateDepositAccount', (payload = {}) => {
    const session = requireAdminPermission(socket, 'settings');
    if (!session) return;
    const reason = requireNote(socket, payload.note || payload.reason);
    if (!reason) return;
    const wallets = loadWallets();
    const accountId = String(payload.accountId || '').trim();
    const account = (wallets.depositAccounts || []).find(item => item.id === accountId && item.status !== 'deleted');
    if (!account) { socket.emit('notification', { type: 'error', message: 'Deposit account not found.' }); return; }
    const clean = cleanDepositAccount(payload);
    if (!clean.label || !clean.receiverName || !clean.accountNumber) { socket.emit('notification', { type: 'error', message: 'Label, receiver, and number are required.' }); return; }
    const ownerAdminId = cleanDepositAccountOwner(wallets, payload.ownerAdminId || account.ownerAdminId || '');
    if ((payload.ownerAdminId || account.ownerAdminId) && !ownerAdminId) { socket.emit('notification', { type: 'error', message: 'Owner must be an active Senior Admin.' }); return; }
    const nextStatus = ['active', 'paused'].includes(String(payload.status || '').toLowerCase()) ? String(payload.status).toLowerCase() : account.status;
    if (ownerAdminId && nextStatus === 'active' && activeDepositAccountCountForOwner(wallets, ownerAdminId, account.id) >= 3) {
      socket.emit('notification', { type: 'error', message: 'That Senior Admin already has 3 active deposit accounts.' });
      return;
    }
    const duplicate = (wallets.depositAccounts || []).find(item => item.id !== account.id && item.status !== 'deleted' && item.accountNumber === clean.accountNumber);
    if (duplicate) { socket.emit('notification', { type: 'error', message: 'That Telebirr number already exists.' }); return; }
    const old = { label: account.label, receiverName: account.receiverName, accountNumber: account.accountNumber, ownerAdminId: account.ownerAdminId, status: account.status };
    account.label = clean.label;
    account.receiverName = clean.receiverName;
    account.accountNumber = clean.accountNumber;
    account.ownerAdminId = ownerAdminId;
    account.ownerAdminName = adminDisplayName(wallets, ownerAdminId);
    account.status = nextStatus;
    account.updatedAt = new Date().toISOString();
    auditAdmin(wallets, socket, 'update_deposit_account', { accountId, old, next: publicDepositAccount(account, wallets), reason });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: 'Deposit account updated.' });
    socket.emit('adminData', getAdminData(socket));
  });

  socket.on('adminDeleteDepositAccount', ({ accountId, note }) => {
    if (!requireAdminPermission(socket, 'settings')) return;
    const reason = requireNote(socket, note);
    if (!reason) return;
    const wallets = loadWallets();
    const account = (wallets.depositAccounts || []).find(item => item.id === accountId && item.status !== 'deleted');
    if (!account) { socket.emit('notification', { type: 'error', message: 'Deposit account not found.' }); return; }
    account.status = 'deleted';
    account.deletedAt = new Date().toISOString();
    account.updatedAt = new Date().toISOString();
    auditAdmin(wallets, socket, 'delete_deposit_account', { accountId, label: account.label, reason });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: 'Deposit account deleted.' });
    socket.emit('adminData', getAdminData(socket));
  });

  socket.on('adminAdjustBalance', ({ playerId, amount, reason }) => {
    const session = requireAdminPermission(socket, 'player_balance_adjust');
    if (!session) return;
    const parsed = parseInt(amount, 10);
    if (!Number.isFinite(parsed) || parsed === 0) { socket.emit('notification', { type: 'error', message: 'Enter a non-zero amount.' }); return; }
    const wallets = loadWallets();
    const wallet = wallets.players[playerId];
    if (!wallet) { socket.emit('notification', { type: 'error', message: 'Player not found.' }); return; }
    const note = requireNote(socket, reason);
    if (!note) return;
    if (Math.abs(parsed) > adminLimit(session, 'playerAdjust')) { socket.emit('notification', { type: 'error', message: `${session.role} admins can adjust up to ${adminLimit(session, 'playerAdjust')} ETB.` }); return; }
    let adjusted;
    if (parsed > 0) {
      finance.externalCredit(wallets, 'promotion', parsed, `Admin funded adjustment for ${wallet.name}`, 'promo_funding');
      adjusted = finance.accountToPlayer(wallets, 'promotion', playerId, wallet, parsed, `${playerId}: ${note}`, 'admin_credit');
      wallet.totalWon = (wallet.totalWon || 0) + parsed;
    } else {
      adjusted = finance.debitPlayerToAccount(wallets, playerId, wallet, 'operating', Math.abs(parsed), `${playerId}: ${note}`, 'admin_debit');
    }
    if (adjusted.error) { socket.emit('notification', { type: 'error', message: adjusted.error }); return; }
    auditAdmin(wallets, socket, 'adjust_player_balance', { playerId, amount: parsed, reason: note });
    saveWallets(wallets);
    socket.emit('adminData', getAdminData(socket));
    socket.emit('notification', { type: 'success', message: `${parsed > 0 ? 'Added' : 'Deducted'} ${Math.abs(parsed)} ETB ${parsed > 0 ? 'to' : 'from'} ${wallet.name}` });
    io.emit('balanceUpdate', publicWallet(playerId, wallet));
    console.log(`💰 Admin: ${parsed > 0 ? '+' : ''}${parsed} ETB → ${wallet.name} (now ${wallet.balance})`);
  });

  // ── ADMIN TRANSFER FUNDS ──
  socket.on('adminTransferFunds', ({ fromAccount, toAccount, amount, note }) => {
    const session = requireAdminPermission(socket, 'finance_transfer');
    if (!session) return;
    const parsed = parseInt(amount, 10);
    const reason = requireNote(socket, note);
    if (!reason) return;
    if (!Number.isFinite(parsed) || parsed <= 0) { socket.emit('notification', { type: 'error', message: 'Enter a valid positive amount.' }); return; }
    if (parsed > adminLimit(session, 'vaultTransfer')) { socket.emit('notification', { type: 'error', message: `${session.role} admins can transfer up to ${adminLimit(session, 'vaultTransfer')} ETB.` }); return; }
    if (isAdminTransferLockedAccount(fromAccount) || isAdminTransferLockedAccount(toAccount)) {
      socket.emit('notification', { type: 'error', message: 'Player Wallet Pool, Pending Withdrawals, and Game Escrow are protected accounting accounts and cannot be moved manually.' });
      return;
    }
    if (session.role !== 'master' && (isSensitiveFinanceAccount(fromAccount) || isSensitiveFinanceAccount(toAccount))) {
      socket.emit('notification', { type: 'error', message: 'Only Master Admin can move commission or operating funds.' });
      return;
    }
    const wallets = loadWallets();
    const moved = finance.accountTransfer(wallets, fromAccount, toAccount, parsed, `${fromAccount} -> ${toAccount}: ${reason}`, 'transfer');
    if (moved.error) { socket.emit('notification', { type: 'error', message: moved.error }); return; }
    recordAdminCashMovement(wallets, {
      adminId: session.adminId || '',
      type: 'vault_transfer',
      direction: 'system',
      amount: parsed,
      reference: `${fromAccount}->${toAccount}`,
      note: reason,
      source: 'admin_transfer_funds',
      applyToFloat: false,
    });
    auditAdmin(wallets, socket, 'transfer_funds', { fromAccount, toAccount, amount: parsed, reason });
    saveWallets(wallets);
    emitAdminDataToAll();
    if (session.role === 'senior') {
      notifySeniorAdmins(wallets, `Vault transfer by senior admin\nAdmin: ${session.name || session.username}\nAmount: ${formatEtb(parsed)}\nFrom: ${fromAccount}\nTo: ${toAccount}\nReason: ${reason}`);
    }
    socket.emit('adminData', getAdminData(socket));
    socket.emit('notification', { type: 'success', message: `Transferred ${parsed} ETB from ${fromAccount} → ${toAccount}` });
    console.log(`💸 Admin transfer: ${parsed} ETB ${fromAccount} → ${toAccount}`);
  });

  // ── ADMIN ADD FUNDS TO ACCOUNT ──
  socket.on('adminAddFunds', ({ account, amount, note }) => {
    const session = requireAdminPermission(socket, 'external_funding');
    if (!session) return;
    if (!CAPITAL_INJECTION_ACCOUNTS.includes(account)) {
      socket.emit('notification', { type: 'error', message: 'Capital injections are limited to promo and game prize vault accounts.' });
      return;
    }
    const parsed = parseInt(amount, 10);
    const reason = requireNote(socket, note, 'source note');
    if (!reason) return;
    if (!Number.isFinite(parsed) || parsed <= 0) { socket.emit('notification', { type: 'error', message: 'Enter a valid positive amount.' }); return; }
    if (parsed > adminLimit(session, 'capitalInjection')) { socket.emit('notification', { type: 'error', message: `${session.role} admins can inject up to ${adminLimit(session, 'capitalInjection')} ETB per action.` }); return; }
    const wallets = loadWallets();
    const funded = finance.externalCredit(wallets, account, parsed, `Capital injection to ${account}: ${reason}`, 'capital_injection', { account });
    if (funded.error) { socket.emit('notification', { type: 'error', message: funded.error }); return; }
    recordAdminCashMovement(wallets, {
      adminId: session.adminId || '',
      type: 'capital_injection',
      direction: 'system',
      amount: parsed,
      reference: account,
      note: reason,
      source: 'admin_add_funds',
      applyToFloat: false,
    });
    auditAdmin(wallets, socket, 'capital_injection', { account, amount: parsed, reason });
    saveWallets(wallets);
    socket.emit('adminData', getAdminData(socket));
    socket.emit('notification', { type: 'success', message: `Injected ${parsed} ETB to ${account}` });
    emitAdminDataToAll();
    console.log(`Admin capital injection: +${parsed} ETB to ${account}`);
  });

  // ── ADMIN RESET PLAYER PIN ──
  socket.on('adminDividendWithdraw', ({ account, amount, note }) => {
    const session = requireAdminPermission(socket, 'dividend_withdrawal');
    if (!session) return;
    if (!DIVIDEND_WITHDRAWAL_ACCOUNTS.includes(account)) {
      socket.emit('notification', { type: 'error', message: 'Dividend withdrawals are allowed only from commission, game house-win, or operating accounts.' });
      return;
    }
    const parsed = parseInt(amount, 10);
    const reason = requireNote(socket, note, 'withdrawal reason');
    if (!reason) return;
    if (!Number.isFinite(parsed) || parsed <= 0) { socket.emit('notification', { type: 'error', message: 'Enter a valid positive amount.' }); return; }
    const wallets = loadWallets();
    const withdrawn = finance.externalDebit(wallets, account, parsed, `Dividend withdrawal by ${session.name || session.username}: ${reason}`, 'dividend_withdrawal', { account, adminId: session.adminId || '', admin: session.username || '' });
    if (withdrawn.error) { socket.emit('notification', { type: 'error', message: withdrawn.error }); return; }
    recordAdminCashMovement(wallets, {
      adminId: session.adminId || '',
      type: 'dividend_withdrawal',
      direction: 'system',
      amount: parsed,
      reference: account,
      note: reason,
      source: 'admin_dividend_withdraw',
      applyToFloat: false,
    });
    auditAdmin(wallets, socket, 'dividend_withdrawal', { account, amount: parsed, reason });
    saveWallets(wallets);
    socket.emit('adminData', getAdminData(socket));
    socket.emit('notification', { type: 'success', message: `Dividend withdrawal registered: ${parsed} ETB from ${account}` });
    emitAdminDataToAll();
    console.log(`Admin dividend withdrawal: -${parsed} ETB from ${account}`);
  });

  socket.on('adminResetPin', ({ playerId, reason }) => {
    if (!requireAdminPermission(socket, 'reset_pin')) return;
    const note = requireNote(socket, reason);
    if (!note) return;
    const wallets = loadWallets();
    const wallet = wallets.players[playerId];
    if (!wallet) { socket.emit('notification', { type: 'error', message: 'Player not found.' }); return; }
    const temporaryPin = makeTempPin();
    wallet.pinHash = hashPin(temporaryPin);
    delete wallet.pin;
    wallet.mustChangePin = true;
    wallet.pinResetAt = new Date().toISOString();
    auditAdmin(wallets, socket, 'reset_player_pin', { playerId, reason: note });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: `Temporary PIN for ${wallet.name}: ${temporaryPin}` });
    console.log(`Admin reset PIN for ${wallet.name}`);
  });

  socket.on('adminCreateUser', (payload = {}) => {
    const session = requireAdminPermission(socket, 'manage_admins');
    if (!session) return;
    const wallets = loadWallets();
    const requestedDepositAccounts = normalizeDepositAccountInputs(payload.depositAccounts);
    const result = createAdminUser(wallets, payload, session.adminId || session.username || 'master');
    if (result.error) {
      socket.emit('adminCreateUserResult', { success: false, message: result.error });
      socket.emit('notification', { type: 'error', message: result.error });
      return;
    }
    const createdAccounts = [];
    if (requestedDepositAccounts.length) {
      if (result.admin.role !== 'senior') {
        delete wallets.adminUsers[result.admin.id];
        socket.emit('adminCreateUserResult', { success: false, message: 'Deposit accounts can be assigned only to Senior Admins.' });
        socket.emit('notification', { type: 'error', message: 'Deposit accounts can be assigned only to Senior Admins.' });
        return;
      }
      const seenNumbers = new Set();
      for (const accountInput of requestedDepositAccounts) {
        if (seenNumbers.has(accountInput.accountNumber)) {
          delete wallets.adminUsers[result.admin.id];
          socket.emit('adminCreateUserResult', { success: false, message: 'Duplicate Telebirr number inside the new admin form.' });
          socket.emit('notification', { type: 'error', message: 'Duplicate Telebirr number inside the new admin form.' });
          return;
        }
        seenNumbers.add(accountInput.accountNumber);
        const createdAccount = createDepositAccountRecord(wallets, accountInput, result.admin.id, session.adminId || session.username || '');
        if (createdAccount.error) {
          delete wallets.adminUsers[result.admin.id];
          for (const account of createdAccounts) account.status = 'deleted';
          socket.emit('adminCreateUserResult', { success: false, message: createdAccount.error });
          socket.emit('notification', { type: 'error', message: createdAccount.error });
          return;
        }
        createdAccounts.push(createdAccount.account);
      }
    }
    if (result.admin.role === 'senior' && finance.money(result.admin.withdrawalFloatBalance || 0) > 0) {
      recordAdminCashMovement(wallets, {
        adminId: result.admin.id,
        type: 'opening_float',
        direction: 'in',
        amount: result.admin.withdrawalFloatBalance,
        reference: 'admin_create',
        note: `Opening withdrawal float set by ${session.name || session.username}.`,
        source: 'admin_create_user',
        applyToFloat: false,
      });
    }
    auditAdmin(wallets, socket, 'create_admin_user', { adminId: result.admin.id, role: result.admin.role, phone: result.admin.phone, username: result.admin.username, depositAccounts: createdAccounts.map(account => account.id) });
    saveWallets(wallets);
    socket.emit('adminCreateUserResult', { success: true, admin: publicAdminUser(result.admin, wallets), depositAccounts: createdAccounts.map(account => publicDepositAccount(account, wallets)) });
    socket.emit('notification', { type: 'success', message: `Created ${ADMIN_ROLES[result.admin.role]}: ${result.admin.name}. Username: ${result.admin.username}` });
    socket.emit('adminData', getAdminData(socket));
  });

  socket.on('adminSetUserStatus', ({ adminId, active, reason }) => {
    const session = requireAdminPermission(socket, 'manage_admins');
    if (!session) return;
    const note = requireNote(socket, reason);
    if (!note) return;
    const wallets = loadWallets();
    const admin = wallets.adminUsers?.[adminId];
    if (!admin) { socket.emit('notification', { type: 'error', message: 'Admin user not found.' }); return; }
    if (admin.id === session.adminId) { socket.emit('notification', { type: 'error', message: 'You cannot disable your own admin account.' }); return; }
    admin.active = active !== false;
    admin.statusChangedAt = new Date().toISOString();
    auditAdmin(wallets, socket, 'set_admin_status', { adminId, active: admin.active, reason: note });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: `${admin.name} is now ${admin.active ? 'active' : 'disabled'}.` });
    socket.emit('adminData', getAdminData(socket));
  });

  socket.on('adminSetUserFreePlay', ({ adminId, active, reason }) => {
    const session = requireAdminPermission(socket, 'manage_admins');
    if (!session) return;
    const note = requireNote(socket, reason);
    if (!note) return;
    const wallets = loadWallets();
    const admin = wallets.adminUsers?.[adminId];
    if (!admin || admin.deleted) { socket.emit('notification', { type: 'error', message: 'Admin user not found.' }); return; }
    admin.freePlayActive = active === true;
    admin.freePlayUpdatedAt = new Date().toISOString();
    admin.freePlayUpdatedBy = session.adminId || session.username || '';
    auditAdmin(wallets, socket, 'set_admin_free_play', { adminId, active: admin.freePlayActive, reason: note });
    recordAuditEvent(wallets, {
      category: 'admin',
      type: 'admin_free_play_access',
      status: admin.freePlayActive ? 'enabled' : 'disabled',
      actorType: 'admin',
      actorId: session.adminId || '',
      actorName: session.name || session.username || '',
      targetType: 'admin',
      targetId: adminId,
      targetName: admin.name || admin.username || adminId,
      details: { reason: note },
    });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: `Free play ${admin.freePlayActive ? 'enabled' : 'disabled'} for ${admin.name}.` });
    socket.emit('adminData', getAdminData(socket));
  });

  socket.on('adminDeleteUser', ({ adminId, reason }) => {
    const session = requireAdminPermission(socket, 'manage_admins');
    if (!session) return;
    const note = requireNote(socket, reason);
    if (!note) return;
    const wallets = loadWallets();
    const admin = wallets.adminUsers?.[adminId];
    if (!admin) { socket.emit('notification', { type: 'error', message: 'Admin user not found.' }); return; }
    if (admin.id === session.adminId) { socket.emit('notification', { type: 'error', message: 'You cannot remove your own admin account.' }); return; }
    if (admin.source === 'env' || admin.role === 'master') { socket.emit('notification', { type: 'error', message: 'Master/bootstrap admins cannot be removed from this panel.' }); return; }
    admin.active = false;
    admin.deleted = true;
    admin.deletedAt = new Date().toISOString();
    auditAdmin(wallets, socket, 'delete_admin_user', { adminId, role: admin.role, phone: admin.phone, reason: note });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: `${admin.name} removed from admin access.` });
    socket.emit('adminData', getAdminData(socket));
  });

  socket.on('adminResetUserPassword', ({ adminId, password, reason }) => {
    const session = requireAdminPermission(socket, 'manage_admins');
    if (!session) return;
    const note = requireNote(socket, reason);
    if (!note) return;
    const wallets = loadWallets();
    const admin = wallets.adminUsers?.[adminId];
    if (!admin) { socket.emit('notification', { type: 'error', message: 'Admin user not found.' }); return; }
    const changed = updateAdminPassword(admin, password);
    if (changed.error) { socket.emit('notification', { type: 'error', message: changed.error }); return; }
    admin.forcePasswordChange = admin.role !== 'master';
    auditAdmin(wallets, socket, 'reset_admin_password', { adminId, reason: note });
    saveWallets(wallets);
    if (admin.telegramChatId) {
      notifyAdminChatId(admin.telegramChatId, `HabeshaBingo admin password reset\n\nUsername: ${admin.username}\nTemporary password: ${password}\n\nPlease login and change this password immediately.`, wallets);
    }
    socket.emit('notification', { type: 'success', message: `Password updated for ${admin.name}.` });
    socket.emit('adminData', getAdminData(socket));
  });

  // ── JOIN ──
  socket.on('adminUpdateUser', (payload = {}) => {
    const session = requireAdminPermission(socket, 'manage_admins');
    if (!session) return;
    const adminId = String(payload.adminId || '').trim();
    const note = requireNote(socket, payload.reason || payload.note);
    if (!note) return;
    const wallets = loadWallets();
    const admin = wallets.adminUsers?.[adminId];
    if (!admin || admin.deleted) { socket.emit('notification', { type: 'error', message: 'Admin user not found.' }); return; }
    if (admin.id === session.adminId && payload.active === false) { socket.emit('notification', { type: 'error', message: 'You cannot disable your own admin account.' }); return; }
    if (admin.source === 'env' && normalizeAdminRole(payload.role || admin.role) !== 'master') { socket.emit('notification', { type: 'error', message: 'Bootstrap Master Admin role cannot be changed.' }); return; }

    const nextName = normalizeName(payload.name || admin.name);
    const nextPhone = normalizePhone(payload.phone || admin.phone);
    const nextRole = normalizeAdminRole(payload.role || admin.role);
    const nextTelegramChatId = String(payload.telegramChatId ?? admin.telegramChatId ?? '').trim().replace(/[^\d-]/g, '').slice(0, 80);
    const nextTelegramUsername = String(payload.telegramUsername ?? admin.telegramUsername ?? '').trim().replace(/^@/, '').slice(0, 80);
    if (!nextName || nextName === 'Anonymous') { socket.emit('notification', { type: 'error', message: 'Admin name is required.' }); return; }
    if (!nextPhone) { socket.emit('notification', { type: 'error', message: 'Admin phone must be a valid Ethiopian number.' }); return; }
    if (admin.role === 'master' && nextRole !== 'master') { socket.emit('notification', { type: 'error', message: 'Master Admins cannot be demoted from this panel.' }); return; }
    const nextUsername = nextRole === 'master' ? (admin.username || normalizeAdminLogin(nextPhone || nextName)) : adminGeneratedUsername(nextName, nextPhone);
    const duplicate = findAdminDuplicate(wallets, adminId, nextPhone, nextUsername);
    if (duplicate) { socket.emit('notification', { type: 'error', message: 'Another admin already uses that phone or username.' }); return; }

    const old = { name: admin.name, phone: admin.phone, role: admin.role, username: admin.username, active: admin.active !== false, withdrawalFloatBalance: finance.money(admin.withdrawalFloatBalance || 0), telegramChatId: admin.telegramChatId || '', telegramUsername: admin.telegramUsername || '' };
    admin.name = nextName;
    admin.phone = nextPhone;
    admin.role = nextRole;
    admin.username = nextUsername;
    admin.active = payload.active !== false;
    admin.telegramChatId = nextTelegramChatId;
    admin.telegramUsername = nextTelegramUsername;
    admin.mustConnectTelegram = nextRole === 'senior' ? !admin.telegramChatId : false;
    admin.referralCode = nextRole === 'senior' ? referralCodeBaseForAdmin(admin) : '';
    admin.referralActive = nextRole === 'senior' ? payload.referralActive !== false : false;
    admin.withdrawalFloatBalance = nextRole === 'senior' ? normalizeAdminFloat(payload.withdrawalFloatBalance ?? admin.withdrawalFloatBalance ?? 0) : 0;
    admin.withdrawalFloatUpdatedAt = new Date().toISOString();
    admin.updatedAt = new Date().toISOString();
    admin.updatedBy = session.adminId || session.username || '';
    if (String(payload.password || '').trim()) {
      const changed = updateAdminPassword(admin, payload.password);
      if (changed.error) { socket.emit('notification', { type: 'error', message: changed.error }); return; }
      admin.forcePasswordChange = nextRole !== 'master';
    }
    const floatDelta = finance.money(admin.withdrawalFloatBalance || 0) - finance.money(old.withdrawalFloatBalance || 0);
    if (floatDelta !== 0) {
      recordAdminCashMovement(wallets, {
        adminId: admin.id,
        type: 'float_adjustment',
        direction: floatDelta > 0 ? 'in' : 'out',
        amount: Math.abs(floatDelta),
        reference: 'admin_edit',
        note,
        source: 'admin_update_user',
        applyToFloat: false,
      });
    }
    ensureAdminReferralCodes(wallets);
    auditAdmin(wallets, socket, 'update_admin_user', { adminId, old, next: { name: admin.name, phone: admin.phone, role: admin.role, username: admin.username, active: admin.active, referralCode: admin.referralCode, referralActive: admin.referralActive, withdrawalFloatBalance: admin.withdrawalFloatBalance, telegramChatId: admin.telegramChatId || '', telegramUsername: admin.telegramUsername || '' }, reason: note });
    saveWallets(wallets);
    socket.emit('notification', { type: 'success', message: `Updated admin ${admin.name}.` });
    socket.emit('adminData', getAdminData(socket));
  });

  socket.on('join', (payload = {}) => {
    if (!allowSocketAction(socket, 'bingo-join', 10, 60 * 1000)) return;
    const betAmount = parseInt(payload.bet);
    const wallets = loadWallets();
    syncBingoRooms(wallets);
    const bingoSettings = activeGameSettings(wallets, 'bingo');
    if (!bingoSettings.bettingAmounts.includes(betAmount) || !gameRooms[betAmount]) { socket.emit('notification', { type: 'error', message: 'Invalid bet.' }); return; }
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('notification', { type: 'error', message: auth.error }); return; }
    let { id: playerKey, wallet } = auth;
    const cleanName = normalizeName(wallet.name);
    if (!cleanName) { socket.emit('notification', { type: 'error', message: 'Please enter a name.' }); return; }
    const room = gameRooms[betAmount];
    const existingEntry = Object.values(gameRooms).reduce((found, candidateRoom) => {
      if (found) return found;
      const player = candidateRoom.players.find(pl => pl.playerId === playerKey);
      return player ? { room: candidateRoom, player } : null;
    }, null);
    if (existingEntry) {
      const liveSocket = existingEntry.player.socketId && io.sockets.sockets.has(existingEntry.player.socketId);
      if (existingEntry.player.socketId !== socket.id && existingEntry.player.connected !== false && liveSocket) {
        socket.emit('notification', { type: 'error', message: 'This player is already in another room.' });
        return;
      }
      const reattached = reattachBingoPlayer(existingEntry.room, existingEntry.player, socket);
      wallet.name = cleanName;
      saveWallets(wallets);
      const activeGame = existingEntry.room.status === 'playing' || existingEntry.room.status === 'paused';
      socket.emit('joined', { playerId: playerKey, name: cleanName, phone: wallet.phone || '', bet: existingEntry.room.bet, balance: wallet.balance, totalWon: wallet.totalWon, totalLost: wallet.totalLost, wins: wallet.wins || 0, gamesPlayed: wallet.gamesPlayed, isMidGame: false, resumeGame: activeGame });
      emitBingoState(socket, existingEntry.room, reattached);
      io.to(`room-${existingEntry.room.bet}`).emit('lobbyUpdate', getRoomState(existingEntry.room));
      io.emit('roomCounts', getAllRoomCounts());
      return;
    }
    const isMidGame = (room.status === 'playing' || room.status === 'paused');
    if (isMidGame) {
      // Game in progress — player joins room as spectator, auto-added next round on gameReset
      console.log(`👤 ${cleanName} joined ${betAmount}B lobby mid-game, will join next round`);
    }
    if (room.players.length >= bingoSettings.maxPlayers) { socket.emit('notification', { type: 'error', message: 'Lobby full (max '+bingoSettings.maxPlayers+' players).' }); return; }
    if (isSuspended(wallets, playerKey)) { socket.emit('notification', { type: 'error', message: suspensionMessage(wallets, playerKey) }); return; }
    wallet.name = cleanName;
    saveWallets(wallets);
    if (wallet.balance < betAmount) { socket.emit('notification', { type: 'error', message: `Insufficient balance! ${wallet.balance} ETB, need ${betAmount}.` }); return; }
    const prevBet = socketRoom.get(socket.id);
    if (prevBet && prevBet !== betAmount) { const pr = gameRooms[prevBet]; const pp = pr.players.find(p => p.socketId === socket.id); if (pp) { if (pp.cartelaId) pr.takenCartelas.delete(pp.cartelaId); pr.players = pr.players.filter(p => p.socketId !== socket.id); if ((pr.status === 'countdown' || pr.status === 'lobby') && pr.players.length < bingoSettings.minPlayers) cancelCountdown(pr); if ((pr.status === 'playing' || pr.status === 'paused') && pr.players.length === 1) resolveLastPlayerBingoWin(pr, `${pp.name} switched lobby`); else if ((pr.status === 'playing' || pr.status === 'paused') && pr.players.length === 0) { moveAbandonedEscrowToCommission(pr, `All players left Bingo ${prevBet}B`); resetRoom(pr); } io.to(`room-${prevBet}`).emit('lobbyUpdate', getRoomState(pr)); io.to(`room-${prevBet}`).emit('playerLeft', { name: pp.name, remainingCount: pr.players.length }); } socket.leave(`room-${prevBet}`); }
    if (isMidGame) {
      socketRoom.set(socket.id, betAmount);
      socket.join(`room-${betAmount}`);
      socket.emit('joined', { playerId: playerKey, name: cleanName, phone: wallet.phone || '', bet: betAmount, balance: wallet.balance, totalWon: wallet.totalWon, totalLost: wallet.totalLost, wins: wallet.wins || 0, gamesPlayed: wallet.gamesPlayed, isMidGame: true });
      socket.emit('notification', { type: 'info', message: `Game in progress. You'll join the next round.` });
      io.to(`room-${betAmount}`).emit('lobbyUpdate', getRoomState(room));
      io.emit('roomCounts', getAllRoomCounts());
      return;
    }
    const oldIdx = room.players.findIndex(p => p.socketId === socket.id); if (oldIdx !== -1) { if (room.players[oldIdx].cartelaId) room.takenCartelas.delete(room.players[oldIdx].cartelaId); room.players.splice(oldIdx, 1); }
    const player = { socketId: socket.id, playerId: playerKey, name: cleanName, cartelaId: null, cartelaIndex: null, autoAssignedCartela: false, autoCheck: false, markedCells: new Set(), penaltyUntil: 0, falseBingoClaims: 0, connected: true, disconnectedAt: 0, disconnectTimer: null };
    room.players.push(player); socketRoom.set(socket.id, betAmount); socket.join(`room-${betAmount}`);
    console.log(`👤 ${cleanName} → ${betAmount}B lobby (${room.players.length}p)${isMidGame?' [mid-game]':''}`);
    if (!isMidGame && room.players.length >= bingoSettings.minPlayers && room.status === 'lobby') startCountdown(room);
    socket.emit('joined', { playerId: playerKey, name: cleanName, phone: wallet.phone || '', bet: betAmount, balance: wallet.balance, totalWon: wallet.totalWon, totalLost: wallet.totalLost, wins: wallet.wins || 0, gamesPlayed: wallet.gamesPlayed, isMidGame });
    if (isMidGame) socket.emit('notification', { type: 'info', message: `Game in progress. You'll join the next round.` });
    io.to(`room-${betAmount}`).emit('lobbyUpdate', getRoomState(room)); io.emit('roomCounts', getAllRoomCounts());
  });

  // ── CARTELA ──
  socket.on('selectCartela', ({ cartelaId }) => { if (!allowSocketAction(socket, 'bingo-select-card', 30, 60 * 1000)) return; const room = getRoom(socket.id); if (!room) return; const player = room.players.find(p => p.socketId === socket.id); if (!player) return; if (room.status !== 'lobby' && room.status !== 'countdown' && room.status !== 'finished') { socket.emit('notification', { type: 'error', message: 'Selection closed.' }); return; } const id = parseInt(cartelaId); if (isNaN(id) || id < 1 || id > CARTELAS.length) return; if (room.takenCartelas.has(id) && player.cartelaId !== id) { socket.emit('notification', { type: 'error', message: `Cartela ${id} taken!` }); return; } if (player.cartelaId && room.takenCartelas.has(player.cartelaId)) room.takenCartelas.delete(player.cartelaId); player.cartelaId = id; player.cartelaIndex = id - 1; player.autoAssignedCartela = false; room.takenCartelas.add(id); socket.emit('cartelaSelected', { cartelaId: id, cartelaName: `Cartela ${id}` }); io.to(`room-${room.bet}`).emit('lobbyUpdate', getRoomState(room)); });

  function resolveBingoPlayerForSocket(payload = {}) {
    let room = getRoom(socket.id);
    let p = room ? room.players.find(pl => pl.socketId === socket.id) : null;
    if (room && p) reattachBingoPlayer(room, p, socket);
    if ((!room || !p) && payload.bet && gameRooms[Number(payload.bet)]) {
      const wallets = loadWallets();
      const auth = authenticatePlayer(wallets, payload, socket);
      if (!auth.error) {
        room = gameRooms[Number(payload.bet)];
        p = room.players.find(pl => pl.playerId === auth.id);
        if (p) reattachBingoPlayer(room, p, socket);
      }
    }
    return { room, p };
  }

  // ── GAME ACTIONS ──
  socket.on('setBingoAutoCheck', (payload = {}) => {
    if (!allowSocketAction(socket, 'bingo-auto-check', 20, 60 * 1000)) return;
    const { room, p } = resolveBingoPlayerForSocket(payload);
    if (!room || !p) { socket.emit('notification', { type: 'warning', message: 'Reconnecting to Bingo. Please try again.' }); return; }
    p.autoCheck = payload.enabled === true;
    socket.emit('bingoAutoCheck', { enabled: !!p.autoCheck });
  });
  socket.on('toggleMark', (payload = {}) => {
    const { room, p } = resolveBingoPlayerForSocket(payload);
    if (!room || room.status !== 'playing') return;
    if (!p) return;
    if (p.autoCheck) { socket.emit('notification', { type: 'warning', message: 'Auto Check is on. Turn it off to mark manually.' }); return; }
    const r = Number(payload.row), c = Number(payload.col);
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r > 4 || c < 0 || c > 4 || (r === 2 && c === 2)) return;
    const k = `${r},${c}`;
    p.markedCells.has(k) ? p.markedCells.delete(k) : p.markedCells.add(k);
    socket.emit('markToggled', { row: r, col: c, marked: p.markedCells.has(k) });
  });
  socket.on('checkMarks', (payload = {}) => {
    if (!allowSocketAction(socket, 'bingo-check', 60, 60 * 1000)) return;
    const { room, p } = resolveBingoPlayerForSocket(payload);
    if (!room || !p) { socket.emit('notification', { type: 'warning', message: 'Reconnecting to Bingo. Please tap Check again.' }); return; }
    if (p.cartelaIndex == null) { socket.emit('notification', { type: 'warning', message: 'Cartela not ready yet.' }); return; }
    if (p.autoCheck) { socket.emit('notification', { type: 'info', message: 'Auto Check is on. Press BINGO yourself when you complete a line.' }); return; }
    const latest = room.calledNumbers[room.calledNumbers.length - 1];
    const card = CARTELAS[p.cartelaIndex];
    if (latest) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          if (card[r][c] === latest) {
            const k = `${r},${c}`;
            if (!p.markedCells.has(k)) {
              p.markedCells.add(k);
              socket.emit('markToggled', { row: r, col: c, marked: true, autoMarked: true });
            }
          }
        }
      }
    }
    const missedGraceSet = latest ? new Set([latest]) : new Set();
    socket.emit('checkResult', verifyMarks(card, p.markedCells, room.calledNumberSet, missedGraceSet));
  });
  socket.on('getBingoState', (payload = {}) => {
    if (!allowSocketAction(socket, 'bingo-state', 120, 60 * 1000)) return;
    const { room, p: player } = resolveBingoPlayerForSocket(payload);
    if (!room) return;
    emitBingoState(socket, room, player);
  });
  socket.on('claimBingo', (payload = {}) => {
    if (!allowSocketAction(socket, 'bingo-claim', 8, 60 * 1000)) return;
    const { room, p } = resolveBingoPlayerForSocket(payload);
    if (!room) return;
    if (!p || p.cartelaIndex == null) { socket.emit('notification', { type: 'error', message: 'Not in game.' }); return; }
    if (room.status === 'finished' || room.claimPending) return;
    if (room.status !== 'playing') { socket.emit('notification', { type: 'error', message: 'Bingo checks are paused.' }); return; }
    if (p.penaltyUntil > Date.now()) { socket.emit('notification', { type: 'error', message: `Penalized! Wait ${Math.ceil((p.penaltyUntil - Date.now()) / 1000)}s.` }); return; }
    console.log(`Bingo claim [${room.bet}B] ${p.name}`);
    const officialDrawnSet = officialBingoDrawSet(room);
    const markCheck = verifyMarks(CARTELAS[p.cartelaIndex], p.markedCells, officialDrawnSet);
    const patterns = markCheck.wrong.length === 0 ? checkMarkedBingo(CARTELAS[p.cartelaIndex], p.markedCells, officialDrawnSet) : [];
    const bingoSettings = getBingoSettings();
    const pot = room.escrowPot || room.players.length * room.bet, ws = Math.floor(pot * bingoSettings.winnerShare), comm = pot - ws;
    if (patterns.length > 0) {
      commitDuePendingDraw(room);
      clearTimeout(room.drawTimer); clearTimeout(room.pendingDrawTimer);
      room.drawTimer = null; room.pendingDrawTimer = null; room.pendingDraw = null;
      room.status = 'paused'; room.claimPending = true;
      io.to(`room-${room.bet}`).emit('bingoAnnouncement', { claimer: p.name, playerId: p.playerId, cartelaId: p.cartelaId, isValid: true, bet: room.bet, pot, winnerShare: ws, commission: comm });
      setTimeout(() => { if (room.claimPending && room.status === 'paused') endGame(room, p, patterns); }, 3000);
      return;
    }
    socket.emit('checkResult', markCheck);
    p.falseBingoClaims = (p.falseBingoClaims || 0) + 1;
    const penaltySeconds = p.falseBingoClaims === 1 ? bingoSettings.falseClaimFirstPenaltySeconds : bingoSettings.falseClaimRepeatPenaltySeconds;
    p.penaltyUntil = Date.now() + penaltySeconds * 1000;
    socket.emit('bingoAnnouncement', { claimer: p.name, cartelaId: p.cartelaId, isValid: false, penaltySeconds, falseClaimCount: p.falseBingoClaims, private: true });
    console.log('Invalid Bingo claim');
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    clearSocketActionLimits(socket); adminSockets.delete(socket.id); adminSessions.delete(socket.id);
    const bet = socketRoom.get(socket.id);
    if (!bet) return;
    const room = gameRooms[bet];
    const p = room?.players.find(pl => pl.socketId === socket.id);
    socketRoom.delete(socket.id);
    if (!room || !p) return;

    if (room.status === 'playing' || room.status === 'paused' || room.status === 'countdown') {
      p.connected = false;
      p.disconnectedAt = Date.now();
      clearBingoDisconnectTimer(p);
      p.disconnectTimer = setTimeout(() => finalizeBingoDisconnect(bet, p.playerId), BINGO_DISCONNECT_GRACE_MS);
      io.to(`room-${bet}`).emit('lobbyUpdate', getRoomState(room));
      return;
    }

    removeBingoPlayerFromRoom(room, p);
    const active = room.players.length;
    if (room.status === 'lobby' && active < getBingoSettings().minPlayers) cancelCountdown(room);
    io.to(`room-${bet}`).emit('lobbyUpdate', getRoomState(room));
    io.to(`room-${bet}`).emit('playerLeft', { name: p.name, remainingCount: active });
    broadcastCounts();
  });

  // ── LEAVE GAME ──
  socket.on('leaveGame', (payload = {}) => {
    let bet = socketRoom.get(socket.id);
    let room = bet ? gameRooms[bet] : null;
    let p = room ? room.players.find(pl => pl.socketId === socket.id) : null;
    if (!p && payload.bet && gameRooms[Number(payload.bet)]) {
      const wallets = loadWallets();
      const auth = authenticatePlayer(wallets, payload, socket);
      if (!auth.error) {
        bet = Number(payload.bet);
        room = gameRooms[bet];
        p = room.players.find(pl => pl.playerId === auth.id);
      }
    }
    if (!room || !p) { if (bet) socketRoom.delete(socket.id); return; }
    if (room.status === 'playing' || room.status === 'paused') {
      io.to(`room-${bet}`).emit('notification', { type: 'warning', message: `${p.name} left the game — forfeited ${room.bet} ETB!` });
    }
    clearBingoDisconnectTimer(p);
    if (p.cartelaId && room.takenCartelas.has(p.cartelaId)) room.takenCartelas.delete(p.cartelaId);
    for (const pl of room.players) {
      if (pl.socketId === socket.id || pl.playerId === p.playerId) socketRoom.delete(pl.socketId);
    }
    room.players = room.players.filter(pl => pl.socketId !== socket.id && pl.playerId !== p.playerId);
    socket.leave(`room-${bet}`);
    socketRoom.delete(socket.id);
    const active = room.players.length;
    const connectedActive = bingoConnectedPlayers(room).length;
    if ((room.status === 'countdown' || room.status === 'lobby') && active < getBingoSettings().minPlayers) cancelCountdown(room);
    if ((room.status === 'playing' || room.status === 'paused') && active === 1 && connectedActive === 1) {
      resolveLastPlayerBingoWin(room, `${p.name} left the game`);
    } else if (active === 0 && (room.status === 'playing' || room.status === 'paused')) {
      moveAbandonedEscrowToCommission(room, `All players left Bingo ${bet}B`);
      resetRoom(room);
    }
    io.to(`room-${bet}`).emit('lobbyUpdate', getRoomState(room));
    io.to(`room-${bet}`).emit('playerLeft', { name: p.name, remainingCount: active });
    broadcastCounts();
  });

  // ──────────────────────────────────────
  // ROULETTE
  // ──────────────────────────────────────

  socket.on('joinCrash', () => {
    socket.join('crash-room');
    socket.emit('crashState', getCrashState());
  });

  socket.on('leaveCrash', () => {
    socket.leave('crash-room');
  });

  socket.on('getCrashState', () => {
    socket.emit('crashState', getCrashState());
  });

  socket.on('placeCrashBet', (payload = {}) => {
    if (!allowSocketAction(socket, 'crash-bet', 12, 60 * 1000)) return;
    if (crashState.status !== 'waiting') {
      socket.emit('crashBetResult', { success: false, message: 'Betting is closed. Wait for the next run.' });
      return;
    }
    const amount = parseInt(payload.amount, 10);
    if (!CRASH_BETS.includes(amount)) {
      socket.emit('crashBetResult', { success: false, message: `Crash bet must be one of: ${CRASH_BETS.join(', ')} ETB.` });
      return;
    }
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('crashBetResult', { success: false, message: auth.error }); return; }
    const { id: playerKey, wallet } = auth;
    if (isSuspended(wallets, playerKey)) { socket.emit('crashBetResult', { success: false, message: suspensionMessage(wallets, playerKey) }); return; }
    if (crashState.bets[playerKey]) { socket.emit('crashBetResult', { success: false, message: 'You already have a bet in this run.' }); return; }
    if (wallet.balance < amount) { socket.emit('crashBetResult', { success: false, message: `Insufficient balance! ${wallet.balance} ETB, need ${amount}.` }); return; }
    const stake = finance.debitPlayerToAccount(wallets, playerKey, wallet, 'crashVault', amount, `Crash stake from ${wallet.name}`, 'crash_stake', { game: 'crash', round: crashState.roundNumber + 1 });
    if (stake.error) { socket.emit('crashBetResult', { success: false, message: stake.error }); return; }
    wallet.totalLost = (wallet.totalLost || 0) + amount;
    wallet.gamesPlayed = (wallet.gamesPlayed || 0) + 1;
    crashState.bets[playerKey] = { playerId: playerKey, playerName: wallet.name, socketId: socket.id, amount, placedAt: new Date().toISOString(), cashedOut: false };
    updateCrashRiskSnapshot(wallets);
    saveWallets(wallets);
    socket.emit('crashBetResult', { success: true, amount, account: publicWallet(playerKey, wallet) });
    io.emit('balanceUpdate', publicWallet(playerKey, wallet));
    broadcastCrashState();
  });

  socket.on('cashoutCrash', (payload = {}) => {
    if (!allowSocketAction(socket, 'crash-cashout', 25, 60 * 1000)) return;
    if (crashState.status !== 'running') {
      socket.emit('crashCashoutResult', { success: false, message: 'The runner is not live yet.' });
      return;
    }
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('crashCashoutResult', { success: false, message: auth.error }); return; }
    const current = crashLogic.multiplierAt(Date.now() - crashState.startedAt);
    if (current >= crashState.crashMultiplier) {
      crashRound('late_cashout', crashState.crashMultiplier);
      socket.emit('crashCashoutResult', { success: false, message: 'Too late. The run crashed.' });
      return;
    }
    const result = cashoutCrashBet(auth.id, current, 'player_cashout');
    if (result.error) socket.emit('crashCashoutResult', { success: false, message: result.error });
    broadcastCrashState();
  });

  // Join roulette room to receive state updates
  socket.on('joinRoulette', (payload = {}) => {
    socket.join('roulette-room');
    socket.emit('rouletteState', getRouletteState());
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (!auth.error) {
      relinkRouletteBetsToSocket(auth.id, socket.id);
      emitPersonalRouletteResult(socket, auth.id);
    }
  });

  socket.on('leaveRoulette', () => {
    socket.leave('roulette-room');
  });

  // Get current roulette state
  socket.on('getRouletteState', (payload = {}) => {
    socket.emit('rouletteState', getRouletteState());
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (!auth.error) {
      relinkRouletteBetsToSocket(auth.id, socket.id);
      emitPersonalRouletteResult(socket, auth.id);
    }
  });

  // Place a roulette bet
  socket.on('placeRouletteBet', (payload = {}) => {
    if (!allowSocketAction(socket, 'roulette-bet', 60, 60 * 1000)) return;
    if (rouletteState.status !== 'betting') {
      socket.emit('rouletteBetResult', { success: false, message: 'Betting is closed. Wait for next round.' });
      return;
    }

    const wallets = loadWallets();
    const rouletteSettings = activeGameSettings(wallets, 'roulette');
    const validation = rouletteLogic.validateBet(payload, rouletteSettings.bettingAmounts, rouletteSettings);
    if (validation.error) {
      socket.emit('rouletteBetResult', { success: false, message: validation.error });
      return;
    }

    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) {
      socket.emit('rouletteBetResult', { success: false, message: auth.error });
      return;
    }

    const { id: playerKey, wallet } = auth;
    const freePlayAdmin = adminFreePlayForWallet(wallets, playerKey, wallet);
    const freePlay = !!freePlayAdmin;
    if (rouletteSpinningPlayers.has(playerKey)) {
      socket.emit('rouletteBetResult', { success: false, message: 'Your roulette spin is already running.' });
      return;
    }
    if (isSuspended(wallets, playerKey)) {
      socket.emit('rouletteBetResult', { success: false, message: suspensionMessage(wallets, playerKey) });
      return;
    }

    const amount = Number(payload.amount);
    if (!freePlay && wallet.balance < amount) {
      socket.emit('rouletteBetResult', { success: false, message: `Insufficient balance! ${wallet.balance} ETB, need ${amount}.` });
      return;
    }

    const rouletteVault = gamePrizeVault('roulette');
    const maxReturn = projectedRouletteMaxPayout({ type: payload.type, numbers: payload.numbers, amount }, rouletteSettings);
    const prizeVaultAvailable = finance.money(wallets.company.accounts[rouletteVault]);
    if (!freePlay && maxReturn > prizeVaultAvailable) {
      socket.emit('rouletteBetResult', { success: false, message: 'Roulette Prize Vault is too low for this exposure right now.' });
      return;
    }

    // Guardrail: reject if this bet would let any player's max possible payout exceed 500,000 ETB
    const tempBets = { ...rouletteState.bets, __check: { playerId: playerKey, type: payload.type, numbers: payload.numbers, amount } };
    const projectedPlayerMax = rouletteLogic.playerMaxPossiblePayout(playerKey, tempBets, rouletteSettings);
    if (projectedPlayerMax > rouletteSettings.maxPlayerPayout) {
      socket.emit('rouletteBetResult', { success: false, message: `Table limit reached. Max payout per player is ${rouletteSettings.maxPlayerPayout.toLocaleString()} ETB per spin.` });
      return;
    }

    const betId = String(rouletteState.nextBetId++);
    const activeStakeKey = freePlay ? '' : activeStakeId('roulette', rouletteState.roundNumber + 1, playerKey, betId);
    if (!freePlay) {
      const stake = finance.debitPlayerToAccount(
        wallets, playerKey, wallet, 'gameEscrow', amount,
        `Roulette bet from ${wallet.name}`,
        'roulette_stake', { round: rouletteState.roundNumber + 1, type: payload.type, numbers: payload.numbers, escrow: 'gameEscrow' }
      );
      if (stake.error) { socket.emit('rouletteBetResult', { success: false, message: stake.error }); return; }
      wallet.totalLost = (wallet.totalLost || 0) + amount;
      wallet.gamesPlayed = (wallet.gamesPlayed || 0) + 1;
    }
    rouletteState.bets[betId] = {
      playerId: playerKey,
      playerName: wallet.name,
      socketId: socket.id,
      type: payload.type,
      numbers: payload.numbers,
      amount,
      staked: !freePlay,
      freePlay,
      freePlayAdminId: freePlayAdmin?.id || '',
      activeStakeKey,
    };
    if (!freePlay) {
      recordActiveGameStake(wallets, {
        id: activeStakeKey,
        game: 'roulette',
        round: rouletteState.roundNumber + 1,
        playerId: playerKey,
        playerName: wallet.name,
        amount,
        account: 'gameEscrow',
        meta: { betId, type: payload.type, numbers: payload.numbers },
      });
    }

    const playerTotal = Object.values(rouletteState.bets)
      .filter(b => b.playerId === playerKey)
      .reduce((sum, b) => sum + b.amount, 0);
    saveWallets(wallets);

    socket.emit('rouletteBetResult', {
      success: true,
      betId,
      bet: { type: payload.type, numbers: payload.numbers, amount },
      playerTotalBet: playerTotal,
      account: publicWallet(playerKey, wallet),
      balance: wallet.balance,
      freePlay,
    });
    io.emit('balanceUpdate', publicWallet(playerKey, wallet));

    broadcastRouletteState();
  });

  // Remove a roulette bet (only during betting phase)
  socket.on('removeRouletteBet', (payload = {}) => {
    if (!allowSocketAction(socket, 'roulette-remove-bet', 60, 60 * 1000)) return;
    if (rouletteState.status !== 'betting') {
      socket.emit('rouletteBetRemoved', { success: false, message: 'Cannot remove bets now.' });
      return;
    }
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('rouletteBetRemoved', { success: false, message: auth.error }); return; }
    if (rouletteSpinningPlayers.has(auth.id)) {
      socket.emit('rouletteBetRemoved', { success: false, message: 'Your roulette spin is already running.' });
      return;
    }
    const betId = String(payload.betId);
    const bet = rouletteState.bets[betId];
    if (!bet || bet.playerId !== auth.id) {
      socket.emit('rouletteBetRemoved', { success: false, message: 'Bet not found.' });
      return;
    }
    const wallet = wallets.players[bet.playerId];
    if (!wallet) { socket.emit('rouletteBetRemoved', { success: false, message: 'Player wallet not found.' }); return; }
    if (!bet.freePlay) {
      const refunded = finance.accountToPlayer(
        wallets, 'gameEscrow', bet.playerId, wallet, bet.amount,
        `Roulette bet removed for ${bet.playerName}`,
        'roulette_bet_refund', { round: rouletteState.roundNumber + 1, betId, type: bet.type, numbers: bet.numbers, escrow: 'gameEscrow' }
      );
      if (refunded.error) { socket.emit('rouletteBetRemoved', { success: false, message: refunded.error }); return; }
      wallet.totalLost = Math.max(0, (wallet.totalLost || 0) - bet.amount);
      wallet.gamesPlayed = Math.max(0, (wallet.gamesPlayed || 0) - 1);
      clearActiveGameStake(wallets, bet.activeStakeKey || activeStakeId('roulette', rouletteState.roundNumber + 1, bet.playerId, betId));
    }
    saveWallets(wallets);
    delete rouletteState.bets[betId];
    socket.emit('rouletteBetRemoved', { success: true, betId, account: publicWallet(bet.playerId, wallet) });
    io.emit('balanceUpdate', publicWallet(bet.playerId, wallet));
    broadcastRouletteState();
  });

  socket.on('spinMyRoulette', (payload = {}) => {
    if (!allowSocketAction(socket, 'roulette-spin-player', 10, 60 * 1000)) return;
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('rouletteSpinResult', { success: false, message: auth.error }); return; }
    if (isSuspended(wallets, auth.id)) {
      socket.emit('rouletteSpinResult', { success: false, message: suspensionMessage(wallets, auth.id) });
      return;
    }
    if (rouletteSpinningPlayers.has(auth.id)) {
      socket.emit('rouletteSpinResult', { success: false, message: 'Your roulette spin is already running.' });
      return;
    }
    relinkRouletteBetsToSocket(auth.id, socket.id);
    const myBets = Object.entries(rouletteState.bets).filter(([, bet]) => bet.playerId === auth.id);
    if (!myBets.length) {
      socket.emit('rouletteSpinResult', { success: false, message: 'Place a bet first.' });
      return;
    }
    rouletteSpinningPlayers.add(auth.id);
    const roundNumber = ++rouletteState.roundNumber;
    const serverSeed = fairRng.randomServerSeed();
    const preview = rouletteLogic.spinWheel(serverSeed, roundNumber);
    socket.emit('rouletteSpinResult', {
      success: true,
      roundNumber,
      winningNumber: preview.number,
      winningColor: preview.color,
      serverSeedHash: preview.proof.serverSeedHash,
      betCount: myBets.length,
    });
    setTimeout(() => processPlayerRouletteSpin(auth.id, socket.id, { roundNumber, result: preview }), ROULETTE_RESULT_PROCESS_DELAY_MS);
    broadcastRouletteState();
  });

  // Get player's current bets
  socket.on('getMyRouletteBets', (payload = {}) => {
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    const playerKey = auth.error ? socket.data.playerId : auth.id;
    if (!auth.error) relinkRouletteBetsToSocket(auth.id, socket.id);
    if (rouletteState.status === 'result') {
      socket.emit('myRouletteBets', { bets: [] });
      return;
    }
    const myBets = Object.entries(rouletteState.bets)
      .filter(([, b]) => playerKey ? b.playerId === playerKey : b.socketId === socket.id)
      .map(([id, b]) => ({ betId: id, type: b.type, numbers: b.numbers, amount: b.amount }));
    socket.emit('myRouletteBets', { bets: myBets });
  });

  // ── ADMIN: Manual spin ──
  socket.on('adminRouletteSpin', ({ note } = {}) => {
    if (!requireAdminPermission(socket, 'roulette_control')) return;
    if (!allowProductionAdminGameControl(socket, 'Manual roulette spin')) return;
    if (rouletteState.status !== 'betting') {
      socket.emit('notification', { type: 'error', message: 'Roulette is not in betting phase.' });
      return;
    }
    const reason = requireNote(socket, note);
    if (!reason) return;
    const wallets = loadWallets();
    auditAdmin(wallets, socket, 'roulette_spin', { reason, round: rouletteState.roundNumber + 1 });
    saveWallets(wallets);
    spinRouletteWheel();
    socket.emit('notification', { type: 'success', message: 'Roulette spinning!' });
  });

  // ── ADMIN: Skip to next round ──
  socket.on('adminRouletteSkipResult', ({ note } = {}) => {
    if (!requireAdminPermission(socket, 'roulette_control')) return;
    if (!allowProductionAdminGameControl(socket, 'Roulette result skip')) return;
    if (rouletteState.status !== 'result') {
      socket.emit('notification', { type: 'error', message: 'No result to skip.' });
      return;
    }
    const reason = requireNote(socket, note);
    if (!reason) return;
    clearTimeout(rouletteState.resultTimer);
    const wallets = loadWallets();
    auditAdmin(wallets, socket, 'roulette_skip_result', { reason });
    saveWallets(wallets);
    resetRouletteRound();
    broadcastRouletteState();
    startRouletteCountdown();
  });

  // ── ADMIN: Force spin now ──
  socket.on('adminRouletteForceSpin', ({ note } = {}) => {
    if (!requireAdminPermission(socket, 'roulette_control')) return;
    if (!allowProductionAdminGameControl(socket, 'Roulette force spin')) return;
    if (rouletteState.status !== 'betting') {
      socket.emit('notification', { type: 'error', message: 'Roulette not in betting phase.' });
      return;
    }
    const reason = requireNote(socket, note);
    if (!reason) return;
    const wallets = loadWallets();
    auditAdmin(wallets, socket, 'roulette_force_spin', { reason });
    saveWallets(wallets);
    clearInterval(rouletteState.countdownTimer);
    rouletteState.countdownTimer = null;
    spinRouletteWheel();
  });

  // ── ADMIN: Manual number (for testing / rigged games) ──
  socket.on('adminRouletteSetNumber', ({ number, note } = {}) => {
    if (!requireAdminPermission(socket, 'roulette_control')) return;
    if (!allowProductionAdminGameControl(socket, 'Manual roulette number')) return;
    if (rouletteState.status !== 'betting') {
      socket.emit('notification', { type: 'error', message: 'Roulette not in betting phase.' });
      return;
    }
    const num = Number(number);
    if (!Number.isInteger(num) || num < 0 || num > 36) {
      socket.emit('notification', { type: 'error', message: 'Number must be 0-36.' });
      return;
    }
    const reason = requireNote(socket, note);
    if (!reason) return;
    const wallets = loadWallets();
    auditAdmin(wallets, socket, 'roulette_set_number', { number: num, reason });
    saveWallets(wallets);
    clearInterval(rouletteState.countdownTimer);
    rouletteState.countdownTimer = null;
    rouletteState.status = 'spinning';
    rouletteState.roundNumber++;
    rouletteState.winningNumber = num;
    rouletteState.winningColor = rouletteLogic.getNumberColor(num);
    broadcastRouletteState();
    setTimeout(() => processRouletteResults(), ROULETTE_RESULT_PROCESS_DELAY_MS);
  });

  // ── DINO BETTING RACE ──
  socket.on('joinDinoRoom', (payload = {}) => {
    if (!allowSocketAction(socket, 'dino-join', 12, 60 * 1000)) return;
    const roomId = payload.roomId;
    if (!roomId) { socket.emit('dinoJoinResult', { success: false, message: 'No room ID.' }); return; }
    let room = dinoRooms.get(roomId);
    if (!room) { socket.emit('dinoJoinResult', { success: false, message: 'Room not found.' }); return; }
    if (room.status !== 'lobby' && room.status !== 'countdown') {
      socket.emit('dinoJoinResult', { success: false, message: 'Race already started.' }); return;
    }

    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('dinoJoinResult', { success: false, message: auth.error }); return; }
    const { id: playerKey, wallet } = auth;
    if (isSuspended(wallets, playerKey)) { socket.emit('dinoJoinResult', { success: false, message: suspensionMessage(wallets, playerKey) }); return; }
    if (room.players[playerKey]) {
      // Already in room — rejoin
      room.players[playerKey].socketId = socket.id;
      socket.join(`dino-room-${roomId}`);
      socket.emit('dinoJoinResult', { success: true, room });
      return;
    }
    if (wallet.balance < room.entryFee) {
      socket.emit('dinoJoinResult', { success: false, message: `Need ${room.entryFee} ETB to join. Balance: ${wallet.balance} ETB.` });
      return;
    }
    if (Object.keys(room.players).length >= room.maxPlayers) {
      socket.emit('dinoJoinResult', { success: false, message: 'Room is full!' }); return;
    }

    // Deduct entry fee
    const deduction = finance.debitPlayerToAccount(wallets, playerKey, wallet, 'gameEscrow', room.entryFee,
      `${wallet.name} joined Dino race (${room.entryFee} ETB)`, 'dino_entry', { roomId });
    if (deduction.error) { socket.emit('dinoJoinResult', { success: false, message: deduction.error }); return; }

    wallet.totalLost = (wallet.totalLost || 0) + room.entryFee;
    wallet.gamesPlayed = (wallet.gamesPlayed || 0) + 1;

    room.players[playerKey] = {
      name: wallet.name,
      socketId: socket.id,
      distance: 0,
      y: 0,
      vy: 0,
      ducking: false,
      alive: true,
      finishTime: null,
      joinTime: Date.now(),
    };
    recalculateDinoMoney(room);

    saveWallets(wallets);
    socket.join(`dino-room-${roomId}`);
    socket.emit('dinoJoinResult', { success: true, room });
    socket.emit('balanceUpdate', publicWallet(playerKey, wallet));
    dinoRoomBroadcast(roomId, 'dinoPlayerJoined', { playerId: playerKey, name: wallet.name, count: Object.keys(room.players).length });
    io.emit('dinoRoomList', getDinoRoomList());

    // Start countdown when enough players are present. Default is 1 for local solo testing.
    if (Object.keys(room.players).length >= DINO_MIN_PLAYERS && room.status === 'lobby') {
      room.status = 'countdown';
      room.countdownStart = Date.now();
      room.countdownDuration = DINO_COUNTDOWN_MS;
      dinoRoomBroadcast(roomId, 'dinoCountdownStart', { startTime: room.countdownStart, duration: DINO_COUNTDOWN_MS });
      io.emit('dinoRoomList', getDinoRoomList());

      const countdownTimer = setTimeout(() => {
        const r = dinoRooms.get(roomId);
        if (r && r.status === 'countdown') startDinoRace(roomId);
      }, DINO_COUNTDOWN_MS);

      const t = dinoRoomTimers.get(roomId) || {};
      t.countdown = countdownTimer;
      dinoRoomTimers.set(roomId, t);
    }

    // Check if room is full → skip countdown, start immediately
    if (Object.keys(room.players).length >= room.maxPlayers) {
      const t = dinoRoomTimers.get(roomId);
      if (t && t.countdown) clearTimeout(t.countdown);
      if (room.status === 'countdown' || room.status === 'lobby') startDinoRace(roomId);
    }
  });

  socket.on('leaveDinoRoom', (payload = {}) => {
    const roomId = payload.roomId;
    if (!roomId) return;
    socket.leave(`dino-room-${roomId}`);

    const room = dinoRooms.get(roomId);
    if (!room) return;

    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) return;
    const playerKey = auth.id;

    if (room.players[playerKey] && (!room.players[playerKey].alive || room.status === 'lobby' || room.status === 'countdown')) {
      if (room.status === 'lobby' || room.status === 'countdown') {
        refundDinoEntry(room, playerKey, `${auth.wallet.name} left Dino race before start`);
      }
      delete room.players[playerKey];
      recalculateDinoMoney(room);
      if (room.status === 'countdown' && Object.keys(room.players).length < DINO_MIN_PLAYERS) {
        const timers = dinoRoomTimers.get(roomId);
        if (timers?.countdown) clearTimeout(timers.countdown);
        room.status = 'lobby';
        room.countdownStart = null;
      }
      dinoRoomBroadcast(roomId, 'dinoPlayerLeft', { playerId: playerKey, count: Object.keys(room.players).length });
      io.emit('dinoRoomList', getDinoRoomList());

      // If room empty, cleanup
      if (Object.keys(room.players).length === 0) cleanupDinoRoom(roomId);
    }
  });

  socket.on('dinoJump', (payload = {}) => {
    if (!allowSocketAction(socket, 'dino-jump', 120, 60 * 1000)) return;
    const roomId = payload.roomId;
    const room = dinoRooms.get(roomId);
    if (!room || room.status !== 'racing') return;

    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) return;
    const player = room.players[auth.id];
    if (!player || !player.alive) return;

    // Only jump if on ground
    if (player.y <= 0 && player.vy <= 0) {
      player.ducking = false;
      player.vy = dinoLogic.JUMP_VELOCITY;
    }
  });

  socket.on('dinoDuck', (payload = {}) => {
    if (!allowSocketAction(socket, 'dino-duck', 180, 60 * 1000)) return;
    const { roomId, ducking } = payload;
    const room = dinoRooms.get(roomId);
    if (!room || room.status !== 'racing') return;
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) return;
    const player = room.players[auth.id];
    if (!player || !player.alive) return;
    player.ducking = !!ducking && (player.y || 0) <= 2;
  });

  socket.on('dinoCollision', (payload = {}) => {
    if (!allowSocketAction(socket, 'dino-collision', 30, 60 * 1000)) return;
    const roomId = payload.roomId;
    const room = dinoRooms.get(roomId);
    if (!room || room.status !== 'racing') return;

    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) return;
    const player = room.players[auth.id];
    if (!player || !player.alive) return;

    // Mark as eliminated
    player.alive = false;
    player.finishTime = Date.now();

    dinoRoomBroadcast(roomId, 'dinoPlayerEliminated', { playerId: auth.id, distance: Math.round(player.distance) });

    // Check if game should end
    const end = dinoLogic.shouldEndGame(room);
    if (end) finishDinoRace(roomId, end);
  });

  socket.on('getDinoRoomList', () => {
    socket.emit('dinoRoomList', getDinoRoomList());
  });

  socket.on('createDinoRoom', (payload = {}) => {
    if (!allowSocketAction(socket, 'dino-create-room', 8, 60 * 1000)) return;
    const entryFee = Number(payload.entryFee) || 10;
    if (!dinoLogic.ENTRY_FEES.includes(entryFee)) {
      socket.emit('dinoCreateResult', { success: false, message: `Entry fee must be one of: ${dinoLogic.ENTRY_FEES.join(', ')}` });
      return;
    }
    const maxPlayers = Math.min(50, Math.max(2, Number(payload.maxPlayers) || 10));

    const roomId = fairRng.randomId('dino');
    const room = dinoLogic.createRoom(roomId, entryFee, maxPlayers);
    dinoRooms.set(roomId, room);

    socket.emit('dinoCreateResult', { success: true, roomId });
    io.emit('dinoRoomList', getDinoRoomList());
  });

  // ── HI-LO ──
  socket.on('hiloPlaceBet', (payload = {}) => {
    if (!allowSocketAction(socket, 'hilo-bet', 30, 60 * 1000)) return;
    const choice = payload.choice;
    if (!['higher','lower','tie'].includes(choice)) {
      socket.emit('hiloBetResult', { success: false, message: 'Invalid bet type.' });
      return;
    }
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('hiloBetResult', { success: false, message: auth.error }); return; }
    const playerKey = auth.id;
    const wallet = auth.wallet;
    if (isSuspended(wallets, playerKey)) { socket.emit('hiloBetResult', { success: false, message: suspensionMessage(wallets, playerKey) }); return; }
    const state = ensureHiloState(playerKey, socket);
    if (state.status !== 'betting') {
      socket.emit('hiloBetResult', { success: false, message: 'Not betting phase.' });
      return;
    }
    const multipliers = hiloLogic.getCurrentMultipliers(state);
    const availableChoices = multipliers.available || [];
    if (!availableChoices.includes(choice) || !multipliers[choice]) {
      socket.emit('hiloBetResult', { success: false, message: 'That choice is not available for this card.' });
      return;
    }
    let amount = finance.money(state.activeStake);
    const isFreshStake = amount <= 0;
    if (amount <= 0) {
      amount = Math.floor(Math.abs(Number(payload.amount) || 0));
      if (amount < hiloLogic.MIN_BET_ETB) {
        socket.emit('hiloBetResult', { success: false, message: 'Minimum bet: ' + hiloLogic.MIN_BET_ETB + ' ETB.' });
        return;
      }
      if (wallet.balance < amount) {
        socket.emit('hiloBetResult', { success: false, message: 'Insufficient balance.' });
        return;
      }
    }
    const projectedMultiplier = hiloLogic.compoundMultiplier(state.effectiveMultiplier || 1, multipliers[choice]);
    const projectedPayout = hiloLogic.calculatePayout(amount, projectedMultiplier);
    const projectedVault = finance.money(wallets.company.accounts.prizeVault) + (isFreshStake ? amount : 0);
    if (projectedPayout > projectedVault) {
      socket.emit('hiloBetResult', { success: false, message: 'Prize vault cannot cover that Hi-Lo payout right now. Please cash out or try a safer choice.' });
      return;
    }
    if (isFreshStake) {
      const deduction = finance.debitPlayerToAccount(wallets, playerKey, wallet, 'prizeVault', amount, wallet.name + ' Hi-Lo bet', 'hilo_bet', { choice, round: state.roundNumber });
      if (deduction.error) { socket.emit('hiloBetResult', { success: false, message: deduction.error }); return; }
      state.activeStake = amount;
      wallet.totalLost = (wallet.totalLost || 0) + amount;
      wallet.gamesPlayed = (wallet.gamesPlayed || 0) + 1;
    }
    state.playerChoice = choice;
    state.playerBet = amount;
    state.status = 'dealing';
    saveWallets(wallets);
    socket.join('hilo-room');
    socket.emit('balanceUpdate', publicWallet(playerKey, wallet));
    socket.emit('hiloBetResult', { success: true, amount, choice });
    emitHiloState(playerKey);
    scheduleHiloResolve(playerKey);
  });

  socket.on('hiloCashOut', (payload = {}) => {
    if (!allowSocketAction(socket, 'hilo-cashout', 30, 60 * 1000)) return;
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('hiloCashOutResult', { success: false, message: auth.error }); return; }
    const playerKey = auth.id;
    const wallet = auth.wallet;
    const state = ensureHiloState(playerKey, socket);
    if (state.status !== 'result') {
      socket.emit('hiloCashOutResult', { success: false, message: 'Not result phase.' });
      return;
    }
    if (!state.playerWon || state.activeStake <= 0) {
      socket.emit('hiloCashOutResult', { success: false, message: 'No winnings.' });
      return;
    }
    if (isSuspended(wallets, playerKey)) { socket.emit('hiloCashOutResult', { success: false, message: suspensionMessage(wallets, playerKey) }); return; }
    const payout = hiloLogic.calculatePayout(state.activeStake, state.effectiveMultiplier);
    const paid = finance.accountToPlayer(wallets, 'prizeVault', playerKey, wallet, payout, wallet.name + ' Hi-Lo cashout', 'hilo_cashout', { round: state.roundNumber, multiplier: state.effectiveMultiplier });
    if (paid.error) { socket.emit('hiloCashOutResult', { success: false, message: paid.error }); return; }
    wallet.totalWon = (wallet.totalWon || 0) + payout;
    wallet.wins = (wallet.wins || 0) + 1;
    const receipt = recordGameHistory(wallets, {
      game: 'hilo',
      playerId: playerKey,
      playerName: wallet.name,
      bet: state.activeStake,
      payout,
      status: 'won',
      details: {
        round: state.roundNumber,
        choice: state.playerChoice,
        baseCard: state.baseCard,
        nextCard: state.nextCard,
        multiplier: state.effectiveMultiplier,
      },
    });
    const paidMultiplier = state.effectiveMultiplier;
    state.activeStake = 0;
    state.effectiveMultiplier = 1;
    state.playerBet = 0;
    notifyPlayerWin(wallets, playerKey, wallet, 'hilo', payout, { round: receipt.details?.round });
    saveWallets(wallets);
    socket.emit('balanceUpdate', publicWallet(playerKey, wallet));
    socket.emit('hiloCashOutResult', { success: true, payout, multiplier: paidMultiplier, receipt: publicReceipt(receipt, true) });
    socket.emit('receiptRecorded', publicReceipt(receipt, true));
    socket.emit('notification', { type: 'success', message: 'Cash out: ' + payout + ' ETB @ ' + paidMultiplier + 'x' });
    startHiloRound(playerKey, false);
  });

  socket.on('hiloContinueStreak', (payload = {}) => {
    if (!allowSocketAction(socket, 'hilo-continue', 30, 60 * 1000)) return;
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    if (auth.error) { socket.emit('notification', { type: 'error', message: auth.error }); return; }
    const state = ensureHiloState(auth.id, socket);
    if (state.status !== 'result' || !state.playerWon || state.activeStake <= 0) {
      socket.emit('notification', { type: 'error', message: 'Cannot continue streak now.' });
      return;
    }
    startHiloRound(auth.id, true);
  });

  socket.on('hiloJoin', (payload = {}) => {
    socket.join('hilo-room');
    const wallets = loadWallets();
    const auth = authenticatePlayer(wallets, payload, socket);
    const playerKey = auth.error ? socket.data.playerId : auth.id;
    if (playerKey) {
      ensureHiloState(playerKey, socket);
      emitHiloState(playerKey);
    }
  });

  socket.on('hiloLeave', () => {
    socket.leave('hilo-room');
  });
});

// Roulette is player-triggered: players place bets, then press Spin.
updateCrashRiskSnapshot();
startCrashCountdown();

recoverStaleEscrow();
startAccountingReportScheduler();

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the existing game server or set PORT to another value.`);
    notifySystemInterruption(`Port ${PORT} is already in use. Server could not start normally.`);
    return;
  }
  console.error('Server error:', error);
  notifySystemInterruption(`Server error: ${error.message || error}`);
});

process.on('unhandledRejection', (reason) => {
  const message = reason?.stack || reason?.message || String(reason);
  console.error('Unhandled rejection:', message);
  notifySystemInterruption(`Unhandled rejection:\n${message.slice(0, 1200)}`);
});

process.on('uncaughtException', (error) => {
  const message = error?.stack || error?.message || String(error);
  console.error('Uncaught exception:', message);
  notifySystemInterruption(`Uncaught exception:\n${message.slice(0, 1200)}`);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 1000);
});

server.listen(PORT, () => {
  const wallets = loadWallets();
  updateCachedCompanyStats(wallets); // prime cache for broadcastCounts
  const health = finance.financeHealth(wallets);
  const database = safeWalletStoreInfo();
  const warnings = systemWarnings(wallets);
  console.log('\n🎱  SPRINTSALES GAMEHUB');
  console.log('════════════════════════════════════');
  console.log(`   URL:      http://localhost:${PORT}`);
  console.log(`   Games:    Bingo · Keno · Roulette · Crash`);
  console.log(`   Bets:     ${BETS.map(b => b + ' ETB').join(', ')}`);
  console.log(`   Split:    80% / 20%`);
  console.log(`   Start:    ${STARTING_BALANCE} ETB`);
  console.log(`   Company:  ${wallets.company.totalCommission} ETB commission`);
  console.log(`   Players:  ${Object.keys(wallets.players).length} registered`);
  console.log(`   DB:       rev ${database.revision || 0} ${database.hashOk === false ? 'HASH WARNING' : 'OK'}`);
  if (!health.ok) console.log(`   Finance:  ${health.issues.length} warning(s) - check /health`);
  if (warnings.length) console.log(`   Config:   ${warnings.length} warning(s) - check /health`);
  console.log('════════════════════════════════════\n');
});
