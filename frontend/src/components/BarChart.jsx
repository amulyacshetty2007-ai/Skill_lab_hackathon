import { rupees } from '../util.js';

const niceMax = (v) => { if (v <= 0) return 1000; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

/** Daily sales vs refunds as grouped bars. Values are in paise; every bar has a text title for screen readers and hover. */
export default function BarChart({ data }) {
  const W = 680, H = 250, L = 54, R = 8, T = 10, B = 34;
  const max = niceMax(Math.max(...data.flatMap((d) => [d.salesPaise, d.refundsPaise]), 0));
  const iw = W - L - R, ih = H - T - B, slot = iw / data.length, bw = Math.min(16, slot / 2.6);
  const y = (v) => T + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const every = Math.ceil(data.length / 8);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily sales and refunds">
        {ticks.map((t) => (
          <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e1e6f2" /><text x={L - 8} y={y(t) + 4} textAnchor="end">{rupees(Math.round(t))}</text></g>
        ))}
        {data.map((d, i) => {
          const cx = L + slot * i + slot / 2;
          return (
            <g key={d.day}>
              <title>{`${d.day}: sales ${rupees(d.salesPaise)}, refunds ${rupees(d.refundsPaise)}, ${d.bookings} booking${d.bookings === 1 ? '' : 's'}`}</title>
              <rect x={cx - bw - 1} y={y(d.salesPaise)} width={bw} height={Math.max(0, T + ih - y(d.salesPaise))} rx="2" fill="#0e1a40" />
              <rect x={cx + 1} y={y(d.refundsPaise)} width={bw} height={Math.max(0, T + ih - y(d.refundsPaise))} rx="2" fill="#e6a800" />
              {i % every === 0 && <text x={cx} y={H - 12} textAnchor="middle">{d.day.slice(8)}/{d.day.slice(5, 7)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="row" style={{ gap: 18, marginTop: 6, fontWeight: 600, fontSize: '.88rem' }}>
        <span><i className="legend-dot" style={{ background: '#0e1a40' }} />Sales</span>
        <span><i className="legend-dot" style={{ background: '#e6a800' }} />Refunds</span>
      </div>
    </div>
  );
}
