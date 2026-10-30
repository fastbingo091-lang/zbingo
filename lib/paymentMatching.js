const DEPOSIT_EXPIRY_MS = 30 * 60 * 1000;

function money(value) {
  const parsed = Number(String(value || '').replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return 0;
  return Number.isInteger(parsed) ? parsed : 0;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function phoneLast4(phone) {
  const digits = normalizePhone(phone);
  return digits.length >= 4 ? digits.slice(-4) : '';
}

function parseAmount(message) {
  const text = String(message || '');
  const patterns = [
    /(?:ETB|Birr)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i,
    /([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:ETB|Birr|\u1265\u122D)/i,
    /(?:amount|amt)[^\d]{0,12}([0-9][0-9,]*(?:\.\d{1,2})?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return money(match[1]);
  }
  return 0;
}

function parsePhoneLast4(message) {
  const text = String(message || '');
  const internationalMasked = text.match(/(?:\+?251|0)[\d*xX.\-\s]{3,20}?(\d{4,5})\b/);
  if (internationalMasked) return internationalMasked[1].slice(-4);

  const masked = text.match(/(?:\+?251|0)?9[\d*xX.\-\s]{4,14}(\d{4})\b/);
  if (masked) return masked[1];

  const labeled = text.match(/(?:phone|mobile|from|sender|account|last\s*4|ending)[^\d]{0,18}(\d{4})\b/i);
  if (labeled) return labeled[1];

  const longPhones = text.match(/\b(?:\+?251|0)?9\d{8}\b/g) || [];
  if (longPhones.length === 1) return phoneLast4(longPhones[0]);
  return '';
}

function parseReference(message) {
  const text = String(message || '');
  const labeled = text.match(/\b(?:transaction\s*(?:no|number|id)?|txn|trx|trans|reference|ref|receipt)\b[\s:#.\-]{0,16}([A-Z0-9][A-Z0-9\-]{5,31})/i);
  if (labeled) return labeled[1].replace(/[^A-Z0-9-]/gi, '').toUpperCase();

  const candidates = text.match(/\b[A-Z0-9]{8,32}\b/gi) || [];
  const ignored = new Set(['TELEBIRR', 'TRANSACTION', 'REFERENCE', 'RECEIPT']);
  const candidate = candidates.find(item => !ignored.has(item.toUpperCase()) && /[A-Z]/i.test(item) && /\d/.test(item));
  return candidate ? candidate.toUpperCase() : '';
}

function parsePaymentSms(message) {
  return {
    amount: parseAmount(message),
    payerLast4: parsePhoneLast4(message),
    reference: parseReference(message),
  };
}

function findDepositMatches(requests, parsedSms, receivedAt = new Date().toISOString(), now = Date.now()) {
  const receivedTime = Date.parse(receivedAt);
  const eventTime = Number.isFinite(receivedTime) ? receivedTime : now;
  return (requests || []).filter(request => {
    if (request.type !== 'deposit' || request.status !== 'pending') return false;
    if (money(request.amount) !== money(parsedSms.amount)) return false;
    if (!request.payerPhoneLast4 || request.payerPhoneLast4 !== parsedSms.payerLast4) return false;
    const created = Date.parse(request.createdAt || '');
    if (!Number.isFinite(created)) return false;
    if (created - 2 * 60 * 1000 > eventTime) return false;
    if (eventTime - created > DEPOSIT_EXPIRY_MS) return false;
    return true;
  });
}

module.exports = {
  DEPOSIT_EXPIRY_MS,
  findDepositMatches,
  money,
  parsePaymentSms,
  phoneLast4,
};
