const crypto = require('crypto');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hmacHex(serverSeed, message) {
  return crypto.createHmac('sha256', String(serverSeed)).update(String(message)).digest('hex');
}

function randomServerSeed(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function randomInt(maxExclusive) {
  const max = Number(maxExclusive);
  if (!Number.isInteger(max) || max <= 0) throw new Error('maxExclusive must be a positive integer.');
  return crypto.randomInt(0, max);
}

function intFromHash(hex, maxExclusive) {
  const max = BigInt(maxExclusive);
  if (max <= 0n) throw new Error('maxExclusive must be positive.');
  const value = BigInt(`0x${hex}`);
  return Number(value % max);
}

function seededInt(serverSeed, nonce, maxExclusive, salt = 'gamehub') {
  const hash = hmacHex(serverSeed, `${salt}:${nonce}`);
  return intFromHash(hash, maxExclusive);
}

function cryptoShuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function seededShuffle(items, serverSeed, salt = 'gamehub') {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = seededInt(serverSeed, i, i + 1, salt);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeProof(serverSeed, roundId, salt) {
  return {
    roundId,
    salt,
    serverSeed,
    serverSeedHash: sha256Hex(serverSeed),
    hash: hmacHex(serverSeed, `${salt}:${roundId}`),
  };
}

module.exports = {
  cryptoShuffle,
  hmacHex,
  makeProof,
  randomId,
  randomInt,
  randomServerSeed,
  seededInt,
  seededShuffle,
  sha256Hex,
};
