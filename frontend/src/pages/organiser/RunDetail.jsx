import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useToast } from '../../toast.jsx';
import { fmtDateTime, rupees } from '../../util.js';

export default function RunDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/organiser/runs/${id}/manifest`).then(setM).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);   // eslint-disable-line

  const cancel = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/organiser/runs/${id}/cancel`, { reason });
      toast(`Run cancelled. ${r.refundedBookings} booking${r.refundedBookings === 1 ? '' : 's'} refunded in full (${rupees(r.refundedPaise)}), ${r.releasedHolds} hold${r.releasedHolds === 1 ? '' : 's'} released.`, 'ok');
      setOpen(false); load();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  if (error) return <div className="container page"><div className="notice notice-bad" role="alert">{error}</div></div>;
  if (!m) return <div className="center-box"><span className="spinner" /></div>;
  const cancelled = m.run.status === 'CANCELLED';
  const departed = new Date(m.run.startAt) <= new Date();

  return (
    <div className="container page">
      <div className="page-head">
        <div><Link to="/organiser/runs" className="muted" style={{ fontWeight: 650 }}>All runs</Link>
          <h1 style={{ fontSize: '2.2rem', marginTop: 6 }}>{m.run.trainName} <span className="tc-num" style={{ verticalAlign: 'middle' }}>{m.run.trainNumber}</span></h1>
          <p>{fmtDateTime(m.run.startAt)} {cancelled && <span className="pill pill-bad">Cancelled</span>}</p></div>
        {!cancelled && !departed && <button className="btn btn-danger" onClick={() => setOpen(true)}>Cancel this run</button>}
      </div>
      <section className="panel">
        <h2 style={{ marginBottom: 8 }}>Passenger list ({m.passengers.length})</h2>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Coach</th><th>Seat</th><th>Passenger</th><th>Age</th><th>Gender</th><th>Journey</th><th>PNR</th></tr></thead>
          <tbody>{m.passengers.length === 0 && <tr><td colSpan={7} className="muted">{cancelled ? 'This run was cancelled and all bookings were refunded.' : 'No confirmed passengers yet.'}</td></tr>}
            {m.passengers.map((p, i) => <tr key={i}><td>{p.coach}</td><td><strong>{p.seat}</strong></td><td>{p.name}</td><td>{p.age}</td><td>{p.gender}</td><td>{p.from} to {p.to}</td><td>{p.pnr}</td></tr>)}</tbody>
        </table></div>
      </section>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cr-t" onClick={(e) => e.stopPropagation()}>
            <h2 id="cr-t">Cancel this run?</h2>
            <p>Every confirmed passenger is refunded 100% and seats on hold are released. This cannot be undone.</p>
            <div className="field"><label htmlFor="cr">Reason (shown to your records)</label><input id="cr" className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>Keep run</button>
              <button className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={cancel}>{busy ? 'Cancelling…' : 'Cancel run and refund'}</button></div>
          </div>
        </div>)}
    </div>
  );
}
