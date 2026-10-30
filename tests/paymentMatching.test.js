const assert = require('assert');
const {
  findDepositMatches,
  parsePaymentSms,
  phoneLast4,
} = require('../lib/paymentMatching');

const sms = 'You have received ETB 500.00 from 091*****1234. Transaction No TXN9A8B7C6 on 2026-05-21.';
const parsed = parsePaymentSms(sms);
assert.strictEqual(parsed.amount, 500);
assert.strictEqual(parsed.payerLast4, '1234');
assert.strictEqual(parsed.reference, 'TXN9A8B7C6');
assert.strictEqual(phoneLast4('0912345678'), '5678');
assert.strictEqual(parsePaymentSms('You have received ETB 1,250.00 from 091*****9876. Ref ABC12345').amount, 1250);
assert.strictEqual(parsePaymentSms('You have received ETB 1,250.50 from 091*****9876. Ref ABC12345').amount, 0);

const amharicTelebirr = 'ውድ Abel \nከ Daniel Melese(251****68219) 50.00 ብር በ 04/06/2026 09:06:09 ተቀብለዋል፡፡ የሂሳብ እንቅስቃሴ ቁጥርዎ DF45L2CUCD ነዉ፡፡ አሁን ያለዎት ቀሪ ሂሳብ 50.00 ብር ነዉ፡፡';
const parsedAmharicTelebirr = parsePaymentSms(amharicTelebirr);
assert.strictEqual(parsedAmharicTelebirr.amount, 50);
assert.strictEqual(parsedAmharicTelebirr.payerLast4, '8219');
assert.strictEqual(parsedAmharicTelebirr.reference, 'DF45L2CUCD');

const createdAt = '2026-05-21T04:00:00.000Z';
const matches = findDepositMatches([
  { id: 'req1', type: 'deposit', status: 'pending', amount: 500, payerPhoneLast4: '1234', createdAt },
  { id: 'req2', type: 'deposit', status: 'pending', amount: 400, payerPhoneLast4: '1234', createdAt },
  { id: 'req3', type: 'withdraw', status: 'pending', amount: 500, payerPhoneLast4: '1234', createdAt },
], parsed, '2026-05-21T04:05:00.000Z', Date.parse('2026-05-21T04:05:00.000Z'));
assert.deepStrictEqual(matches.map(req => req.id), ['req1']);

console.log('paymentMatching tests passed');
