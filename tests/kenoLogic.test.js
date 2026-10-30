const assert = require('assert');
const {
  KENO_DRAW_COUNT,
  KENO_MAX_PAYOUT_ETB,
  KENO_MAX_NUMBER,
  KENO_MAX_PICKS,
  calculateKenoResult,
  drawKenoRound,
  drawKenoNumbers,
  maxKenoPayout,
  validateKenoPicks,
} = require('../lib/kenoLogic');

{
  const drawn = drawKenoNumbers();
  assert.strictEqual(drawn.length, KENO_DRAW_COUNT);
  assert.strictEqual(new Set(drawn).size, KENO_DRAW_COUNT);
  assert.ok(drawn.every(n => n >= 1 && n <= KENO_MAX_NUMBER));
}

{
  assert.deepStrictEqual(validateKenoPicks([3, 2, 2, 1]).picks, [1, 2, 3]);
  assert.ok(validateKenoPicks([]).error);
  assert.ok(validateKenoPicks(Array.from({ length: KENO_MAX_PICKS + 1 }, (_, i) => i + 1)).error);
  assert.ok(validateKenoPicks([0, 1]).error);
  assert.ok(validateKenoPicks([81]).error);
}

{
  const result = calculateKenoResult([1, 2, 3, 4], [1, 3, 9, 10, 11], 20);
  assert.deepStrictEqual(result.matches, [1, 3]);
  assert.strictEqual(result.matchCount, 2);
  assert.strictEqual(result.multiplier, 1);
  assert.strictEqual(result.payout, 20);
}

{
  assert.strictEqual(maxKenoPayout(4, 20), 2000);
  assert.strictEqual(maxKenoPayout(20, 20), 50000);
  assert.strictEqual(maxKenoPayout(20, 200), KENO_MAX_PAYOUT_ETB);
  assert.strictEqual(maxKenoPayout(99, 20), 0);
}

{
  const picks = Array.from({ length: 20 }, (_, i) => i + 1);
  const capped = calculateKenoResult(picks, picks, 200);
  assert.strictEqual(capped.payout, KENO_MAX_PAYOUT_ETB);
  assert.strictEqual(capped.capped, false);
}

{
  const first = drawKenoRound('round-a', 'c'.repeat(64));
  const second = drawKenoRound('round-a', 'c'.repeat(64));
  assert.deepStrictEqual(first, second);
  assert.strictEqual(first.proof.serverSeedHash.length, 64);
}

console.log('kenoLogic tests passed');
