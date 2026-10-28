import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { fmtDateTime, rupees } from '../../util.js';

export default function Runs() {
  const [scope, setScope] = useState('upcoming');
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setRuns(null); api.get(`/organiser/runs?scope=${scope}&limit=100`).then((r) => setRuns(r.runs)).catch((e) => setError(e.message)); }, [scope]);
  return (
    <div className="container page">
      <div className="page-head"><div><h1 style={{ fontSize: '2.4rem' }}>Runs</h1><p>Every scheduled departure of your trains. Open one for its passenger list or to cancel it.</p></div></div>
      <div className="tabs" role="tablist">{[['upcoming', 'Upcoming'], ['past', 'Departed']].map(([k, l]) => <button key={k} role="tab" aria-selected={scope === k} onClick={() => setScope(k)}>{l}</button>)}</div>
      {error && <div className="notice notice-bad" role="alert">{error}</div>}
      {!runs && !error && <div className="center-box"><span className="spinner" /></div>}
      {runs && (
        <section className="panel"><div className="table-wrap"><table className="table">
          <thead><tr><th>Departs</th><th>Train</th><th>Route</th><th>Seats sold</th><th>Occupancy</th><th className="r">Net revenue</th><th /></tr></thead>
          <tbody>{runs.length === 0 && <tr><td colSpan={7} className="muted">No runs here yet.</td></tr>}
            {runs.map((r) => (
              <tr key={r.id}><td>{fmtDateTime(r.startAt)}</td><td><strong>{r.trainName}</strong> <span className="muted">{r.trainNumber}</span></td><td>{r.origin.code} to {r.destination.code}</td>
                <td className="num">{r.seatsSold} / {r.seatCapacity}</td><td className="num">{r.occupancyPct}%</td>
                <td className="r">{r.status === 'CANCELLED' ? <span className="pill pill-bad">Cancelled</span> : rupees(r.netPaise)}</td>
                <td className="r"><Link className="btn btn-ghost btn-sm" to={`/organiser/runs/${r.id}`}>Open</Link></td></tr>))}</tbody>
        </table></div></section>)}
    </div>
  );
}
