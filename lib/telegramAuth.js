const crypto = require('crypto');

function parseInitData(initData) {
  const params = new URLSearchParams(initData || '');
  const data = {};
  for (const [key, value] of params.entries()) data[key] = value;
  return data;
}

function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!botToken) return { ok: false, error: 'Telegram bot token is not configured.' };
  const data = parseInitData(initData);
  const hash = data.hash;
  if (!hash) return { ok: false, error: 'Missing Telegram hash.' };

  delete data.hash;
  const checkString = Object.keys(data)
    .sort()
    .map(key => `${key}=${data[key]}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(hash)) return { ok: false, error: 'Invalid Telegram hash format.' };
  const validHash = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(hash, 'hex'));
  if (!validHash) return { ok: false, error: 'Invalid Telegram signature.' };

  const authDate = Number(data.auth_date || 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) return { ok: false, error: 'Telegram login expired.' };

  let user = null;
  try {
    user = data.user ? JSON.parse(data.user) : null;
  } catch {
    return { ok: false, error: 'Invalid Telegram user payload.' };
  }
  if (!user?.id) return { ok: false, error: 'Missing Telegram user.' };

  return {
    ok: true,
    user: {
      id: String(user.id),
      username: user.username || null,
      firstName: user.first_name || null,
      lastName: user.last_name || null,
      photoUrl: user.photo_url || null,
    },
  };
}

module.exports = { parseInitData, verifyTelegramInitData };
