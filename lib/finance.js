const fs = require('fs');
const path = require('path');
const { randomId } = require('./fairRng');

const ACCOUNT_LABELS = {
  playerLiability: 'Player Wallet Pool',
  prizeVault: 'Legacy Shared Prize Reserve',
  bingoPrizeVault: 'Bingo Prize Vault',
  kenoPrizeVault: 'Keno Prize Vault',
  roulettePrizeVault: 'Roulette Prize Vault',
  kenoHouseWinVault: 'Keno House Win Vault',
  rouletteHouseWinVault: 'Roulette House Win Vault',
  crashVault: 'Crash Game Vault',
  gameEscrow: 'Game Escrow',
  commission: 'GGR / Commission',
  withdrawalFeeVault: 'Withdrawal Fee Vault',
  promotion: 'Marketing & Promo Vault',
  operating: 'Operating Funds',
  withdrawals: 'Pending Withdrawals',
};

const DEFAULT_ACCOUNTS = Object.freeze({
  playerLiability: 0,
  prizeVault: 0,
  bingoPrizeVault: 0,
  kenoPrizeVault: 0,
  roulettePrizeVault: 0,
  kenoHouseWinVault: 0,
  rouletteHouseWinVault: 0,
  crashVault: 0,
  gameEscrow: 0,
  commission: 0,
  withdrawalFeeVault: 0,
  promotion: 0,
  operating: 0,
  withdrawals: 0,
});
function financeJournalPath() {
  return process.env.FINANCE_JOURNAL_FILE ||
    path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'finance-ledger.jsonl');
}

function appendFinanceJournal(entry) {
  const filePath = financeJournalPath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.error('Finance journal append failed:', error.message);
  }
}

function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function playerLiabilityTotal(wallets) {
  return Object.values(wallets.players || {}).reduce((sum, wallet) => sum + money(wallet.balance), 0);
}

function pendingWithdrawalTotal(wallets) {
  return Object.values(wallets.players || {}).reduce((sum, wallet) => sum + money(wallet.pendingWithdrawal), 0);
}

function appendFinanceAuditEvent(wallets, ledgerEntry) {
  if (!wallets.auditLog) wallets.auditLog = [];
  wallets.auditLog.unshift({
    id: randomId('aud_evt'),
    time: ledgerEntry.time,
    category: 'finance',
    event: ledgerEntry.type,
    actorType: 'system',
    actorId: '',
    playerId: ledgerEntry.meta?.playerId || '',
    game: ledgerEntry.meta?.game || '',
    amount: money(ledgerEntry.amount),
    details: {
      from: ledgerEntry.from,
      to: ledgerEntry.to,
      desc: ledgerEntry.desc,
      meta: ledgerEntry.meta || {},
    },
  });
}

function ensureFinance(wallets) {
  if (!wallets.company) wallets.company = {};
  if (!wallets.players) wallets.players = {};
  if (!wallets.requests) wallets.requests = [];
  if (!wallets.company.transactions) wallets.company.transactions = [];
  if (!wallets.company.ledger) wallets.company.ledger = [];

  const previousAccounts = wallets.company.accounts || {};
  wallets.company.accounts = { ...DEFAULT_ACCOUNTS, ...previousAccounts };

  if (!wallets.company.financeMigratedAt) {
    wallets.company.accounts.playerLiability = playerLiabilityTotal(wallets);
    wallets.company.accounts.withdrawals = pendingWithdrawalTotal(wallets);
    wallets.company.accounts.commission = money(previousAccounts.commission ?? wallets.company.totalCommission ?? wallets.company.balance);
    wallets.company.accounts.prizeVault = money(previousAccounts.prizeVault);
    wallets.company.accounts.bingoPrizeVault = money(previousAccounts.bingoPrizeVault);
    wallets.company.accounts.kenoPrizeVault = money(previousAccounts.kenoPrizeVault);
    wallets.company.accounts.roulettePrizeVault = money(previousAccounts.roulettePrizeVault);
    wallets.company.accounts.kenoHouseWinVault = money(previousAccounts.kenoHouseWinVault);
    wallets.company.accounts.rouletteHouseWinVault = money(previousAccounts.rouletteHouseWinVault);
    wallets.company.accounts.crashVault = money(previousAccounts.crashVault);
    wallets.company.accounts.gameEscrow = money(previousAccounts.gameEscrow);
    wallets.company.accounts.withdrawalFeeVault = money(previousAccounts.withdrawalFeeVault);
    wallets.company.accounts.promotion = money(previousAccounts.promotion);
    wallets.company.accounts.operating = money(previousAccounts.operating);
    wallets.company.financeMigratedAt = new Date().toISOString();
  }

  if (!wallets.company.gamePrizeVaultsMigratedAt) {
    const legacyPrize = money(wallets.company.accounts.prizeVault);
    const activeVaultTotal =
      money(wallets.company.accounts.bingoPrizeVault) +
      money(wallets.company.accounts.kenoPrizeVault) +
      money(wallets.company.accounts.roulettePrizeVault);
    if (legacyPrize > 0 && activeVaultTotal === 0) {
      const bingoShare = Math.floor(legacyPrize / 3);
      const kenoShare = Math.floor((legacyPrize - bingoShare) / 2);
      const rouletteShare = legacyPrize - bingoShare - kenoShare;
      wallets.company.accounts.prizeVault = 0;
      wallets.company.accounts.bingoPrizeVault += bingoShare;
      wallets.company.accounts.kenoPrizeVault += kenoShare;
      wallets.company.accounts.roulettePrizeVault += rouletteShare;
      wallets.company.ledger.unshift({
        id: randomId('led'),
        type: 'game_vault_migration',
        amount: legacyPrize,
        from: 'prizeVault',
        to: 'bingoPrizeVault,kenoPrizeVault,roulettePrizeVault',
        desc: 'Split legacy shared prize reserve into active game prize vaults',
        meta: { bingoPrizeVault: bingoShare, kenoPrizeVault: kenoShare, roulettePrizeVault: rouletteShare },
        time: new Date().toISOString(),
      });
      if (wallets.company.ledger.length > 1000) wallets.company.ledger.length = 1000;
    }
    wallets.company.gamePrizeVaultsMigratedAt = new Date().toISOString();
  }

  wallets.company.balance = money(wallets.company.accounts.commission);
  wallets.company.totalCommission = money(wallets.company.totalCommission);
  wallets.company.totalPaidOut = money(wallets.company.totalPaidOut);
  return wallets.company.accounts;
}

function recordLedger(wallets, { type, amount, from = 'external', to = 'external', desc = '', meta = {} }) {
  ensureFinance(wallets);
  const entry = {
    id: randomId('led'),
    type,
    amount: money(amount),
    from,
    to,
    desc,
    meta,
    time: new Date().toISOString(),
  };
  wallets.company.ledger.unshift(entry);
  wallets.company.transactions.unshift(entry);
  appendFinanceJournal(entry);
  appendFinanceAuditEvent(wallets, entry);
  if (wallets.company.ledger.length > 1000) wallets.company.ledger.length = 1000;
  if (wallets.company.transactions.length > 500) wallets.company.transactions.length = 500;
  return entry;
}

function accountTransfer(wallets, fromAccount, toAccount, amount, desc, type = 'transfer', meta = {}) {
  const accounts = ensureFinance(wallets);
  const parsed = money(amount);
  if (parsed <= 0) return { error: 'Amount must be positive.' };
  if (!(fromAccount in accounts)) return { error: `Unknown account: ${fromAccount}` };
  if (!(toAccount in accounts)) return { error: `Unknown account: ${toAccount}` };
  if (accounts[fromAccount] < parsed) return { error: `Insufficient funds in ${fromAccount}.` };
  accounts[fromAccount] -= parsed;
  accounts[toAccount] += parsed;
  if (fromAccount === 'commission' || toAccount === 'commission') wallets.company.balance = accounts.commission;
  recordLedger(wallets, { type, amount: parsed, from: fromAccount, to: toAccount, desc, meta });
  return { success: true };
}

function externalCredit(wallets, toAccount, amount, desc, type = 'deposit', meta = {}) {
  const accounts = ensureFinance(wallets);
  const parsed = money(amount);
  if (parsed <= 0) return { error: 'Amount must be positive.' };
  if (!(toAccount in accounts)) return { error: `Unknown account: ${toAccount}` };
  accounts[toAccount] += parsed;
  if (toAccount === 'commission') wallets.company.balance = accounts.commission;
  recordLedger(wallets, { type, amount: parsed, from: 'external', to: toAccount, desc, meta });
  return { success: true };
}

function externalDebit(wallets, fromAccount, amount, desc, type = 'withdrawal', meta = {}) {
  const accounts = ensureFinance(wallets);
  const parsed = money(amount);
  if (parsed <= 0) return { error: 'Amount must be positive.' };
  if (!(fromAccount in accounts)) return { error: `Unknown account: ${fromAccount}` };
  if (accounts[fromAccount] < parsed) return { error: `Insufficient funds in ${fromAccount}.` };
  accounts[fromAccount] -= parsed;
  if (fromAccount === 'commission') wallets.company.balance = accounts.commission;
  recordLedger(wallets, { type, amount: parsed, from: fromAccount, to: 'external', desc, meta });
  return { success: true };
}

function creditPlayer(wallets, playerId, wallet, amount, desc, type = 'player_credit', meta = {}) {
  const parsed = money(amount);
  if (parsed <= 0) return { error: 'Amount must be positive.' };
  ensureFinance(wallets).playerLiability += parsed;
  wallet.balance = money(wallet.balance) + parsed;
  recordLedger(wallets, { type, amount: parsed, from: 'external', to: `player:${playerId}`, desc, meta });
  return { success: true };
}

function debitPlayerToAccount(wallets, playerId, wallet, toAccount, amount, desc, type = 'player_debit', meta = {}) {
  const accounts = ensureFinance(wallets);
  const parsed = money(amount);
  if (parsed <= 0) return { error: 'Amount must be positive.' };
  if (!(toAccount in accounts)) return { error: `Unknown account: ${toAccount}` };
  if (money(wallet.balance) < parsed) return { error: 'Insufficient player balance.' };
  wallet.balance = money(wallet.balance) - parsed;
  accounts.playerLiability -= parsed;
  accounts[toAccount] += parsed;
  recordLedger(wallets, { type, amount: parsed, from: `player:${playerId}`, to: toAccount, desc, meta });
  return { success: true };
}

function accountToPlayer(wallets, fromAccount, playerId, wallet, amount, desc, type = 'player_payout', meta = {}) {
  const accounts = ensureFinance(wallets);
  const parsed = money(amount);
  if (parsed <= 0) return { error: 'Amount must be positive.' };
  if (!(fromAccount in accounts)) return { error: `Unknown account: ${fromAccount}` };
  if (accounts[fromAccount] < parsed) return { error: `Insufficient funds in ${fromAccount}.` };
  accounts[fromAccount] -= parsed;
  accounts.playerLiability += parsed;
  wallet.balance = money(wallet.balance) + parsed;
  recordLedger(wallets, { type, amount: parsed, from: fromAccount, to: `player:${playerId}`, desc, meta });
  return { success: true };
}

function reserveWithdrawal(wallets, playerId, wallet, amount, desc, meta = {}) {
  const result = debitPlayerToAccount(wallets, playerId, wallet, 'withdrawals', amount, desc, 'withdrawal_reserve', meta);
  if (result.error) return result;
  wallet.pendingWithdrawal = money(wallet.pendingWithdrawal) + money(amount);
  return { success: true };
}

function approveWithdrawal(wallets, playerId, wallet, amount, desc, meta = {}) {
  const parsed = money(amount);
  wallet.pendingWithdrawal = Math.max(0, money(wallet.pendingWithdrawal) - parsed);
  wallets.company.totalPaidOut = money(wallets.company.totalPaidOut) + parsed;
  return externalDebit(wallets, 'withdrawals', parsed, desc, 'withdrawal_paid', { playerId, ...meta });
}

function rejectWithdrawal(wallets, playerId, wallet, amount, desc, meta = {}) {
  const parsed = money(amount);
  wallet.pendingWithdrawal = Math.max(0, money(wallet.pendingWithdrawal) - parsed);
  return accountToPlayer(wallets, 'withdrawals', playerId, wallet, parsed, desc, 'withdrawal_rejected', meta);
}

function financeSummary(wallets) {
  const accounts = ensureFinance(wallets);
  const playerLiability = playerLiabilityTotal(wallets);
  const pendingWithdrawals = pendingWithdrawalTotal(wallets);
  return {
    accountLabels: ACCOUNT_LABELS,
    playerLiability,
    pendingWithdrawals,
    liabilityDelta: money(accounts.playerLiability) - playerLiability,
    withdrawalsDelta: money(accounts.withdrawals) - pendingWithdrawals,
    totalReserved: Object.values(accounts).reduce((sum, value) => sum + money(value), 0),
  };
}

function financeHealth(wallets) {
  const accounts = ensureFinance(wallets);
  const summary = financeSummary(wallets);
  const issues = [];

  for (const [account, balance] of Object.entries(accounts)) {
    if (money(balance) < 0) issues.push({ code: 'negative_account', account, balance: money(balance) });
  }

  if (summary.liabilityDelta !== 0) {
    issues.push({
      code: 'player_liability_mismatch',
      accountBalance: money(accounts.playerLiability),
      actualPlayerBalance: summary.playerLiability,
      delta: summary.liabilityDelta,
    });
  }

  if (summary.withdrawalsDelta !== 0) {
    issues.push({
      code: 'withdrawal_reserve_mismatch',
      accountBalance: money(accounts.withdrawals),
      actualPendingWithdrawal: summary.pendingWithdrawals,
      delta: summary.withdrawalsDelta,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    summary,
  };
}

module.exports = {
  ACCOUNT_LABELS,
  DEFAULT_ACCOUNTS,
  accountToPlayer,
  accountTransfer,
  approveWithdrawal,
  creditPlayer,
  debitPlayerToAccount,
  ensureFinance,
  externalCredit,
  externalDebit,
  financeSummary,
  financeHealth,
  money,
  pendingWithdrawalTotal,
  playerLiabilityTotal,
  recordLedger,
  rejectWithdrawal,
  reserveWithdrawal,
};
