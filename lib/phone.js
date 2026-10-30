function canonicalEthiopianPhone(value) {
  const raw = String(value || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+251')) digits = `251${digits.slice(3)}`;

  if (/^09\d{8}$/.test(digits) || /^07\d{8}$/.test(digits)) return digits;
  if (/^2519\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^2517\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return '';
}

function isValidEthiopianPhone(value) {
  return !!canonicalEthiopianPhone(value);
}

module.exports = { canonicalEthiopianPhone, isValidEthiopianPhone };
