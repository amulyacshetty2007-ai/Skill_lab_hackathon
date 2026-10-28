import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDate, fmtTime, isoDate } from '../util.js';

function Flap({ text, row }) {
  return (
    <span className="flap" aria-label={text}>
      {text.split('').map((c, i) => (c === ':'
        ? <span key={i} className="colon" aria-hidden="true">:</span>
        : <b key={i} style={{ '--i': i, '--row': row }} aria-hidden="true">{c}</b>))}
    </span>
  );
}

/** Live departure board: the next trains leaving, with seats still free end to end. Refreshes every 30s. */
export default function Board() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => api.get('/departures/next').then((r) => live && setRows(r.departures)).catch(() => live && setRows((x) => x ?? []));
    load();
    const t = setInterval(load, 30000);
    return () => { live = false; clearInterval(t); };
  }, []);

  return (
    <section className="board" aria-label="Next departures">
      <div className="board-title"><h2>Next departures</h2><span>Seats free end to end, live</span></div>
      {rows === null && <div className="board-empty">Loading the board…</div>}
      {rows?.length === 0 && <div className="board-empty">No departures scheduled right now.</div>}
      {rows?.map((d, i) => {
        const left = d.freeSeats;
        const cls = left === 0 ? 'none' : left <= d.totalSeats * 0.15 ? 'low' : '';
        return (
          <Link key={d.runId} className="board-row" to={`/search?from=${d.from.code}&to=${d.to.code}&date=${isoDate(new Date(d.departsAt))}`}>
            <Flap text={fmtTime(d.departsAt)} row={i} />
            <span className="board-route">{d.from.city} to {d.to.city}<small>{d.trainName} {d.trainNumber} · {fmtDate(d.departsAt)}</small></span>
            <span className={`seats-left ${cls}`}>{left === 0 ? 'Sold out' : `${left} free`}</span>
          </Link>
        );
      })}
    </section>
  );
}
