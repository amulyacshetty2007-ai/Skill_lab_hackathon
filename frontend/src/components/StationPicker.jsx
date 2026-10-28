import { useEffect, useId, useMemo, useRef, useState } from 'react';

/** Type-ahead station field. Value is the station code; the text box shows "City (CODE)". */
export default function StationPicker({ label, value, onChange, stations, placeholder = 'Station or city' }) {
  const id = useId();
  const selected = stations.find((s) => s.code === value);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);

  useEffect(() => { setText(selected ? `${selected.city} (${selected.code})` : ''); }, [selected?.code]);   // eslint-disable-line
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q || (selected && text === `${selected.city} (${selected.code})`)) return stations;
    return stations.filter((s) => `${s.city} ${s.name} ${s.code}`.toLowerCase().includes(q));
  }, [text, stations, selected]);

  const pick = (s) => { onChange(s.code); setOpen(false); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); pick(matches[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="stub-field" ref={box}>
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" value={text} placeholder={placeholder} autoComplete="off" role="combobox"
        aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        onFocus={(e) => { setOpen(true); e.target.select(); }}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); if (value) onChange(''); }}
        onKeyDown={onKey} />
      {open && (
        <div className="suggest" id={`${id}-list`} role="listbox">
          {matches.length === 0 && <div className="hint" style={{ padding: 10 }}>No station matches</div>}
          {matches.map((s, i) => (
            <button type="button" key={s.code} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => pick(s)}>
              <span>{s.city}<span className="muted"> · {s.name}</span></span><b>{s.code}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
