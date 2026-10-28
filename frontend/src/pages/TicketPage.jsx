import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api.js';
import { fmtDateLong, fmtDuration, fmtTime, rupees } from '../util.js';
import { Check } from '../components/Icons.jsx';

export default function TicketPage() {
  const { id } = useParams();
  const [b, setB] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/bookings/${id}`).then((r) => setB(r.booking)).catch((e) => setError(e.message)); }, [id]);

  if (error) return <div className="container page"><div className="notice notice-bad" role="alert">{error}</div></div>;
  if (!b) return <div className="center-box"><span className="spinner" /></div>;
  const ok = b.status === 'CONFIRMED';
  const dur = Math.round((new Date(b.arrivesAt) - new Date(b.departsAt)) / 60000);

  return (
    <div className="container page">
      {ok && (
        <div className="row no-print" style={{ marginBottom: 22, justifyContent: 'center' }}>
          <span className="success-mark"><Check width={28} height={28} strokeWidth={3} /></span>
          <div><h1 style={{ fontSize: '1.9rem', fontStretch: '85%' }}>You're booked</h1><p className="muted">Show the PNR or QR code at the station. A copy is always in My bookings.</p></div>
        </div>
      )}
      {!ok && <div className={`notice ${b.status === 'CANCELLED' ? 'notice-warn' : 'notice-bad'}`} style={{ maxWidth: 880, margin: '0 auto 18px' }}>
        This ticket is <strong>{b.status.toLowerCase()}</strong>{b.status === 'CANCELLED' && ` and ${rupees(b.refundPaise)} was refunded`}. It is no longer valid for travel.</div>}

      <article className="ticket" aria-label="Ticket" style={ok ? undefined : { opacity: .6 }}>
        <div className="ticket-band"><strong>{b.train.name} · {b.train.number}</strong><span>{fmtDateLong(b.departsAt)}</span></div>
        <div className="ticket-main">
          <div className="ticket-route">
            <div><div className="tc-time">{fmtTime(b.departsAt)}</div><div className="tc-st">{b.from.name}</div></div>
            <div className="tc-line"><span>{fmtDuration(dur)}</span><i /></div>
            <div style={{ textAlign: 'right' }}><div className="tc-time">{fmtTime(b.arrivesAt)}</div><div className="tc-st">{b.to.name}</div></div>
          </div>
          <table className="pax-table">
            <thead><tr><th>Passenger</th><th>Age</th><th>Coach</th><th>Seat</th><th style={{ textAlign: 'right' }}>Fare</th></tr></thead>
            <tbody>{b.passengers.map((p) => <tr key={p.coach + p.seat}><td>{p.name}</td><td>{p.age}</td><td>{p.coach}</td><td><strong>{p.seat}</strong></td><td className="num" style={{ textAlign: 'right' }}>{rupees(p.farePaise)}</td></tr>)}</tbody>
          </table>
          <div className="row-between"><span className="muted">Paid</span><strong className="num">{rupees(b.paidPaise ?? b.amountPaise)}</strong></div>
        </div>
        <div className="ticket-stub">
          <div className="muted" style={{ fontWeight: 650 }}>PNR</div>
          <div className="pnr">{b.pnr}</div>
          <QRCodeSVG value={`RAILRUSH:${b.pnr}`} size={132} level="M" marginSize={0} />
          <span className={`pill ${ok ? 'pill-ok' : 'pill-warn'}`}>{b.status.charAt(0) + b.status.slice(1).toLowerCase()}</span>
        </div>
      </article>

      <div className="row no-print" style={{ justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
        <Link className="btn btn-dark" to="/bookings">My bookings</Link>
        <button className="btn btn-ghost" onClick={() => window.print()}>Print ticket</button>
        <Link className="btn btn-ghost" to="/">Book another trip</Link>
      </div>
    </div>
  );
}
