const assert = require('assert');
const crypto = require('crypto');
const { parseInitData, verifyTelegramInitData } = require('../lib/telegramAuth');

function sign(data, token) {
  const checkString = Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  return crypto.createHmac('sha256', secret).update(checkString).digest('hex');
}

{
  const parsed = parseInitData('a=1&b=two');
  assert.strictEqual(parsed.a, '1');
  assert.strictEqual(parsed.b, 'two');
}

{
  const token = '123:test-token';
  const payload = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 42, first_name: 'Ada', username: 'ada' }),
  };
  const hash = sign(payload, token);
  const initData = new URLSearchParams({ ...payload, hash }).toString();
  const result = verifyTelegramInitData(initData, token);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.user.id, '42');
  assert.strictEqual(result.user.firstName, 'Ada');
}

{
  const result = verifyTelegramInitData('auth_date=1&hash=00', 'token');
  assert.strictEqual(result.ok, false);
}

console.log('telegramAuth tests passed');
