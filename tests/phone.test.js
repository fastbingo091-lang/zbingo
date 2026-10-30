const assert = require('assert');
const { canonicalEthiopianPhone, isValidEthiopianPhone } = require('../lib/phone');

assert.strictEqual(canonicalEthiopianPhone('0912345678'), '0912345678');
assert.strictEqual(canonicalEthiopianPhone('0712345678'), '0712345678');
assert.strictEqual(canonicalEthiopianPhone('251912345678'), '0912345678');
assert.strictEqual(canonicalEthiopianPhone('+251912345678'), '0912345678');
assert.strictEqual(canonicalEthiopianPhone('251712345678'), '0712345678');
assert.strictEqual(canonicalEthiopianPhone('+251712345678'), '0712345678');

assert.strictEqual(isValidEthiopianPhone('912345678'), false);
assert.strictEqual(isValidEthiopianPhone('0812345678'), false);
assert.strictEqual(isValidEthiopianPhone('091234567'), false);
assert.strictEqual(isValidEthiopianPhone('09123456789'), false);

console.log('phone tests passed');
