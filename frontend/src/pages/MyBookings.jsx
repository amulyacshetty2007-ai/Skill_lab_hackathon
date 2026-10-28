import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../toast.jsx';
import { clock, fmtDateTime, rupees } from '../util.js';

const tone = { CONFIRMED: 'pill-ok', PENDING: 'pill-warn', CANCELLED: 'pill-bad' };
const words = { CONFIRMED: 'Confirmed', PENDING: 'Awaiting payment', CANCELLED: 'Cancelled' };

function CancelModal({ b, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const r = b.refundIfCancelled;
  const confirm = async () => {
    setBusy(true);
    try { const res = await api.post(`/bookings/${b.id}/cancel`); toast(`Cancelled. ${rupees(res.booking.refundPaise)} will be refunded.`, 'ok'); onDone(); }
    catch (e) { toast(e.message, 'bad'); onDone(); } finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cm-t" onClick={(e) => e.stopPropagation()}>
        <h2 id="cm-t">Cancel this booking?</h2>
        <p>{b.train.name} · {b.from.code} to {b.to.code} · {fmtDateTime(b.departsAt)}<br />PNR <strong>{b.pnr}</strong>, {b.seatCount} seat{b.seatCount > 1 ? 's' : ''}</p>
        <div className="refund-box"><span className="muted">You get back ({r.percent}% of {rupees(b.paidPaise)})</span><span className="big num">{rupees(r.amountPaise)}</span>
          <span className="hint">The earlier you cancel, the more you get back: 90% from 48 hours out, 75% from 12 hours, 50% from 4 hours, then 25%.</span></div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Keep booking</button>
          <button className="btn btn-danger" onClick={confirm} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel booking'}</button>
        </div>
      </div>
    </div>
  );
}

export default function MyBookings() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [tab, setTab] = useState('upcoming');
  const [cancelling, setCancelling] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get('/bookings').then((r) => setList(r.bookings)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const release = async (b) => { try { await api.post(`/bookings/${b.id}/release`); toast('Seats released.'); load(); } catch (e) { toast(e.message, 'bad'); } };

  if (error) return <div className="container page"><div className="notice notice-bad" role="alert">{error}</div></div>;
  if (!list) return <div className="center-box"><span className="spinner" /></div>;

  const now = Date.now();
  const groups = {
    upcoming: list.filter((b) => (b.status === 'CONFIRMED' && new Date(b.departsAt) > now) || b.status === 'PENDING'),
    past: list.filter((b) => b.status === 'CONFIRMED' && new Date(b.departsAt) <= now),
    cancelled: list.filter((b) => b.status === 'CANCELLED'),
  };
  const shown = groups[tab];

  return (
    <div className="container page">
      <div className="page-head"><div><h1 style={{ fontSize: '2.4rem' }}>My bookings</h1></div><Link className="btn btn-primary" to="/">Book a trip</Link></div>
      <div className="tabs" role="tablist">
        {[['upcoming', 'Upcoming'], ['past', 'Past'], ['cancelled', 'Cancelled']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l} ({groups[k].length})</button>))}
      </div>
      {shown.length === 0 && (
        <div className="empty"><h3>{tab === 'upcoming' ? 'No upcoming trips' : tab === 'past' ? 'No past trips yet' : 'Nothing cancelled'}</h3>
          {tab === 'upcoming' && <><p>Search for a train and your tickets will show up here.</p><Link className="btn btn-dark" to="/">Find trains</Link></>}</div>
      )}
      {shown.map((b) => (
        <article className="booking-card" key={b.id}>
          <div>
            <h3>{b.from.name} to {b.to.name} <span className={`pill ${tone[b.status]}`}>{words[b.status]}</span></h3>
            <div className="meta">
              <span>{b.train.name} {b.train.number}</span><span>{fmtDateTime(b.departsAt)}</span>
              <span>PNR {b.pnr}</span><span>{b.passengers.map((p) => `${p.name} (${p.coach}-${p.seat})`).join(', ')}</span>
            </div>
            <div className="meta"><span>Paid {rupees(b.paidPaise ?? b.amountPaise)}</span>
              {b.status === 'CANCELLED' && <span>Refunded {rupees(b.refundPaise)}{b.cancelledBy === 'ORGANISER' ? ' (train cancelled by operator)' : ''}</span>}
              {b.status === 'PENDING' && <span>Hold ends in {clock(b.holdSecondsLeft)}</span>}</div>
          </div>
          <div className="booking-actions">
            {b.status === 'PENDING' && <><Link className="btn btn-primary btn-sm" to={`/checkout/${b.id}`}>Resume payment</Link><button className="btn btn-ghost btn-sm" onClick={() => release(b)}>Release seats</button></>}
            {b.status !== 'PENDING' && <Link className="btn btn-ghost btn-sm" to={`/ticket/${b.id}`}>View ticket</Link>}
            {b.canCancel && <button className="btn btn-ghost btn-sm" onClick={() => setCancelling(b)}>Cancel booking</button>}
          </div>
        </article>
      ))}
      {cancelling && <CancelModal b={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); load(); }} />}
    </div>
  );
}
