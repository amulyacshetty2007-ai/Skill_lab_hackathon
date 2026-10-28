import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import BarChart from '../../components/BarChart.jsx';
import { fmtDateTime, rupees } from '../../util.js';

const statusWord = { CONFIRMED: 'Confirmed', CANCELLED: 'Cancelled', PENDING: 'Awaiting payment', EXPIRED: 'Hold expired', FAILED: 'Payment failed' };

export default function Dashboard() {
  const [days, setDays] = useState(14);
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setD(null); api.get(`/organiser/dashboard?days=${days}`).then(setD).catch((e) => setError(e.message)); }, [days]);

  if (error) return <div className="container page"><div className="notice notice-bad" role="alert">{error}</div></div>;
  if (!d) return <div className="center-box"><span className="spinner" /></div>;
  const k = d.kpis;
  const totalStatus = d.byStatus.reduce((a, s) => a + s.n, 0) || 1;

  return (
    <div className="container page">
      <div className="page-head">
        <div><h1 style={{ fontSize: '2.4rem' }}>Dashboard</h1><p>Revenue and seats across your trains. Net revenue is sales minus refunds.</p></div>
        <div className="field" style={{ minWidth: 160 }}><label htmlFor="days">Chart range</label>
          <select id="days" className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option></select></div>
      </div>

      <section className="kpi-panel" aria-label="Key numbers">
        <div className="kpi lead"><span className="muted">Net revenue</span><span className="v num">{rupees(k.netPaise)}</span></div>
        <div className="kpi"><span className="muted">Sales</span><span className="v num">{rupees(k.grossPaise)}</span></div>
        <div className="kpi"><span className="muted">Refunds</span><span className="v num">{rupees(k.refundsPaise)}</span></div>
        <div className="kpi"><span className="muted">Seats sold</span><span className="v num">{k.seatsSold}</span></div>
        <div className="kpi"><span className="muted">Bookings</span><span className="v num">{k.confirmedBookings}</span></div>
        <div className="kpi"><span className="muted">Seats on hold</span><span className="v num">{k.activeHolds}</span><span className="hint">{k.upcomingRuns} upcoming runs</span></div>
      </section>

      <div className="dash-grid">
        <section className="panel"><div className="row-between" style={{ marginBottom: 12 }}><h2>Sales and refunds by day</h2></div><BarChart data={d.daily} /></section>
        <section className="panel"><h2 style={{ marginBottom: 14 }}>Bookings by status</h2>
          {d.byStatus.length === 0 ? <p className="muted">No bookings yet. They will appear here as travellers book.</p> : (
            <div className="stat-list">{d.byStatus.map((s) => (
              <div className="stat-line" key={s.status}><span>{statusWord[s.status] || s.status}</span><span className="occ-bar"><i style={{ width: `${(s.n / totalStatus) * 100}%`, background: s.status === 'CONFIRMED' ? '#0f8a5a' : s.status === 'CANCELLED' ? '#e6a800' : s.status === 'FAILED' ? '#c42f3a' : '#8d97b0' }} /></span><strong className="num">{s.n}</strong></div>))}</div>)}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="row-between" style={{ marginBottom: 8 }}><h2>Upcoming runs</h2><Link className="btn btn-ghost btn-sm" to="/organiser/runs">All runs</Link></div>
        <p className="hint" style={{ marginBottom: 8 }}>Occupancy counts each seat on each stretch of the route, so a seat sold for half the journey counts as half.</p>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Departs</th><th>Train</th><th>Route</th><th>Seats sold</th><th>Occupancy</th><th className="r">Net revenue</th></tr></thead>
          <tbody>{d.runs.length === 0 && <tr><td colSpan={6} className="muted">No runs scheduled. Add some from the Trains page.</td></tr>}
            {d.runs.map((r) => (
              <tr key={r.id}><td>{fmtDateTime(r.startAt)}</td><td><Link to={`/organiser/runs/${r.id}`} style={{ fontWeight: 700 }}>{r.trainName}</Link> <span className="muted">{r.trainNumber}</span></td>
                <td>{r.origin.code} to {r.destination.code}</td><td className="num">{r.seatsSold} / {r.seatCapacity}</td>
                <td><div className="occ"><span className="occ-bar"><i style={{ width: `${Math.min(100, r.occupancyPct)}%` }} /></span><span className="num">{r.occupancyPct}%</span></div></td>
                <td className="r">{r.status === 'CANCELLED' ? <span className="pill pill-bad">Cancelled</span> : rupees(r.netPaise)}</td></tr>))}</tbody>
        </table></div>
      </section>

      <section className="panel" style={{ marginTop: 20 }}>
        <h2 style={{ marginBottom: 8 }}>Latest bookings</h2>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>PNR</th><th>Train</th><th>Journey</th><th>Seats</th><th>Status</th><th className="r">Amount</th></tr></thead>
          <tbody>{d.recent.length === 0 && <tr><td colSpan={6} className="muted">Nothing booked yet.</td></tr>}
            {d.recent.map((r) => (
              <tr key={r.pnr}><td><strong>{r.pnr}</strong></td><td>{r.trainNumber}</td><td>{r.from} to {r.to}</td><td className="num">{r.seats}</td>
                <td><span className={`pill ${r.status === 'CONFIRMED' ? 'pill-ok' : 'pill-warn'}`}>{statusWord[r.status]}</span></td>
                <td className="r">{rupees(r.amountPaise)}{r.refundPaise > 0 && <div className="hint">refunded {rupees(r.refundPaise)}</div>}</td></tr>))}</tbody>
        </table></div>
      </section>
    </div>
  );
}
