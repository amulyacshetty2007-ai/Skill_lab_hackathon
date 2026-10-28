import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { api, fieldErrors } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import SeatMap from '../components/SeatMap.jsx';
import { fmtDateTime, fmtTime, rupees } from '../util.js';
import { Cross } from '../components/Icons.jsx';

export default function Book() {
  const { runId } = useParams();
  const [sp] = useSearchParams();
  const from = sp.get('from'), to = sp.get('to');
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();

  const [map, setMap] = useState(null);
  const [error, setError] = useState('');
  const [coachCode, setCoachCode] = useState(null);
  const [sel, setSel] = useState(new Map());          // seatId -> { seat, coach, name, age, gender }
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [holdLimit, setHoldLimit] = useState(false);
  const selRef = useRef(sel); selRef.current = sel;

  const load = useCallback(async (quiet) => {
    try {
      const r = await api.get(`/runs/${runId}/seats?from=${from}&to=${to}`);
      setMap(r); setError('');
      setCoachCode((c) => c || r.coaches[0]?.code);
      // seats somebody else grabbed while we were looking: drop them and say so
      const state = new Map(r.coaches.flatMap((c) => c.seats.map((s) => [s.id, s.state])));
      const lost = [...selRef.current.keys()].filter((id) => state.get(id) !== 'AVAILABLE');
      if (lost.length) {
        setSel((m) => { const n = new Map(m); lost.forEach((id) => n.delete(id)); return n; });
        toast(`${lost.length === 1 ? 'A seat you picked was' : 'Seats you picked were'} just taken and removed from your selection.`, 'bad');
      }
    } catch (e) { if (!quiet) setError(e.message); }
  }, [runId, from, to, toast]);

  useEffect(() => { load(false); }, [load, user?.id]);
  useEffect(() => {   // keep the map fresh while the tab is visible
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 8000);
    return () => clearInterval(t);
  }, [load]);

  const coach = map?.coaches.find((c) => c.code === coachCode);
  const max = map?.maxPassengers ?? 6;
  const total = useMemo(() => [...sel.values()].reduce((a, x) => a + x.coach.farePaise, 0), [sel]);

  const toggle = (seat, c) => setSel((m) => {
    const n = new Map(m);
    if (n.has(seat.id)) n.delete(seat.id);
    else if (n.size < max) n.set(seat.id, { seat, coach: c, name: '', age: '', gender: 'M' });
    return n;
  });
  const patch = (id, p) => setSel((m) => { const n = new Map(m); n.set(id, { ...n.get(id), ...p }); return n; });

  const submit = async (e) => {
    e.preventDefault();
    setFormErr(''); setHoldLimit(false);
    if (!user) return nav(`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`);
    for (const x of sel.values()) {
      if (x.name.trim().length < 2) return setFormErr(`Enter the passenger name for seat ${x.seat.no}.`);
      const age = Number(x.age);
      if (!Number.isInteger(age) || age < 1 || age > 120) return setFormErr(`Enter a valid age (1 to 120) for seat ${x.seat.no}.`);
    }
    setBusy(true);
    try {
      const r = await api.post('/bookings/hold', {
        runId, from, to,
        passengers: [...sel.values()].map((x) => ({ seatId: x.seat.id, name: x.name.trim(), age: Number(x.age), gender: x.gender })),
      });
      nav(`/checkout/${r.booking.id}`);
    } catch (err) {
      if (err.code === 'SEAT_UNAVAILABLE') { toast(err.message, 'bad'); load(true); }
      else if (err.code === 'TOO_MANY_HOLDS') setHoldLimit(true);
      else if (err.code === 'VALIDATION_FAILED') setFormErr(Object.values(fieldErrors(err)).join('. ') || err.message);
      else setFormErr(err.message);
    } finally { setBusy(false); }
  };

  if (error) return <div className="container page"><div className="notice notice-bad" role="alert">{error}</div></div>;
  if (!map) return <div className="center-box"><span className="spinner" /></div>;

  return (
    <div className="container page">
      <div className="journey-bar">
        <div><div className="tc-time">{fmtTime(map.departsAt)}</div><div className="tc-st">{map.from.name}</div></div>
        <div className="tc-st" style={{ color: '#aab6e6' }}>{map.distanceKm} km</div>
        <div><div className="tc-time">{fmtTime(map.arrivesAt)}</div><div className="tc-st">{map.to.name}</div></div>
        <div className="grow" />
        <div style={{ textAlign: 'right' }}><strong>{map.trainName} · {map.trainNumber}</strong><div className="tc-st">{fmtDateTime(map.departsAt)}</div></div>
      </div>

      <div className="book-layout" style={{ marginTop: 22 }}>
        <section aria-label="Seat map">
          <div className="coach-tabs" role="tablist" aria-label="Coaches">
            {map.coaches.map((c) => {
              const free = c.seats.filter((s) => s.state === 'AVAILABLE').length;
              const chosen = [...sel.values()].filter((x) => x.coach.code === c.code).length;
              return (
                <button key={c.code} role="tab" aria-selected={c.code === coachCode} className="coach-tab" onClick={() => setCoachCode(c.code)}>
                  Coach {c.code}{chosen > 0 && ` (${chosen})`}<small>{c.className} · {rupees(c.farePaise)} · {free} free</small>
                </button>
              );
            })}
          </div>
          <div className="carriage-wrap">{coach && <SeatMap coach={coach} selected={new Set(sel.keys())} onToggle={toggle} maxReached={sel.size >= max} />}</div>
          <div className="legend" aria-label="Seat legend">
            <span><i className="seat s-available" /> Available</span>
            <span><i className="seat s-selected" /> Your pick</span>
            <span><i className="seat s-held" /> Held while someone pays</span>
            <span><i className="seat s-booked" /> Booked</span>
            {user && <span><i className="seat s-mine" /> Held for you</span>}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>Availability is for {map.from.name} to {map.to.name} only. A seat booked for another part of the route can still be free for yours. The map refreshes every few seconds.</p>
        </section>

        <aside className="side-panel">
          <form className="panel stack" onSubmit={submit} noValidate>
            <h2>Passengers</h2>
            {sel.size === 0 && <p className="muted">Pick up to {max} seats on the map. Then add a name and age for each traveller.</p>}
            {[...sel.values()].map((x) => (
              <fieldset key={x.seat.id} className="pax" style={{ margin: 0, minInlineSize: 0 }}>
                <legend className="sr-only">Passenger for seat {x.seat.no}</legend>
                <div className="pax-head"><span><span className="pax-seat">{x.coach.code}-{x.seat.no}</span> <span className="muted" style={{ fontWeight: 600 }}>{rupees(x.coach.farePaise)}</span></span>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove seat ${x.seat.no}`} onClick={() => toggle(x.seat, x.coach)}><Cross width={16} height={16} /></button></div>
                <div className="field"><label htmlFor={`n-${x.seat.id}`}>Full name</label>
                  <input id={`n-${x.seat.id}`} className="input" value={x.name} maxLength={60} autoComplete="name" onChange={(e) => patch(x.seat.id, { name: e.target.value })} /></div>
                <div className="grid-2">
                  <div className="field"><label htmlFor={`a-${x.seat.id}`}>Age</label>
                    <input id={`a-${x.seat.id}`} className="input" inputMode="numeric" value={x.age} maxLength={3} onChange={(e) => patch(x.seat.id, { age: e.target.value.replace(/\D/g, '') })} /></div>
                  <div className="field"><label htmlFor={`g-${x.seat.id}`}>Gender</label>
                    <select id={`g-${x.seat.id}`} className="select" value={x.gender} onChange={(e) => patch(x.seat.id, { gender: e.target.value })}>
                      <option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></div>
                </div>
              </fieldset>
            ))}
            {sel.size > 0 && (
              <div className="totals">
                <div className="summary-line"><span className="muted">{sel.size} seat{sel.size > 1 ? 's' : ''}, fares include reservation fee</span></div>
                <div className="summary-line"><span>Total</span><span className="big num">{rupees(total)}</span></div>
              </div>
            )}
            {formErr && <div className="notice notice-bad" role="alert">{formErr}</div>}
            {holdLimit && <div className="notice notice-warn" role="alert">You already have bookings waiting for payment. <Link to="/bookings">Finish or release them</Link> first.</div>}
            {user?.role === 'ORGANISER'
              ? <div className="notice notice-warn">Organiser accounts can't book tickets. Sign in as a traveller to book.</div>
              : <button className="btn btn-primary btn-block" disabled={busy || sel.size === 0}>{busy ? 'Holding your seats…' : user ? 'Hold seats and pay' : 'Sign in to continue'}</button>}
            <p className="hint">Your seats are held for {Math.round((map.holdSeconds || 300) / 60)} minutes once you continue.</p>
          </form>
        </aside>
      </div>
    </div>
  );
}
