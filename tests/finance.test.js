const assert = require('assert');
const finance = require('../lib/finance');

function freshWallets() {
  return {
    company: { balance: 0, totalCommission: 0, totalPaidOut: 0, accounts: {}, transactions: [], ledger: [] },
    players: {
      p1: { id: 'p1', name: 'Daniel', balance: 100, pendingWithdrawal: 0 },
    },
    requests: [],
  };
}

{
  const wallets = freshWallets();
  finance.ensureFinance(wallets);
  assert.strictEqual(wallets.company.accounts.playerLiability, 100);
  assert.strictEqual(wallets.company.accounts.commission, 0);
  assert.strictEqual(wallets.company.accounts.bingoPrizeVault, 0);
  assert.strictEqual(wallets.company.accounts.kenoPrizeVault, 0);
  assert.strictEqual(wallets.company.accounts.roulettePrizeVault, 0);
  assert.strictEqual(wallets.company.accounts.kenoHouseWinVault, 0);
  assert.strictEqual(wallets.company.accounts.rouletteHouseWinVault, 0);
}

{
  const wallets = freshWallets();
  finance.ensureFinance(wallets);
  const player = wallets.players.p1;
  assert.deepStrictEqual(finance.debitPlayerToAccount(wallets, 'p1', player, 'gameEscrow', 20, 'stake'), { success: true });
  assert.strictEqual(player.balance, 80);
  assert.strictEqual(wallets.company.accounts.playerLiability, 80);
  assert.strictEqual(wallets.company.accounts.gameEscrow, 20);
  assert.deepStrictEqual(finance.accountToPlayer(wallets, 'gameEscrow', 'p1', player, 16, 'payout'), { success: true });
  assert.strictEqual(player.balance, 96);
  assert.strictEqual(wallets.company.accounts.playerLiability, 96);
  assert.strictEqual(wallets.company.accounts.gameEscrow, 4);
  assert.deepStrictEqual(finance.accountTransfer(wallets, 'gameEscrow', 'commission', 4, 'commission'), { success: true });
  assert.strictEqual(wallets.company.accounts.commission, 4);
  assert.strictEqual(wallets.company.accounts.gameEscrow, 0);
}

{
  const wallets = freshWallets();
  wallets.company.accounts = { kenoPrizeVault: 1000 };
  finance.ensureFinance(wallets);
  const player = wallets.players.p1;
  assert.deepStrictEqual(finance.debitPlayerToAccount(wallets, 'p1', player, 'gameEscrow', 20, 'keno stake'), { success: true });
  assert.deepStrictEqual(finance.accountTransfer(wallets, 'gameEscrow', 'kenoHouseWinVault', 20, 'keno house win', 'keno_house_win'), { success: true });
  assert.strictEqual(wallets.company.accounts.kenoPrizeVault, 1000);
  assert.strictEqual(wallets.company.accounts.kenoHouseWinVault, 20);
  assert.strictEqual(wallets.company.accounts.gameEscrow, 0);
  assert.strictEqual(player.balance, 80);
}

{
  const wallets = freshWallets();
  wallets.company.accounts = { roulettePrizeVault: 1000 };
  finance.ensureFinance(wallets);
  const player = wallets.players.p1;
  assert.deepStrictEqual(finance.debitPlayerToAccount(wallets, 'p1', player, 'gameEscrow', 20, 'roulette stake'), { success: true });
  assert.deepStrictEqual(finance.accountToPlayer(wallets, 'roulettePrizeVault', 'p1', player, 37, 'roulette payout'), { success: true });
  assert.deepStrictEqual(finance.accountTransfer(wallets, 'gameEscrow', 'rouletteHouseWinVault', 20, 'roulette house win', 'roulette_house_win'), { success: true });
  assert.deepStrictEqual(finance.accountTransfer(wallets, 'roulettePrizeVault', 'rouletteHouseWinVault', 3, 'roulette commission', 'roulette_commission'), { success: true });
  assert.strictEqual(wallets.company.accounts.roulettePrizeVault, 960);
  assert.strictEqual(wallets.company.accounts.rouletteHouseWinVault, 23);
  assert.strictEqual(wallets.company.accounts.gameEscrow, 0);
  assert.strictEqual(player.balance, 117);
}

{
  const wallets = freshWallets();
  wallets.company.accounts = { prizeVault: 99 };
  finance.ensureFinance(wallets);
  assert.strictEqual(wallets.company.accounts.prizeVault, 0);
  assert.strictEqual(wallets.company.accounts.bingoPrizeVault, 33);
  assert.strictEqual(wallets.company.accounts.kenoPrizeVault, 33);
  assert.strictEqual(wallets.company.accounts.roulettePrizeVault, 33);
  assert.ok(wallets.company.gamePrizeVaultsMigratedAt);
}

{
  const wallets = freshWallets();
  finance.ensureFinance(wallets);
  assert.deepStrictEqual(finance.externalCredit(wallets, 'commission', 100, 'profit'), { success: true });
  assert.deepStrictEqual(finance.externalDebit(wallets, 'commission', 40, 'dividend', 'dividend_withdrawal'), { success: true });
  assert.strictEqual(wallets.company.accounts.commission, 60);
  assert.ok(wallets.company.ledger.some(row => row.type === 'dividend_withdrawal' && row.amount === 40));
}

{
  const wallets = freshWallets();
  finance.ensureFinance(wallets);
  assert.strictEqual(finance.financeHealth(wallets).ok, true);
  wallets.company.accounts.playerLiability += 1;
  const health = finance.financeHealth(wallets);
  assert.strictEqual(health.ok, false);
  assert.ok(health.issues.some(issue => issue.code === 'player_liability_mismatch'));
}

{
  const wallets = freshWallets();
  finance.ensureFinance(wallets);
  const player = wallets.players.p1;
  assert.deepStrictEqual(finance.reserveWithdrawal(wallets, 'p1', player, 30, 'reserve'), { success: true });
  assert.strictEqual(player.balance, 70);
  assert.strictEqual(player.pendingWithdrawal, 30);
  assert.strictEqual(wallets.company.accounts.playerLiability, 70);
  assert.strictEqual(wallets.company.accounts.withdrawals, 30);
  assert.deepStrictEqual(finance.rejectWithdrawal(wallets, 'p1', player, 30, 'reject'), { success: true });
  assert.strictEqual(player.balance, 100);
  assert.strictEqual(player.pendingWithdrawal, 0);
  assert.strictEqual(wallets.company.accounts.playerLiability, 100);
  assert.strictEqual(wallets.company.accounts.withdrawals, 0);
}

console.log('finance tests passed');
