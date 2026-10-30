const assert = require('assert');
const { contactKeyboard, inviteKeyboard, loginKeyboard, mainMenuKeyboard } = require('../bot');
const { isTelegramBotToken } = require('../lib/telegramBotToken');

const menu = mainMenuKeyboard('en');
const actions = menu.inline_keyboard.flat().map(button => button.callback_data).filter(Boolean);
for (const action of ['menu:register', 'menu:balance', 'menu:deposit', 'menu:withdraw', 'menu:invite']) {
  assert(actions.includes(action), `Main menu should include ${action}.`);
}

const contact = contactKeyboard('en').keyboard[0][0];
assert.strictEqual(contact.request_contact, true, 'Registration should request the Telegram contact.');

const inviteUrl = new URL(inviteKeyboard('en').inline_keyboard[0][0].url);
assert.strictEqual(inviteUrl.origin + inviteUrl.pathname, 'https://t.me/share/url');
const botLink = new URL(inviteUrl.searchParams.get('url'));
assert.strictEqual(botLink.hostname, 't.me');
assert.strictEqual(botLink.pathname, '/zbingo111_bot');
assert.strictEqual(botLink.searchParams.get('start'), 'invite');

const loginButton = loginKeyboard('en').inline_keyboard[0][0];
const loginUrl = loginButton.web_app?.url || loginButton.url;
assert(loginUrl.includes('tg_login=bot'), 'Login button should launch the app with Telegram login enabled.');

assert(isTelegramBotToken(`123456789:${'A'.repeat(35)}`), 'A complete Telegram bot token should be accepted.');
assert(!isTelegramBotToken('123456789:short'), 'An incomplete Telegram bot token should be rejected.');
assert(!isTelegramBotToken('not-a-token'), 'A malformed Telegram bot token should be rejected.');

console.log('bot tests passed');
