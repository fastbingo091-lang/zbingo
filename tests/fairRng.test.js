const assert = require('assert');
const fairRng = require('../lib/fairRng');

{
  const seed = 'b'.repeat(64);
  const first = fairRng.seededShuffle([1, 2, 3, 4, 5], seed, 'test');
  const second = fairRng.seededShuffle([1, 2, 3, 4, 5], seed, 'test');
  assert.deepStrictEqual(first, second);
  assert.deepStrictEqual([...first].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
}

{
  const proof = fairRng.makeProof('seed', 'round-1', 'keno');
  assert.strictEqual(proof.serverSeedHash, fairRng.sha256Hex('seed'));
  assert.strictEqual(proof.hash, fairRng.hmacHex('seed', 'keno:round-1'));
}

{
  assert.ok(/^abc_[a-z0-9]+_[a-f0-9]{12}$/.test(fairRng.randomId('abc')));
}

console.log('fairRng tests passed');
