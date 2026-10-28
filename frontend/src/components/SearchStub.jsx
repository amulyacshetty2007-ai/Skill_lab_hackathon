import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { addDays, todayIST } from '../util.js';
import StationPicker from './StationPicker.jsx';
import { Swap } from './Icons.jsx';

/** The search form, drawn as a ticket stub. Used on the home page and above the results. */
export default function SearchStub({ initial = {} }) {
  const nav = useNavigate();
  const [stations, setStations] = useState([]);
  const [from, setFrom] = useState(initial.from || '');
  const [to, setTo] = useState(initial.to || '');
  const [date, setDate] = useState(initial.date || todayIST());
  const [err, setErr] = useState('');

  useEffect(() => { api.get('/stations').then((r) => setStations(r.stations)).catch(() => {}); }, []);
  useEffect(() => { setFrom(initial.from || ''); setTo(initial.to || ''); if (initial.date) setDate(initial.date); }, [initial.from, initial.to, initial.date]);

  const submit = (e) => {
    e.preventDefault();
    if (!from || !to) return setErr('Choose both stations from the list.');
    if (from === to) return setErr('Boarding and destination stations must be different.');
    setErr('');
    nav(`/search?from=${from}&to=${to}&date=${date}`);
  };

  return (
    <form className="stub" onSubmit={submit} aria-label="Search trains">
      <StationPicker label="From" value={from} onChange={setFrom} stations={stations} />
      <div className="stub-cut has-swap">
        <button type="button" className="swap-btn" aria-label="Swap stations" onClick={() => { setFrom(to); setTo(from); }}><Swap /></button>
      </div>
      <StationPicker label="To" value={to} onChange={setTo} stations={stations} />
      <div className="stub-cut" />
      <div className="stub-field">
        <label htmlFor="travel-date">Travel date</label>
        <input id="travel-date" className="input" type="date" value={date} min={todayIST()} max={addDays(todayIST(), 29)} onChange={(e) => setDate(e.target.value)} required />
      </div>
      <div className="stub-go">
        <button className="btn btn-primary" type="submit">Find trains</button>
      </div>
      {err && <div className="field-error" role="alert" style={{ gridColumn: '1 / -1', padding: '0 20px 12px' }}>{err}</div>}
    </form>
  );
}
