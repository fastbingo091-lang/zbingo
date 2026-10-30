function isTelegramBotToken(token) {
  return /^\d{5,15}:[A-Za-z0-9_-]{30,100}$/.test(String(token || '').trim());
}

module.exports = { isTelegramBotToken };
