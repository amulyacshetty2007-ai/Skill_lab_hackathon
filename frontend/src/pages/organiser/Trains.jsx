import { useCallback, useEffect, useState } from 'react';
import { api, fieldErrors } from '../../api.js';
import { useToast } from '../../toast.jsx';
import { addDays, todayIST } from '../../util.js';
import { Plus, Cross } from '../../components/Icons.jsx';

const blankStop = (first) => ({ stationCode: '', arriveOffsetMin: first ? 0 : '', departOffsetMin: first ? 0 : '', distanceKm: first ? 0 : '' });

function Schedule({ train, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ startDate: addDays(todayIST(), 1), days: 14, departTime: '08:00' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.post(`/organiser/trains/${train.id}/runs`, { startDate: f.startDate, days: Number(f.days), departTime: f.departTime }); toast(`${r.created} new run${r.created === 1 ? '' : 's'} scheduled.`, 'ok'); onDone(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={go} className="stack" style={{ marginTop: 12 }}>
      <div className="grid-3">
        <div className="field"><label htmlFor={`sd-${train.id}`}>First day</label><input id={`sd-${train.id}`} className="input" type="date" value={f.startDate} min={todayIST()} onChange={(e) => setF({ ...f, startDate: e.target.value })} required /></div>
        <div className="field"><label htmlFor={`dy-${train.id}`}>Days in a row</label><input id={`dy-${train.id}`} className="input" type="number" min={1} max={60} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} required /></div>
        <div className="field"><label htmlFor={`tm-${train.id}`}>Departure (IST)</label><input id={`tm-${train.id}`} className="input" type="time" value={f.departTime} onChange={(e) => setF({ ...f, departTime: e.target.value })} required /></div>
      </div>
      {err && <div className="notice notice-bad" role="alert">{err}</div>}
      <div><button className="btn btn-dark btn-sm" disabled={busy}>{busy ? 'Scheduling…' : 'Schedule runs'}</button></div>
    </form>
  );
}

function NewTrain({ stations, onDone, onCancel }) {
  const toast = useToast();
  const [number, setNumber] = useState(''); const [name, setName] = useState('');
  const [stops, setStops] = useState([blankStop(true), blankStop(false)]);
  const [coaches, setCoaches] = useState([{ code: 'C1', class: 'CC' }]);
  const [err, setErr] = useState(''); const [errs, setErrs] = useState({}); const [busy, setBusy] = useState(false);
  const setStop = (i, p) => setStops((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(''); setErrs({});
    try {
      await api.post('/organiser/trains', {
        number, name,
        stops: stops.map((s) => ({ stationCode: s.stationCode, arriveOffsetMin: Number(s.arriveOffsetMin), departOffsetMin: Number(s.departOffsetMin), distanceKm: Number(s.distanceKm) })),
        coaches,
      });
      toast('Train created. Schedule some runs next.', 'ok'); onDone();
    } catch (x) { if (x.code === 'VALIDATION_FAILED') { setErrs(fieldErrors(x)); setErr('Check the highlighted fields.'); } else setErr(x.message); }
    finally { setBusy(false); }
  };

  return (
    <form className="panel stack" onSubmit={submit} noValidate>
      <h2>New train</h2>
      <div className="grid-2">
        <div className="field"><label htmlFor="tn">Train number</label><input id="tn" className="input" value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} placeholder="e.g. 20611" aria-invalid={!!errs.number} />{errs.number && <span className="field-error">{errs.number}</span>}</div>
        <div className="field"><label htmlFor="tname">Train name</label><input id="tname" className="input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errs.name} />{errs.name && <span className="field-error">{errs.name}</span>}</div>
      </div>
      <div>
        <h3 style={{ marginBottom: 4 }}>Route</h3>
        <p className="hint" style={{ marginBottom: 10 }}>Times are minutes after the first departure. The first stop must be 0 min and 0 km.</p>
        <div className="stops-editor">
          {stops.map((s, i) => (
            <div className="stop-row" key={i}>
              <div className="field"><label htmlFor={`st-${i}`}>Station</label>
                <select id={`st-${i}`} className="select" value={s.stationCode} onChange={(e) => setStop(i, { stationCode: e.target.value })}><option value="">Choose…</option>{stations.map((x) => <option key={x.code} value={x.code}>{x.city} ({x.code})</option>)}</select></div>
              <div className="field"><label htmlFor={`ar-${i}`}>Arrive (min)</label><input id={`ar-${i}`} className="input" inputMode="numeric" value={s.arriveOffsetMin} disabled={i === 0} onChange={(e) => setStop(i, { arriveOffsetMin: e.target.value.replace(/\D/g, '') })} /></div>
              <div className="field"><label htmlFor={`dp-${i}`}>Depart (min)</label><input id={`dp-${i}`} className="input" inputMode="numeric" value={s.departOffsetMin} disabled={i === 0} onChange={(e) => setStop(i, { departOffsetMin: e.target.value.replace(/\D/g, '') })} /></div>
              <div className="field"><label htmlFor={`km-${i}`}>Distance (km)</label><input id={`km-${i}`} className="input" inputMode="numeric" value={s.distanceKm} disabled={i === 0} onChange={(e) => setStop(i, { distanceKm: e.target.value.replace(/\D/g, '') })} /></div>
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove stop ${i + 1}`} disabled={stops.length <= 2 || i === 0} onClick={() => setStops((l) => l.filter((_, j) => j !== i))}><Cross width={16} height={16} /></button>
            </div>))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} disabled={stops.length >= 15} onClick={() => setStops((l) => [...l, blankStop(false)])}><Plus width={16} height={16} /> Add stop</button>
      </div>
      <div>
        <h3 style={{ marginBottom: 4 }}>Coaches</h3>
        <p className="hint" style={{ marginBottom: 10 }}>Chair Car has 40 seats (2+3). Executive Chair has 20 seats (2+2).</p>
        <div className="stops-editor">
          {coaches.map((c, i) => (
            <div className="row" key={i} style={{ alignItems: 'end' }}>
              <div className="field"><label htmlFor={`cc-${i}`}>Coach code</label><input id={`cc-${i}`} className="input" value={c.code} maxLength={3} onChange={(e) => setCoaches((l) => l.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)))} /></div>
              <div className="field"><label htmlFor={`cl-${i}`}>Class</label><select id={`cl-${i}`} className="select" value={c.class} onChange={(e) => setCoaches((l) => l.map((x, j) => (j === i ? { ...x, class: e.target.value } : x)))}><option value="CC">Chair Car</option><option value="EC">Executive Chair</option></select></div>
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove coach ${c.code}`} disabled={coaches.length <= 1} onClick={() => setCoaches((l) => l.filter((_, j) => j !== i))}><Cross width={16} height={16} /></button>
            </div>))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} disabled={coaches.length >= 16} onClick={() => setCoaches((l) => [...l, { code: `C${l.length + 1}`, class: 'CC' }])}><Plus width={16} height={16} /> Add coach</button>
      </div>
      {err && <div className="notice notice-bad" role="alert">{err}</div>}
      <div className="row"><button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create train'}</button><button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export default function Trains() {
  const [trains, setTrains] = useState(null);
  const [stations, setStations] = useState([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.get('/organiser/trains').then((r) => setTrains(r.trains)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); api.get('/stations').then((r) => setStations(r.stations)).catch(() => {}); }, [load]);

  return (
    <div className="container page">
      <div className="page-head"><div><h1 style={{ fontSize: '2.4rem' }}>Trains</h1><p>Your trains, their routes and coaches. Add runs to put them on sale.</p></div>
        {!adding && <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus width={18} height={18} /> New train</button>}</div>
      {error && <div className="notice notice-bad" role="alert">{error}</div>}
      {adding && <NewTrain stations={stations} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
      {!trains && !error && <div className="center-box"><span className="spinner" /></div>}
      <div className="stack" style={{ marginTop: adding ? 20 : 0 }}>
        {trains?.map((t) => (
          <article className="panel" key={t.id}>
            <div className="row-between"><h2>{t.name} <span className="tc-num" style={{ verticalAlign: 'middle' }}>{t.number}</span></h2>
              <span className="muted">{t.seats} seats · {t.coaches.length} coaches · {t.upcomingRuns} upcoming runs</span></div>
            <div className="route-chips" style={{ marginTop: 10 }}>{t.stops.map((s, i) => <span key={s.code} style={{ display: 'contents' }}>{i > 0 && <i>›</i>}<span>{s.code}</span></span>)}</div>
            <div style={{ marginTop: 12 }}><button className="btn btn-ghost btn-sm" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? 'Hide scheduling' : 'Schedule runs'}</button></div>
            {open === t.id && <Schedule train={t} onDone={() => { setOpen(null); load(); }} />}
          </article>))}
        {trains?.length === 0 && !adding && <div className="empty panel"><h3>No trains yet</h3><p>Create your first train, then schedule runs for it.</p></div>}
      </div>
    </div>
  );
}
