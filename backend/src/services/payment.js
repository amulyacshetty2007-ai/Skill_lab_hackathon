// Mock payment gateway. Deterministic so evaluators can demo success AND failure.
//
//   Card 4242 4242 4242 4242 -> success            UPI  anything@upi   -> success
//   Card 4000 0000 0000 0002 -> card declined      UPI  fail@upi       -> declined
//   Card 4000 0000 0000 9995 -> insufficient funds
//   Card 4000 0000 0000 0119 -> gateway error (retry later)
//
// The full card number is validated and judged in memory and then discarded. Only the last 4 digits are stored.
function luhn(num) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = Number(num[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

export const FAILURES = {
  CARD_DECLINED: 'Your card was declined by the bank.',
  INSUFFICIENT_FUNDS: 'Insufficient funds on this card.',
  GATEWAY_ERROR: 'The payment gateway had a temporary problem. Please try again.',
  UPI_DECLINED: 'The UPI request was declined.',
  INVALID_CARD: 'That card number is not valid.',
};

export function chargeCard({ number, expiry, cvv }, now = new Date()) {
  const n = number.replace(/\s|-/g, '');
  if (!/^\d{13,19}$/.test(n) || !luhn(n)) return { ok: false, code: 'INVALID_CARD', hint: null };
  const m = /^(\d{2})\/(\d{2})$/.exec(expiry);
  const month = m ? Number(m[1]) : 0;
  const year = m ? 2000 + Number(m[2]) : 0;
  const expired = !m || month < 1 || month > 12 || new Date(year, month, 1) <= now;
  const hint = `•••• ${n.slice(-4)}`;
  if (expired) return { ok: false, code: 'CARD_DECLINED', hint };
  if (!/^\d{3,4}$/.test(cvv)) return { ok: false, code: 'INVALID_CARD', hint };
  if (n === '4000000000000002') return { ok: false, code: 'CARD_DECLINED', hint };
  if (n === '4000000000009995') return { ok: false, code: 'INSUFFICIENT_FUNDS', hint };
  if (n === '4000000000000119') return { ok: false, code: 'GATEWAY_ERROR', hint };
  return { ok: true, hint };
}

export function chargeUpi({ vpa }) {
  const [user, handle] = vpa.split('@');
  const hint = `${user.slice(0, 1)}***@${handle}`;
  if (user.toLowerCase().startsWith('fail')) return { ok: false, code: 'UPI_DECLINED', hint };
  return { ok: true, hint };
}
