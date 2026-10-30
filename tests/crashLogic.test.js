const assert = require('assert');
const {
  calculateCrashPoint,
  multiplierAt,
  sha256Hex,
  timeToMultiplier,
} = require('../lib/crashLogic');

const seed = 'a'.repeat(64);
const first = calculateCrashPoint(seed, 42);
const second = calculateCrashPoint(seed, 42);
assert.deepStrictEqual(first, second);
assert.strictEqual(first.serverSeedHash, sha256Hex(seed));
assert.ok(first.crashMultiplier >= 1);

assert.strictEqual(multiplierAt(0), 1);
assert.ok(multiplierAt(7000) >= 2.7);
assert.ok(Math.abs(multiplierAt(timeToMultiplier(10)) - 10) < 0.05);

let instant = 0;
for (let i = 1; i <= 1000; i++) {
  if (calculateCrashPoint(`seed-${i}`, i).instantCrash) instant++;
}
assert.ok(instant > 50 && instant < 110, `instant crash count ${instant} should be near 8%`);

console.log('crashLogic tests passed');
