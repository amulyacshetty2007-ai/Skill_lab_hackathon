import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fieldErrors } from '../api.js';
import { useToast } from '../toast.jsx';
import { clock, fmtDateTime, newKey, rupees } from '../util.js';
import { Lock } from '../components/Icons.jsx';

const TEST_CARDS = [
  { label: 'Succeeds', number: '4242 4242 4242 4242' },
  { label: 'Declined', number: '4000 0000 0000 0002' },
  { label: 'No funds', number: '4000 0000 0000 9995' },
  { label: 'Gateway error', number: '4000 0000 0000 0119' },
];

function Steps({ now }) {
  const items = ['Seats', 'Payment', 'Ticket'];
  return (
    <ol className="stepper" aria-label="Booking steps" style={{ listStyle: 'none', padding: 0 }}>
      {items.map((s, i) => (
        <li key={s} style={{ display: 'contents' }}>
          <span className={`step ${i < now ? 'done' : i === now ? 'now' : ''}`} aria-current={i === now ? 'step' : undefined}><b>{i < now ? '✓' : i + 1}</b>{s}</span>
          {i < items.length - 1 && <span className="step-sep" />}
        </li>
      ))}
    </ol>
  );
}

function Ring({ left, total }) {
  const r = 26, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(1, left / total));
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="6" />
      <circle cx="32" cy="32" r={r} fill="none" stroke="#ffc21a" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset 1s linear' }} />
    </svg>
  );
}

export default function Checkout() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [b, setB] = useState(null);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(0);
  const [method, setMethod] = useState('CARD');
  const [card, setCard] = useState({ number: '', expiry: '', cvv: '', holder: '' });
  const [vpa, setVpa] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);     // last failed payment
  const [errs, setErrs] = useState({});
  const keyRef = useRef(newKey());                // one idempotency key per attempt; reused if the network drops mid-request
  const total = useRef(300);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/bookings/${id}`);
      setB(r.booking); setLeft(r.booking.holdSecondsLeft);
      if (r.booking.holdSecondsLeft > total.current) total.current = r.booking.holdSecondsLeft;
      if (r.booking.status === 'CONFIRMED') nav(`/ticket/${id}`, { replace: true });
    } catch (e) { setError(e.message); }
  }, [id, nav]);
  useEffect(() => { load(); }, [load]);

  // The countdown is cosmetic: the server decides when the hold really ends.
  useEffect(() => {
    if (!b || b.status !== 'PENDING') return undefined;
    const t = setInterval(() => setLeft((s) => {
      if (s <= 1) { clearInterval(t); load(); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [b?.status, load]);   // eslint-disable-line

  const formatCard = (v) => v.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();
  const formatExp = (v) => { const d = v.replace(/\D/g, '').slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };

  const pay = async (e) => {
    e.preventDefault();
    setErrs({}); setResult(null);
    const e2 = {};
    if (method === 'CARD') {
      if (card.number.replace(/\s/g, '').length < 13) e2.number = 'Enter the card number.';
      if (!/^\d{2}\/\d{2}$/.test(card.expiry)) e2.expiry = 'Use MM/YY.';
      if (!/^\d{3,4}$/.test(card.cvv)) e2.cvv = '3 or 4 digits.';
    } else if (!/^[\w.-]{2,40}@[A-Za-z]{2,20}$/.test(vpa)) e2.vpa = 'Enter a UPI id like name@bank.';
    if (Object.keys(e2).length) return setErrs(e2);

    setBusy(true);
    try {
      const body = method === 'CARD' ? { method, card: { number: card.number, expiry: card.expiry, cvv: card.cvv, ...(card.holder ? { holder: card.holder } : {}) } } : { method, upi: { vpa } };
      const r = await api.post(`/bookings/${id}/pay`, body, { 'Idempotency-Key': keyRef.current });
      keyRef.current = newKey();                       // got an answer: the next click is a new attempt
      setB(r.booking);
      if (r.payment.status === 'SUCCESS') { toast('Payment received. Your seats are booked.', 'ok'); nav(`/ticket/${id}`, { replace: true }); }
      else setResult(r.payment);
    } catch (err) {
      if (err.code === 'HOLD_EXPIRED') { toast(err.message, 'bad'); load(); }
      else if (err.code === 'VALIDATION_FAILED') setErrs(fieldErrors(err));
      else if (err.code === 'NETWORK') toast(err.message + ' Press Pay again: you will not be charged twice.', 'bad');
      else toast(err.message, 'bad');
    } finally { setBusy(false); }
  };

  const release = async () => {
    try { await api.post(`/bookings/${id}/release`); toast('Seats released.'); nav('/'); } catch (e) { toast(e.message, 'bad'); }
  };

  if (error) return <div className="container page"><div className="notice notice-bad" role="alert">{error}</div></div>;
  if (!b) return <div className="center-box"><span className="spinner" /></div>;

  const dead = b.status !== 'PENDING';
  return (
    <div className="container page">
      <Steps now={1} />
      {dead ? (
        <div className="empty panel">
          <h2>{b.status === 'FAILED' ? 'Payment failed three times' : 'Your seat hold has ended'}</h2>
          <p>{b.status === 'FAILED' ? 'We released your seats and did not charge you.' : 'The seats went back on sale and you were not charged.'} Pick seats again to continue.</p>
          <Link className="btn btn-primary" to={`/book/${b.runId}?from=${b.from.code}&to=${b.to.code}`}>Choose seats again</Link>
        </div>
      ) : (
        <div className="checkout-layout">
          <div className="stack">
            <div className={`timer ${left <= 60 ? 'low' : ''}`} role="timer" aria-live="off">
              <Ring left={left} total={total.current} />
              <div><div className="t">{clock(left)}</div><p>{left <= 60 ? 'Hurry: your seats are released when this reaches zero.' : 'Your seats are held for you while you pay.'}</p></div>
            </div>

            <form className="panel stack" onSubmit={pay} noValidate>
              <div className="row-between"><h2>Pay {rupees(b.amountPaise)}</h2>
                <div className="attempts" aria-label={`${b.paymentAttempts} of ${b.maxPaymentAttempts} payment attempts used`}>
                  {Array.from({ length: b.maxPaymentAttempts }, (_, i) => <i key={i} className={i < b.paymentAttempts ? 'used' : ''} />)}<span className="muted">{b.maxPaymentAttempts - b.paymentAttempts} tries left</span></div></div>

              <div className="method-switch" role="group" aria-label="Payment method">
                <button type="button" aria-pressed={method === 'CARD'} onClick={() => setMethod('CARD')}>Card</button>
                <button type="button" aria-pressed={method === 'UPI'} onClick={() => setMethod('UPI')}>UPI</button>
              </div>

              {result && (
                <div className="notice notice-bad" role="alert">
                  <strong>{result.failureMessage}</strong>
                  <div>{result.attemptsLeft > 0 ? `Nothing was charged. You can try again (${result.attemptsLeft} left). Your seats are still held.` : 'No attempts left. Your seats have been released.'}</div>
                </div>
              )}

              {method === 'CARD' ? (
                <>
                  <div className="field"><label htmlFor="cn">Card number</label>
                    <input id="cn" className="input num" inputMode="numeric" autoComplete="cc-number" placeholder="1234 5678 9012 3456" value={card.number} aria-invalid={!!errs.number}
                      onChange={(e) => setCard({ ...card, number: formatCard(e.target.value) })} />
                    {errs.number && <span className="field-error">{errs.number}</span>}</div>
                  <div className="grid-3">
                    <div className="field"><label htmlFor="ce">Expiry</label>
                      <input id="ce" className="input num" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" value={card.expiry} aria-invalid={!!errs.expiry} onChange={(e) => setCard({ ...card, expiry: formatExp(e.target.value) })} />
                      {errs.expiry && <span className="field-error">{errs.expiry}</span>}</div>
                    <div className="field"><label htmlFor="cc">CVV</label>
                      <input id="cc" className="input num" inputMode="numeric" autoComplete="cc-csc" type="password" maxLength={4} value={card.cvv} aria-invalid={!!errs.cvv} onChange={(e) => setCard({ ...card, cvv: e.target.value.replace(/\D/g, '') })} />
                      {errs.cvv && <span className="field-error">{errs.cvv}</span>}</div>
                    <div className="field"><label htmlFor="ch">Name on card</label>
                      <input id="ch" className="input" autoComplete="cc-name" value={card.holder} onChange={(e) => setCard({ ...card, holder: e.target.value })} /></div>
                  </div>
                  <div>
                    <div className="hint" style={{ marginBottom: 6 }}>Demo cards. Tap one to fill it in (any future expiry, any CVV):</div>
                    <div className="testcards">{TEST_CARDS.map((t) => (
                      <button type="button" key={t.number} className="chip" onClick={() => setCard({ number: t.number, expiry: '12/39', cvv: '123', holder: 'Demo Traveller' })}>{t.label}</button>))}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="field"><label htmlFor="upi">UPI id</label>
                    <input id="upi" className="input" placeholder="name@bank" autoComplete="off" value={vpa} aria-invalid={!!errs.vpa} onChange={(e) => setVpa(e.target.value.trim())} />
                    {errs.vpa && <span className="field-error">{errs.vpa}</span>}</div>
                  <div className="testcards">
                    <button type="button" className="chip" onClick={() => setVpa('asha@okbank')}>Succeeds</button>
                    <button type="button" className="chip" onClick={() => setVpa('fail@okbank')}>Declined</button></div>
                </>
              )}

              <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Processing payment…' : <><Lock width={18} height={18} /> Pay {rupees(b.amountPaise)}</>}</button>
              <p className="hint">Payments are simulated. We never store your full card number.</p>
            </form>
          </div>

          <aside className="panel stack">
            <h2>Your trip</h2>
            <div><strong>{b.train.name}</strong> <span className="tc-num">{b.train.number}</span></div>
            <div><div className="tc-st">Departs</div><strong>{b.from.name}</strong><div className="muted">{fmtDateTime(b.departsAt)}</div></div>
            <div><div className="tc-st">Arrives</div><strong>{b.to.name}</strong><div className="muted">{fmtDateTime(b.arrivesAt)}</div></div>
            <table className="pax-table"><thead><tr><th>Passenger</th><th>Seat</th><th style={{ textAlign: 'right' }}>Fare</th></tr></thead>
              <tbody>{b.passengers.map((p) => <tr key={p.coach + p.seat}><td>{p.name}<div className="hint">{p.age} · {p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : 'Other'}</div></td><td>{p.coach}-{p.seat}</td><td className="num" style={{ textAlign: 'right' }}>{rupees(p.farePaise)}</td></tr>)}</tbody></table>
            <div className="totals"><div className="summary-line"><span>Total</span><span className="big num">{rupees(b.amountPaise)}</span></div></div>
            <button className="btn btn-ghost" onClick={release}>Release seats and leave</button>
          </aside>
        </div>
      )}
    </div>
  );
}
