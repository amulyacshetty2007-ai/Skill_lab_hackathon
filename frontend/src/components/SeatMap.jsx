import { cx } from '../util.js';

const label = { AVAILABLE: 'available', SELECTED: 'selected', BOOKED: 'already booked', HELD: 'held by someone paying', MINE: 'yours' };

/** One carriage drawn from above: rows run down the page, an aisle splits the columns. */
export default function SeatMap({ coach, selected, onToggle, maxReached }) {
  const byRow = new Map();
  coach.seats.forEach((s) => { if (!byRow.has(s.row)) byRow.set(s.row, []); byRow.get(s.row).push(s); });
  return (
    <div className="carriage">
      <div className="carriage-title">Coach {coach.code} · {coach.className}</div>
      <div className="seat-grid" role="group" aria-label={`Seats in coach ${coach.code}`}>
        {[...byRow.entries()].map(([row, seats]) => (
          <div className="seat-row" key={row}>
            <span className="row-no" aria-hidden="true">{row}</span>
            {seats.map((s) => {
              const isSel = selected.has(s.id);
              const st = isSel ? 'SELECTED' : s.state;
              const disabled = st === 'BOOKED' || st === 'HELD' || st === 'MINE' || (!isSel && st === 'AVAILABLE' && maxReached);
              return (
                <span key={s.id} style={{ display: 'contents' }}>
                  {s.col === coach.aisleAfter && <span className="aisle" aria-hidden="true" />}
                  <button type="button" className={cx('seat', `s-${st.toLowerCase()}`)} disabled={disabled} aria-pressed={isSel}
                    aria-label={`Seat ${s.no}, ${label[st]}`} onClick={() => onToggle(s, coach)}>
                    {s.no.replace(/^\d+/, '')}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
