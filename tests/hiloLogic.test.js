const assert = require('assert');
const hilo = require('../lib/hiloLogic');

{
  const seed = 'a'.repeat(64);
  const one = hilo.shuffleDeck(seed, 1, 'p1').map(c => c.display);
  const two = hilo.shuffleDeck(seed, 1, 'p1').map(c => c.display);
  assert.deepStrictEqual(one, two);
  assert.strictEqual(new Set(one).size, 52);
}

{
  const state = hilo.createGameState();
  hilo.initRound(state, 'b'.repeat(64), 'p1');
  hilo.startBetting(state);
  const multipliers = hilo.getCurrentMultipliers(state);
  state.playerChoice = multipliers.higher > 0 ? 'higher' : 'lower';
  state.playerBet = 20;
  state.status = 'dealing';
  hilo.resolveRound(state);
  assert.strictEqual(state.status, 'result');
  assert.ok(state.nextCard);
}

{
  assert.strictEqual(hilo.calculatePayout(20, 2.5), 50);
  assert.strictEqual(hilo.calculatePayout(10000, 100), hilo.MAX_ROUND_PAYOUT_ETB);
  assert.strictEqual(hilo.MIN_BET_ETB, 20);
}

{
  const remaining = hilo.createDeck().filter(c => c.rank <= 7);
  assert.strictEqual(hilo.calculateMultiplier(14, remaining, 'higher'), 0);
  const probs = hilo.calculateProbabilities(7, remaining);
  assert.ok(probs.lower > 0);
}

{
  const deck = hilo.createDeck();
  for (const base of deck) {
    const remaining = deck.filter(card => card !== base);
    const probs = hilo.calculateProbabilities(base.rank, remaining);
    for (const choice of hilo.getAvailableBetTypes(base.rank, remaining)) {
      const multiplier = hilo.calculateMultiplier(base.rank, remaining, choice);
      const payout = hilo.calculatePayout(hilo.MIN_BET_ETB, multiplier);
      const expectedReturn = probs[choice] * payout;
      assert.ok(
        expectedReturn <= hilo.MIN_BET_ETB,
        `${base.display} ${choice} has player-positive EV: ${expectedReturn}`
      );
    }
  }
}

console.log('hiloLogic tests passed');
