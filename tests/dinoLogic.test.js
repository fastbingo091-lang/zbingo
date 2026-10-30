const assert = require('assert');
const dino = require('../lib/dinoLogic');

{
  const a = dino.generateObstacles(dino.makeSeed('room', 1)).slice(0, 25);
  const b = dino.generateObstacles(dino.makeSeed('room', 1)).slice(0, 25);
  assert.deepStrictEqual(a, b);
}

{
  const obstacles = [{ distance: 100, width: 30, height: 35, type: 'cactus', y: 0 }];
  assert.ok(dino.checkCollision(100, obstacles, 0));
  assert.ok(!dino.checkCollision(100, obstacles, 60));
}

{
  const flyers = [{ distance: 100, width: 32, height: 28, type: 'pterodactyl', y: 45 }];
  assert.ok(dino.checkCollision(100, flyers, 0, false));
  assert.ok(!dino.checkCollision(100, flyers, 0, true));
}

{
  const room = dino.createRoom('r1', 20, 4);
  room.players = {
    p1: { name: 'A', distance: 100 },
    p2: { name: 'B', distance: 80 },
    p3: { name: 'C', distance: 20 },
  };
  dino.recalculateRoomMoney(room, 0.8);
  assert.strictEqual(room.totalPool, 60);
  assert.strictEqual(room.prizePool, 48);
  assert.strictEqual(room.houseRake, 12);
  const payouts = dino.calculatePayouts(room);
  assert.strictEqual(payouts.reduce((sum, p) => sum + p.prize, 0), 48);
  assert.strictEqual(payouts[0].playerId, 'p1');
}

console.log('dinoLogic tests passed');
