const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWalletStore } = require('../lib/walletStore');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-wallet-store-'));

try {
  const legacyFile = path.join(dir, 'wallets.json');
  fs.writeFileSync(legacyFile, JSON.stringify({
    players: { p1: { id: 'p1', balance: 100 } },
    requests: [],
    company: { accounts: {}, transactions: [], ledger: [] },
  }));

  const store = createWalletStore({ dataDir: dir, legacyWalletFile: legacyFile });
  const migrated = store.load();
  assert.strictEqual(migrated.players.p1.balance, 100);

  migrated.players.p1.balance = 125;
  store.save(migrated);
  const loadedAgain = store.load();
  assert.strictEqual(loadedAgain.players.p1.balance, 125);
  const info = store.info();
  assert.strictEqual(info.hasState, true);
  assert.strictEqual(info.hashOk, true);
  assert.ok(info.revision >= 2);
  assert.ok(info.byteLength > 0);
  assert.ok(info.revisionCount >= 2);
  assert.ok(fs.existsSync(path.join(dir, 'game.sqlite')));
  const backupPath = path.join(dir, 'backups', 'wallet-backup.sqlite');
  const backup = store.backupTo(backupPath);
  assert.strictEqual(backup.backupPath, backupPath);
  assert.ok(backup.byteLength > 0);
  assert.ok(fs.existsSync(backupPath));
  store.close();
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('walletStore tests passed');
