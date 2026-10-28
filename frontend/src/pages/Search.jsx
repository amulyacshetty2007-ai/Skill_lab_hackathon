import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import SearchStub from '../components/SearchStub.jsx';
import { addDays, fmtDate, fmtDateLong, fmtDuration, fmtTime, rupees, todayIST } from '../util.js';

export default function Search() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const from = sp.get('from') || '', to = sp.get('to') || '', date = sp.get('date') || todayIST();
  const [state, setState] = useState({ loading: true, results: [], error: '' });

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    api.get(`/trains/search?from=${from}&to=${to}&date=${date}`)
      .then((r) => live && setState({ loading: false, results: r.results, error: '' }))
      .catch((e) => live && setState({ loading: false, results: [], error: e.message }));
    return () => { live = false; };
  }, [from, to, date]);

  const days = Array.from({ length: 10 }, (_, i) => addDays(todayIST(), i));
  const go = (d) => nav(`/search?from=${from}&to=${to}&date=${d}`);

  return (
    <>
      <div className="search-bar"><div className="container"><SearchStub initial={{ from, to, date }} /></div></div>
      <div className="container page">
        <div className="date-strip" role="tablist" aria-label="Travel date">
          {days.map((d) => (
            <button key={d} role="tab" aria-current={d === date} onClick={() => go(d)}>
              {fmtDate(d + 'T06:00:00Z').split(',')[0]}<small>{fmtDate(d + 'T06:00:00Z').split(',')[1]?.trim() || ''}</small>
            </button>
          ))}
        </div>
        <div className="page-head">
          <div><h2>{state.loading ? 'Searching…' : `${state.results.length} train${state.results.length === 1 ? '' : 's'} on ${fmtDateLong(date + 'T06:00:00Z')}`}</h2></div>
        </div>

        {state.error && <div className="notice notice-bad" role="alert">{state.error}</div>}
        {state.loading && <div className="center-box"><span className="spinner" /></div>}
        {!state.loading && !state.error && state.results.length === 0 && (
          <div className="empty">
            <h3>No trains on this date</h3>
            <p>Try another day from the strip above, or swap the stations. Bookings close 30 minutes before departure.</p>
          </div>
        )}
        {state.results.map((t) => (
          <article className="train-card" key={t.runId}>
            <div>
              <div className="tc-head"><h3>{t.trainName}</h3><span className="tc-num">{t.trainNumber}</span></div>
              <div className="tc-times">
                <div><div className="tc-time">{fmtTime(t.departsAt)}</div><div className="tc-st">{t.from.name}</div></div>
                <div className="tc-line"><span>{fmtDuration(t.durationMin)}</span><i /><span>{t.distanceKm} km</span></div>
                <div style={{ textAlign: 'right' }}><div className="tc-time">{fmtTime(t.arrivesAt)}</div><div className="tc-st">{t.to.name}</div></div>
              </div>
            </div>
            <div className="tc-classes">
              {t.classes.map((c) => {
                const pct = c.total ? (c.available / c.total) * 100 : 0;
                const tone = c.available === 0 ? 'none' : pct <= 15 ? 'low' : '';
                return (
                  <div className="class-row" key={c.code}>
                    <div><strong>{c.name}</strong><br /><small className={tone === 'none' ? 'muted' : ''}>{c.available === 0 ? 'Sold out' : `${c.available} of ${c.total} seats free`}</small></div>
                    <div className="fare">{rupees(c.farePaise)}</div>
                    <div className={`avail ${tone}`} aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
              <Link className="btn btn-dark" to={`/book/${t.runId}?from=${t.from.code}&to=${t.to.code}`}>Choose seats</Link>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
