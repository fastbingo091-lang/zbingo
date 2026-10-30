let TOKEN = process.env.ADMIN_TELEGRAM_BOT_TOKEN || '';
const SERVER_API_URL = process.env.SERVER_API_URL || process.env.WEBAPP_URL || 'http://localhost:5000';
const BOT_SERVER_API_KEY = process.env.BOT_SERVER_API_KEY || process.env.PAYMENT_SMS_API_KEY || 'change-me-payment-sms-key';

let offset = 0;
let lastConfigCheck = 0;

function isHttpsUrl(url) {
  return /^https:\/\//i.test(String(url || ''));
}

async function serverApi(path, options = {}) {
  const url = `${SERVER_API_URL.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${BOT_SERVER_API_KEY}`,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { error: text }; }
  if (!res.ok || data.ok === false) throw new Error(data.error || `Server API failed (${res.status})`);
  return data;
}

async function refreshConfig(force = false) {
  const now = Date.now();
  if (!force && now - lastConfigCheck < 60_000) return;
  lastConfigCheck = now;
  try {
    const data = await serverApi('/api/admin-bot/config');
    if (data.adminBotToken && data.adminBotToken !== TOKEN) {
      TOKEN = data.adminBotToken;
      console.log('Admin alert bot token reloaded from server.');
    }
  } catch (error) {
    console.error('Admin bot config refresh error:', error.message);
  }
}

async function tg(method, payload) {
  if (!TOKEN) throw new Error('ADMIN_TELEGRAM_BOT_TOKEN is not configured.');
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.description || `${method} failed`);
  return data.result;
}

async function sendMessage(chatId, text, extra = {}) {
  return tg('sendMessage', { chat_id: chatId, text, ...extra });
}

function helpText(chatId) {
  return [
    'HabeshaBingo Admin Alerts',
    '',
    `Your Telegram chat ID: ${chatId}`,
    '',
    'Commands:',
    '/id - show this chat ID',
    '/link username password - connect this Telegram to your admin account',
    '/help - show help',
    '',
    'After linking, withdrawal requests, support requests, reports, high-win alerts, and system alerts will come here.',
  ].join('\n');
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  if (!chatId) return;
  const text = String(message.text || '').trim();
  const [commandRaw, ...parts] = text.split(/\s+/);
  const command = String(commandRaw || '').split('@')[0].toLowerCase();

  if (command === '/start' || command === '/help' || command === '/id') {
    await sendMessage(chatId, helpText(chatId));
    return;
  }

  if (command === '/link') {
    const adminLogin = parts[0] || '';
    const password = parts.slice(1).join(' ');
    if (!adminLogin || !password) {
      await sendMessage(chatId, 'Use: /link username password\n\nYou can find your username on the admin login information from the Master Admin.');
      return;
    }
    try {
      const data = await serverApi('/api/admin-bot/link', {
        method: 'POST',
        body: {
          adminLogin,
          password,
          chatId,
          telegramId: message.from?.id,
          telegramUsername: message.from?.username || '',
          firstName: message.from?.first_name || '',
          lastName: message.from?.last_name || '',
        },
      });
      await sendMessage(chatId, `Connected successfully.\n\nAdmin: ${data.admin.name}\nRole: ${data.admin.roleLabel || data.admin.role}${data.admin.referralLink ? `\nReferral link: ${data.admin.referralLink}` : ''}\n\nYou will now receive HabeshaBingo admin alerts here.`);
    } catch (error) {
      await sendMessage(chatId, `Could not connect admin alerts.\n\n${error.message}`);
    }
    return;
  }

  await sendMessage(chatId, 'Unknown command. Use /help.');
}

async function poll() {
  await refreshConfig();
  if (!TOKEN) {
    console.error('Admin alert bot token is not configured. Set ADMIN_TELEGRAM_BOT_TOKEN or save Admin Bot Token in Master Settings.');
    setTimeout(poll, 15_000);
    return;
  }
  try {
    const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
    for (const update of updates) {
      offset = update.update_id + 1;
      if (update.message) await handleMessage(update.message);
    }
  } catch (error) {
    console.error('Admin alert bot error:', error.message);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  setImmediate(poll);
}

console.log(`Admin alert bot polling. Server API: ${SERVER_API_URL}. ${isHttpsUrl(SERVER_API_URL) ? 'HTTPS' : 'Local/dev'} mode.`);
poll();
