const path = require('path');
const crypto = require('crypto');
const { createWalletStore } = require('../lib/walletStore');
const finance = require('../lib/finance');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const force = args.has('--force');
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const codexBalance = Number(process.env.CODEX_BALANCE || 500000);
const defaultBalance = Number(process.env.DEFAULT_PLAYER_BALANCE || 50);
const abebaName = String(process.env.OWNER_PLAYER_NAME || 'abeba gesese').trim().toLowerCase();
const codexPhone = String(process.env.CODEX_PHONE || '0900000001');
const codexPin = String(process.env.CODEX_PIN || '0000');

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function money(value) {
  return finance.money(value);
}

function hashPin(pin) {
  const cleanPin = String(pin || '').replace(/\D/g, '').substring(0, 4);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(cleanPin, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function resetPlayer(wallet, balance) {
  wallet.balance = money(balance);
  wallet.pendingWithdrawal = 0;
  wallet.totalWon = 0;
  wallet.totalLost = 0;
  wallet.gamesPlayed = 0;
  wallet.wins = 0;
  wallet.mustChangePin = false;
  delete wallet.activeGame;
  delete wallet.activeStake;
  delete wallet.currentGame;
  delete wallet.lastGame;
  delete wallet.lossStreak;
  delete wallet.coolDownUntil;
  delete wallet.history;
  delete wallet.receipts;
  return wallet;
}

function ensureCodexPlayer(wallets) {
  const entries = Object.entries(wallets.players || {});
  const codexEntries = entries.filter(([, wallet]) => normalizeName(wallet.name) === 'codex');
  const keepId = codexEntries[0]?.[0] || `acct:${codexPhone}`;
  for (const [id] of codexEntries.slice(1)) delete wallets.players[id];
  if (!wallets.players[keepId]) {
    wallets.players[keepId] = {
      id: keepId,
      name: 'Codex',
      phone: codexPhone,
      pinHash: hashPin(codexPin),
      balance: 0,
      totalWon: 0,
      totalLost: 0,
      gamesPlayed: 0,
      wins: 0,
      createdAt: new Date().toISOString(),
      ageConfirmedAt: new Date().toISOString(),
      policyAcceptedAt: new Date().toISOString(),
      policyVersion: 'cutover-test',
    };
  }
  wallets.players[keepId].name = 'Codex';
  wallets.players[keepId].phone = wallets.players[keepId].phone || codexPhone;
  wallets.players[keepId].pinHash = wallets.players[keepId].pinHash || hashPin(codexPin);
  return keepId;
}

function main() {
  const store = createWalletStore({ dataDir, legacyWalletFile: path.join(dataDir, 'wallets.json') });
  const wallets = store.load();
  if (!wallets) throw new Error(`No wallet state found in ${dataDir}`);
  wallets.players = wallets.players || {};
  wallets.company = wallets.company || {};
  wallets.requests = wallets.requests || [];
  wallets.gameSettings = wallets.gameSettings || {};
  wallets.gameSettings.active = wallets.gameSettings.active || {};
  wallets.gameSettings.active.wallet = {
    ...(wallets.gameSettings.active.wallet || {}),
    signupPromoEnabled: true,
    signupPromoAmount: defaultBalance,
    withdrawalFeeEnabled: true,
    withdrawalFeeRate: 0.02,
    withdrawalFeeFlat: 0,
  };

  const abebaMatches = Object.entries(wallets.players).filter(([, wallet]) => normalizeName(wallet.name) === abebaName);
  if (abebaMatches.length !== 1) {
    throw new Error(`Expected exactly one "${abebaName}" player, found ${abebaMatches.length}. Run dry-run and inspect names before cleanup.`);
  }
  const [abebaId, abebaWallet] = abebaMatches[0];
  const abebaBalance = money(abebaWallet.balance);
  const codexId = ensureCodexPlayer(wallets);

  const beforePlayers = Object.keys(wallets.players).length;
  for (const [id, wallet] of Object.entries(wallets.players)) {
    if (id === abebaId) resetPlayer(wallet, abebaBalance);
    else if (id === codexId) resetPlayer(wallet, codexBalance);
    else resetPlayer(wallet, defaultBalance);
  }

  wallets.requests = [];
  wallets.gameHistory = [];
  wallets.auditLog = [];
  wallets.auditArchive = {};
  wallets.auditState = {};
  wallets.adminAudit = [];
  wallets.paymentSmsInbox = [];
  wallets.usedPaymentRefs = {};
  wallets.notificationState = {};
  wallets.responsibleGamingWarnings = {};
  wallets.suspendedPlayers = {};
  wallets.activeGameStakes = {};

  wallets.company.transactions = [];
  wallets.company.ledger = [];
  wallets.company.totalCommission = 0;
  wallets.company.totalPaidOut = 0;
  wallets.company.balance = 0;
  wallets.company.accounts = { ...finance.DEFAULT_ACCOUNTS };
  wallets.company.accounts.playerLiability = finance.playerLiabilityTotal(wallets);
  wallets.company.accounts.withdrawals = finance.pendingWithdrawalTotal(wallets);
  wallets.company.financeMigratedAt = wallets.company.financeMigratedAt || new Date().toISOString();
  wallets.company.gamePrizeVaultsMigratedAt = wallets.company.gamePrizeVaultsMigratedAt || new Date().toISOString();
  finance.ensureFinance(wallets);

  const summary = {
    dryRun,
    dataDir,
    players: beforePlayers,
    abeba: { id: abebaId, name: abebaWallet.name, balance: abebaBalance },
    codex: { id: codexId, balance: codexBalance },
    defaultBalance,
    playerLiability: wallets.company.accounts.playerLiability,
    accounts: wallets.company.accounts,
    financeHealth: finance.financeHealth(wallets),
  };

  if (!summary.financeHealth.ok) {
    throw new Error(`Finance health failed after cleanup: ${JSON.stringify(summary.financeHealth.issues)}`);
  }

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    store.close();
    return;
  }
  if (!force) {
    throw new Error('Refusing to write without --force. Run with --dry-run first, then --force.');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = store.backupTo(path.join(dataDir, 'backups', `pre-real-money-reset-${stamp}.sqlite`));
  store.save(wallets);
  console.log(JSON.stringify({ ...summary, backup }, null, 2));
  store.close();
}

main();
