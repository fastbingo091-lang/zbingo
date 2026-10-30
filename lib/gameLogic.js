const COLUMNS = [
  { min: 1, max: 15 },
  { min: 16, max: 30 },
  { min: 31, max: 45 },
  { min: 46, max: 60 },
  { min: 61, max: 75 },
];
const { cryptoShuffle } = require('./fairRng');

function generateBingoCard() {
  const grid = [[], [], [], [], []];
  for (let col = 0; col < 5; col++) {
    const { min, max } = COLUMNS[col];
    const pool = [];
    for (let i = min; i <= max; i++) pool.push(i);
    const drawn = cryptoShuffle(pool).slice(0, 5).sort((a, b) => a - b);
    for (let row = 0; row < 5; row++) grid[row][col] = drawn[row];
  }
  grid[2][2] = -1;
  return grid;
}

function cardsIdentical(a, b) {
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

function generateUniqueCards(count) {
  const cards = [];
  while (cards.length < count) {
    const card = generateBingoCard();
    if (!cards.some(c => cardsIdentical(c, card))) cards.push(card);
  }
  return cards;
}

function checkBingo(cartelaGrid, drawnSet) {
  const hits = [];
  for (let r = 0; r < 5; r++) {
    hits[r] = [];
    for (let c = 0; c < 5; c++) {
      hits[r][c] = cartelaGrid[r][c] === -1 || drawnSet.has(cartelaGrid[r][c]);
    }
  }

  const patterns = [];
  for (let r = 0; r < 5; r++) if (hits[r].every(Boolean)) patterns.push(`Row ${r + 1}`);
  for (let c = 0; c < 5; c++) if ([0, 1, 2, 3, 4].every(r => hits[r][c])) patterns.push(`Column ${c + 1}`);
  if ([0, 1, 2, 3, 4].every(i => hits[i][i])) patterns.push('Diagonal down');
  if ([0, 1, 2, 3, 4].every(i => hits[i][4 - i])) patterns.push('Diagonal up');
  if (hits.flat().every(Boolean)) patterns.push('Full House');
  return patterns;
}

function verifyMarks(cartelaGrid, markedSet, drawnSet, missedGraceSet = new Set()) {
  const verified = [], wrong = [], missed = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const val = cartelaGrid[r][c];
      if (val === -1) continue;
      const isMarked = markedSet.has(`${r},${c}`);
      const isCalled = drawnSet.has(val);
      if (isMarked && isCalled) verified.push([r, c]);
      else if (isMarked && !isCalled) wrong.push([r, c]);
      else if (!isMarked && isCalled && !missedGraceSet.has(val)) missed.push([r, c]);
    }
  }
  return { verified, wrong, missed };
}

function getBingoLetter(num) {
  if (num <= 15) return 'B';
  if (num <= 30) return 'I';
  if (num <= 45) return 'N';
  if (num <= 60) return 'G';
  return 'O';
}

function calculatePayout(playerCount, bet, winnerShare = 0.8) {
  const pot = playerCount * bet;
  const winnerAmount = Math.floor(pot * winnerShare);
  return { pot, winnerAmount, commission: pot - winnerAmount };
}

module.exports = {
  calculatePayout,
  cardsIdentical,
  checkBingo,
  generateBingoCard,
  generateUniqueCards,
  getBingoLetter,
  verifyMarks,
};
