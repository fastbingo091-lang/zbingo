// ────────────────────────────────────────────────
// HI-LO CARD GAME — "Ye-Carta Shurub"
// Standard 52-card deck, Aces high
// Dynamic multipliers based on remaining probability
// 3% house edge, streak multiplier system
// ────────────────────────────────────────────────

const crypto = require('crypto');

// Card ranks: 2-14 (14 = Ace)
const RANKS = {2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A'};
const SUITS = ['♠','♥','♦','♣'];
const SUIT_NAMES = ['spades','hearts','diamonds','clubs'];

// House edge
const HOUSE_EDGE = 0.03;
const MIN_BET_ETB = 20;
const MAX_STREAK_MULTIPLIER = 100;
const MAX_ROUND_PAYOUT_ETB = 300000;

// ─── Card object ───
function createCard(rank, suitIndex) {
  return {
    rank,          // 2-14
    suit: SUITS[suitIndex],
    suitName: SUIT_NAMES[suitIndex],
    label: RANKS[rank],
    display: RANKS[rank] + SUITS[suitIndex],
  };
}

// ─── Create a fresh 52-card deck ───
function createDeck() {
  const deck = [];
  for (let rank = 2; rank <= 14; rank++) {
    for (let s = 0; s < 4; s++) {
      deck.push(createCard(rank, s));
    }
  }
  return deck;
}

// ─── HMAC SHA-256 based provably fair shuffle ───
// Given a server seed and a round number, generate a shuffled deck
function makeHmacStream(serverSeed, roundNumber, clientSeed) {
  const key = serverSeed + '-' + roundNumber + '-' + (clientSeed || '');
  let counter = 0;
  let buffer = Buffer.alloc(0);
  let offset = 0;

  return function nextUInt32() {
    if (offset + 4 > buffer.length) {
      const hmac = crypto.createHmac('sha256', key);
      hmac.update('hilo-deck-shuffle:' + counter++);
      buffer = hmac.digest();
      offset = 0;
    }
    const value = buffer.readUInt32BE(offset);
    offset += 4;
    return value;
  };
}

function randomIntBelow(nextUInt32, maxExclusive) {
  if (maxExclusive <= 1) return 0;
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  let value;
  do {
    value = nextUInt32();
  } while (value >= limit);
  return value % maxExclusive;
}

function shuffleDeck(serverSeed, roundNumber, clientSeed) {
  const deck = createDeck();
  const nextUInt32 = makeHmacStream(serverSeed, roundNumber, clientSeed);

  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIntBelow(nextUInt32, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ─── Generate a provably fair server seed ───
function generateServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Verify a shuffle (for client-side verification) ───
function verifyShuffle(serverSeed, roundNumber, clientSeed, firstCards) {
  const deck = shuffleDeck(serverSeed, roundNumber, clientSeed);
  return firstCards.every((card, i) =>
    card.rank === deck[i].rank && card.suit === deck[i].suit
  );
}

// ─── Calculate remaining cards in the deck context ───
// We track which cards have been drawn
function getRemainingCards(deck, drawnIndices) {
  return deck.filter((_, i) => !drawnIndices.includes(i));
}

// ─── Count probabilities for each bet type ───
function calculateProbabilities(baseRank, remainingCards) {
  const total = remainingCards.length;
  if (total === 0) return { higher: 0, lower: 0, tie: 0 };

  let higher = 0, lower = 0, tie = 0;
  for (const card of remainingCards) {
    if (card.rank > baseRank) higher++;
    else if (card.rank < baseRank) lower++;
    else tie++;
  }

  return {
    higher: higher / total,
    lower: lower / total,
    tie: tie / total,
    total,
  };
}

// ─── Calculate dynamic multiplier for a bet type ───
// multiplier = (1 / probability) * (1 - houseEdge)
// Capped at MAX_STREAK_MULTIPLIER
function calculateMultiplier(baseRank, remainingCards, betType) {
  const probs = calculateProbabilities(baseRank, remainingCards);
  const prob = probs[betType];
  if (!prob || prob <= 0) return 0;

  let multi = (1 / prob) * (1 - HOUSE_EDGE);
  // Round to 2 decimal places
  multi = Math.round(multi * 100) / 100;
  // Cap at max
  return Math.min(multi, MAX_STREAK_MULTIPLIER);
}

// ─── Calculate effective multiplier after streak ───
// A player's total multiplier compounds: 1.15x → 1.15x → 1.15x = 1.52x
function compoundMultiplier(currentMultiplier, newMultiplier) {
  let result = currentMultiplier * newMultiplier;
  result = Math.round(result * 100) / 100;
  return Math.min(result, MAX_STREAK_MULTIPLIER);
}

// ─── Calculate payout for a bet ───
// betAmount * effectiveMultiplier, capped
function calculatePayout(betAmount, effectiveMultiplier) {
  let payout = betAmount * effectiveMultiplier;
  payout = Math.round(payout);
  return Math.min(payout, MAX_ROUND_PAYOUT_ETB);
}

// ─── Game state machine ───
// States: idle → betting → dealing → result → betting (or idle)
function createGameState() {
  return {
    status: 'idle',           // idle | betting | dealing | result
    serverSeed: null,
    roundNumber: 0,
    deck: [],
    drawnIndices: [],         // indices of cards already drawn from deck
    baseCard: null,           // current face-up card
    nextCard: null,           // the card drawn (during result phase)
    countdownEnd: 0,          // timestamp when betting window closes
    playerChoice: null,       // 'higher' | 'lower' | 'tie'
    playerBet: 0,            // bet amount
    playerWon: null,         // true | false | null
    effectiveMultiplier: 1,  // compounded streak multiplier
    roundMultiplier: 1,      // multiplier for THIS card
    allPlayers: [],          // { playerId, choice, amount, won, payout }
    history: [],             // [{baseCard, nextCard, playerChoice, won, multiplier}]
    maxStreak: 1,
  };
}

// ─── Initialize a new round ───
function initRound(state, serverSeed, clientSeed) {
  state.roundNumber++;
  state.serverSeed = serverSeed;
  state.deck = shuffleDeck(serverSeed, state.roundNumber, clientSeed || 'default');
  state.drawnIndices = [];
  state.baseCard = null;
  state.nextCard = null;
  state.playerChoice = null;
  state.playerBet = 0;
  state.playerWon = null;
  state.status = 'idle';
  // Draw first card (base card)
  const baseIdx = 0;
  state.baseCard = state.deck[baseIdx];
  state.drawnIndices.push(baseIdx);
  return state;
}

// ─── Draw the next card ───
function drawNextCard(state) {
  // Find next undrawn card
  for (let i = 0; i < state.deck.length; i++) {
    if (!state.drawnIndices.includes(i)) {
      state.nextCard = state.deck[i];
      state.drawnIndices.push(i);

      // Deck depleted? Reshuffle
      if (state.drawnIndices.length >= 52) {
        state.deck = shuffleDeck(state.serverSeed, state.roundNumber + '.reshuffle', 'default');
        state.drawnIndices = [];
      }
      return state.nextCard;
    }
  }
  return null;
}

// ─── Determine outcome ───
function determineOutcome(baseRank, nextRank, playerChoice) {
  if (playerChoice === 'tie') {
    return nextRank === baseRank;
  }
  if (playerChoice === 'higher') {
    return nextRank > baseRank;
  }
  if (playerChoice === 'lower') {
    return nextRank < baseRank;
  }
  return false;
}

// ─── Calculate current multipliers for all bet types ───
function getCurrentMultipliers(state) {
  const remaining = getRemainingCards(state.deck, state.drawnIndices);
  const baseRank = state.baseCard ? state.baseCard.rank : 7;
  const probabilities = calculateProbabilities(baseRank, remaining);
  const available = getAvailableBetTypes(baseRank, remaining);
  return {
    higher: calculateMultiplier(baseRank, remaining, 'higher'),
    lower: calculateMultiplier(baseRank, remaining, 'lower'),
    tie: calculateMultiplier(baseRank, remaining, 'tie'),
    probabilities,
    available,
    remainingCards: remaining.length,
  };
}

// ─── Start betting phase ───
function startBetting(state) {
  state.status = 'betting';
  state.countdownEnd = Date.now() + 6000; // 6-second betting window
  state.playerBet = 0;
  state.playerChoice = null;
  state.playerWon = null;
  state.nextCard = null;
  return state;
}

// ─── Resolve the round ───
function resolveRound(state) {
  if (state.status !== 'dealing') return state;
  const remainingBeforeDraw = getRemainingCards(state.deck, state.drawnIndices);
  drawNextCard(state);
  state.status = 'result';

  // Determine outcome
  if (state.playerChoice) {
    state.playerWon = determineOutcome(state.baseCard.rank, state.nextCard.rank, state.playerChoice);

    if (state.playerWon) {
      const multi = calculateMultiplier(state.baseCard.rank, remainingBeforeDraw, state.playerChoice);
      state.roundMultiplier = multi;
      state.effectiveMultiplier = compoundMultiplier(state.effectiveMultiplier || 1, multi);
    } else {
      state.roundMultiplier = 0;
    }
  }

  // Log history
  state.history.push({
    baseCard: state.baseCard,
    nextCard: state.nextCard,
    playerChoice: state.playerChoice,
    won: state.playerWon,
    multiplier: state.roundMultiplier,
    round: state.roundNumber,
  });

  return state;
}

// ─── Calculate available bet types based on remaining cards ───
function getAvailableBetTypes(baseRank, remainingCards) {
  const types = [];
  if (remainingCards.some(c => c.rank > baseRank)) types.push('higher');
  if (remainingCards.some(c => c.rank < baseRank)) types.push('lower');
  if (remainingCards.some(c => c.rank === baseRank)) types.push('tie');
  return types;
}

module.exports = {
  createDeck,
  shuffleDeck,
  generateServerSeed,
  verifyShuffle,
  createGameState,
  initRound,
  startBetting,
  resolveRound,
  drawNextCard,
  determineOutcome,
  calculateProbabilities,
  calculateMultiplier,
  compoundMultiplier,
  calculatePayout,
  makeHmacStream,
  randomIntBelow,
  getCurrentMultipliers,
  getAvailableBetTypes,
  getRemainingCards,
  RANKS,
  SUITS,
  HOUSE_EDGE,
  MIN_BET_ETB,
  MAX_STREAK_MULTIPLIER,
  MAX_ROUND_PAYOUT_ETB,
};
