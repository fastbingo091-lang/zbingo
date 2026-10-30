const assert = require('assert');
const {
  calculatePayout,
  checkBingo,
  generateBingoCard,
  generateUniqueCards,
  getBingoLetter,
  verifyMarks,
} = require('../lib/gameLogic');

function flatten(grid) {
  return grid.flat().filter(n => n !== -1);
}

const card = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, -1, 48, 63],
  [4, 19, 34, 49, 64],
  [5, 20, 35, 50, 65],
];

{
  const generated = generateBingoCard();
  assert.strictEqual(generated.length, 5);
  assert.ok(generated.every(row => row.length === 5));
  assert.strictEqual(generated[2][2], -1);
  assert.strictEqual(new Set(flatten(generated)).size, 24);
  assert.ok(generated.every(row => row.every(n => n === -1 || (n >= 1 && n <= 75))));
}

{
  const cards = generateUniqueCards(25);
  const serialized = cards.map(c => JSON.stringify(c));
  assert.strictEqual(new Set(serialized).size, 25);
}

{
  assert.deepStrictEqual(checkBingo(card, new Set([1, 16, 31, 46, 61])), ['Row 1']);
  assert.deepStrictEqual(checkBingo(card, new Set([1, 2, 3, 4, 5])), ['Column 1']);
  assert.ok(checkBingo(card, new Set([1, 17, 49, 65])).includes('Diagonal down'));
}

{
  const result = verifyMarks(card, new Set(['0,0', '0,1', '1,0']), new Set([1, 2, 16, 31]));
  assert.deepStrictEqual(result.verified, [[0, 0], [0, 1], [1, 0]]);
  assert.deepStrictEqual(result.wrong, []);
  assert.deepStrictEqual(result.missed, [[0, 2]]);
}

{
  const result = verifyMarks(card, new Set(['0,0']), new Set([1, 16]), new Set([16]));
  assert.deepStrictEqual(result.verified, [[0, 0]]);
  assert.deepStrictEqual(result.wrong, []);
  assert.deepStrictEqual(result.missed, []);
}

{
  assert.deepStrictEqual(calculatePayout(3, 20), { pot: 60, winnerAmount: 48, commission: 12 });
  assert.strictEqual(getBingoLetter(1), 'B');
  assert.strictEqual(getBingoLetter(30), 'I');
  assert.strictEqual(getBingoLetter(45), 'N');
  assert.strictEqual(getBingoLetter(60), 'G');
  assert.strictEqual(getBingoLetter(75), 'O');
}

console.log('gameLogic tests passed');
