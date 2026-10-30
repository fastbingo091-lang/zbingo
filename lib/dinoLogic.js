// dinoLogic.js — Deterministic PvP Dino Betting Race
// Seeded PRNG, obstacle generation, room management, rankings, payouts

/**
 * Mulberry32 — deterministic PRNG (seeded)
 */
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a deterministic seed from room + round
 */
function makeSeed(roomId, round) {
  let hash = 0;
  const str = `${roomId}-${round}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Generate obstacles for a given seed.
 * Returns array of { distance, width, height, type }
 * Gaps progressively narrow, speed increases with distance.
 */
function generateObstacles(seed, maxDistance = 50000) {
  const rand = mulberry32(seed);
  const obstacles = [];
  let distance = 800; // first obstacle appears after 800 units

  while (distance < maxDistance) {
    const type = rand() < 0.75 ? 'cactus' : 'pterodactyl';
    const width = type === 'cactus'
      ? 15 + rand() * 20
      : 20 + rand() * 15;
    const height = type === 'cactus'
      ? 30 + rand() * 25
      : 25 + rand() * 15;
    const y = type === 'pterodactyl' ? (rand() < 0.5 ? 45 : 60) : 0;

    // Progressively harder: shorter gaps, tighter clusters
    const difficulty = Math.min(1, distance / 15000);
    const minGap = 300 - difficulty * 220;   // 300 → 80
    const maxGap = 700 - difficulty * 450;   // 700 → 250
    const gap = minGap + rand() * (maxGap - minGap);
    distance += gap;

    // Possibly cluster 2-3 obstacles
    const cluster = rand() < difficulty * 0.4 ? Math.floor(rand() * 2) + 1 : 0;
    obstacles.push({ distance, width, height, type, y });

    for (let c = 0; c < cluster; c++) {
      distance += 70 + rand() * 120;
      obstacles.push({
        distance,
        width: 12 + rand() * 18,
        height: 28 + rand() * 20,
        type: 'cactus',
        y: 0
      });
    }
  }

  // Sort by distance
  obstacles.sort((a, b) => a.distance - b.distance);
  return obstacles;
}

/**
 * Room entry fees allowed
 */
const ENTRY_FEES = [10, 20, 50, 100, 200, 500];

/**
 * Calculate prize distribution based on player count
 * Returns array of { place, share } where share is fraction of prize pool
 */
function prizeDistribution(playerCount) {
  if (playerCount <= 2) return [{ place: 1, share: 1.0 }];
  if (playerCount <= 4) return [{ place: 1, share: 0.70 }, { place: 2, share: 0.30 }];
  if (playerCount <= 8) return [
    { place: 1, share: 0.60 },
    { place: 2, share: 0.25 },
    { place: 3, share: 0.15 }
  ];
  if (playerCount <= 20) return [
    { place: 1, share: 0.50 },
    { place: 2, share: 0.25 },
    { place: 3, share: 0.15 },
    { place: 4, share: 0.07 },
    { place: 5, share: 0.03 }
  ];
  // 21-50 players
  return [
    { place: 1, share: 0.45 },
    { place: 2, share: 0.22 },
    { place: 3, share: 0.13 },
    { place: 4, share: 0.08 },
    { place: 5, share: 0.05 },
    { place: 6, share: 0.03 },
    { place: 7, share: 0.02 },
    { place: 8, share: 0.02 }
  ];
}

/**
 * Create a new room state
 */
function createRoom(roomId, entryFee, maxPlayers = 10) {
  return {
    roomId,
    entryFee,
    maxPlayers,
    status: 'lobby',       // lobby | countdown | racing | finished
    round: 0,
    players: {},           // playerId → { name, socketId, distance, alive, finishTime, joinTime }
    countdownStart: null,
    countdownDuration: 30000, // 30s countdown once ≥2 players
    raceStart: null,
    raceSeed: null,
    obstacles: null,
    totalPool: 0,
    prizePool: 0,
    houseRake: 0,
    winners: [],           // ordered by distance
    createdAt: Date.now(),
  };
}

function recalculateRoomMoney(room, winnerShare = 0.8) {
  const totalPool = Object.keys(room.players || {}).length * room.entryFee;
  const prizePool = Math.floor(totalPool * winnerShare);
  room.totalPool = totalPool;
  room.prizePool = prizePool;
  room.houseRake = totalPool - prizePool;
  return room;
}

/**
 * Start the countdown for a room (called when 2+ players join)
 */
function startRoomCountdown(room, minPlayers = 2, countdownDuration = 30000) {
  if (room.status !== 'lobby' || Object.keys(room.players).length < minPlayers) return false;
  room.status = 'countdown';
  room.countdownStart = Date.now();
  room.countdownDuration = countdownDuration;
  return true;
}

/**
 * Determine if a player has collided with any obstacles at a given distance.
 * Returns the first obstacle the player hit, or null.
 */
function checkCollision(playerDistance, obstacles, playerY = 0, ducking = false) {
  const playerWidth = ducking ? PLAYER_DUCK_WIDTH : PLAYER_WIDTH;
  const playerHeight = ducking ? PLAYER_DUCK_HEIGHT : PLAYER_HEIGHT;
  const playerLeft = playerDistance;
  const playerRight = playerDistance + playerWidth;
  const playerBottom = playerY;
  const playerTop = playerY + playerHeight;

  for (const obs of obstacles) {
    const obsLeft = obs.distance;
    const obsRight = obs.distance + obs.width;
    const obsBottom = obs.y;
    const obsTop = obs.y + obs.height;
    const overlapsX = playerRight > obsLeft + 4 && playerLeft < obsRight - 4;
    const overlapsY = playerTop > obsBottom + 4 && playerBottom < obsTop - 4;
    if (overlapsX && overlapsY) return obs;
  }
  return null;
}
/**
 * Calculate final rankings based on survival distance
 */
function computeRankings(room) {
  const entries = Object.entries(room.players);
  const ranked = entries
    .map(([id, p]) => ({ playerId: id, name: p.name, distance: p.distance || 0, alive: p.alive }))
    .sort((a, b) => b.distance - a.distance);

  room.winners = ranked;
  return ranked;
}

/**
 * Calculate payouts for winners
 * Returns array of { playerId, name, distance, place, prize }
 */
function calculatePayouts(room) {
  if (!room.winners || room.winners.length === 0) computeRankings(room);

  const dist = prizeDistribution(Object.keys(room.players).length);
  const prizePool = Math.max(0, Math.floor(Number(room.prizePool) || 0));
  const winners = room.winners.slice(0, dist.length);
  let allocated = 0;

  return winners.map((winner, i) => {
    const isLast = i === winners.length - 1;
    const prize = isLast
      ? Math.max(0, prizePool - allocated)
      : Math.max(0, Math.floor(prizePool * dist[i].share));
    allocated += prize;
    return {
      ...winner,
      place: i + 1,
      prize,
    };
  });
}

/**
 * Count alive players in a room
 */
function aliveCount(room) {
  return Object.values(room.players).filter(p => p.alive).length;
}

/**
 * Check if game should end (all crashed or only winner left)
 */
function shouldEndGame(room) {
  const alive = aliveCount(room);
  const total = Object.keys(room.players).length;
  if (alive === 0) return 'all_crashed';
  if (total > 1 && alive === 1) return 'winner_decided';
  return false;
}

// --- Game speed constants (shared with client) ---
const GAME_SPEED_BASE = 280;     // pixels per second base speed
const GAME_SPEED_INCREASE = 0.35; // speed increase per second of game time
const JUMP_VELOCITY = 380;       // initial jump velocity (pixels/s)
const GRAVITY = 980;             // gravity (pixels/s²)
const GROUND_Y = 0;
const PLAYER_WIDTH = 34;
const PLAYER_HEIGHT = 58;
const PLAYER_DUCK_WIDTH = 40;
const PLAYER_DUCK_HEIGHT = 24;

module.exports = {
  mulberry32,
  makeSeed,
  generateObstacles,
  createRoom,
  startRoomCountdown,
  checkCollision,
  computeRankings,
  calculatePayouts,
  aliveCount,
  shouldEndGame,
  prizeDistribution,
  recalculateRoomMoney,
  ENTRY_FEES,
  // Game physics constants
  GAME_SPEED_BASE,
  GAME_SPEED_INCREASE,
  JUMP_VELOCITY,
  GRAVITY,
  GROUND_Y,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_DUCK_WIDTH,
  PLAYER_DUCK_HEIGHT,
};
