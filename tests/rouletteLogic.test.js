const assert = require('assert');
const roulette = require('../lib/rouletteLogic');

{
  const bets = {
    a: { type: 'red_black', numbers: ['red'], amount: 20 },
    b: { type: 'straight_up', numbers: [7], amount: 20 },
  };
  const redEvenResult = roulette.calculatePayouts(bets, 18);
  assert.strictEqual(redEvenResult.results.find(r => r.betId === 'a').payout, 40);
  assert.strictEqual(redEvenResult.results.find(r => r.betId === 'b').payout, 0);

  const straightResult = roulette.calculatePayouts(bets, 7);
  assert.strictEqual(straightResult.results.find(r => r.betId === 'b').payout, 720);
}

{
  const first = roulette.spinWheel('d'.repeat(64), 55);
  const second = roulette.spinWheel('d'.repeat(64), 55);
  assert.deepStrictEqual(first, second);
  assert.strictEqual(first.proof.serverSeedHash.length, 64);
}

{
  assert.deepStrictEqual(roulette.validateBet({ type: 'red_black', numbers: ['red'], amount: 20 }, [20]), { valid: true });
  assert.ok(roulette.validateBet({ type: 'red_black', numbers: ['blue'], amount: 20 }, [20]).error);
}

{
  const bets = {
    straight: { playerId: 'p1', type: 'straight_up', numbers: [7], amount: 200 },
    even: { playerId: 'p2', type: 'red_black', numbers: ['black'], amount: 200 },
  };
  const result = roulette.calculateCappedPayouts(bets, 7);
  assert.strictEqual(result.results.find(r => r.betId === 'straight').payout, 6150);
  assert.strictEqual(result.results.find(r => r.betId === 'straight').commission, 1050);
  assert.strictEqual(result.results.find(r => r.betId === 'even').payout, 0);
  assert.strictEqual(result.totalCommission, 1050);
}

console.log('rouletteLogic tests passed');
