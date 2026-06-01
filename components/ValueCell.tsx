import type { Band, Unit } from '@/lib/types';
import { bandStyle, palette, radius, unitSuffix } from '@/lib/tokens';

interface Props {
  value: number;
  band: Band;
  target: number;
  unit: Unit;
}

// Unit-aware training cell: hours for LSO100, days for LSO200/300/400.
// Progress bar fills value/target, capped at 100%, coloured by heat band.
export function ValueCell({ value, band, target, unit }: Props) {
  const style = bandStyle[band];
  const pct = Math.min(100, (value / target) * 100);
  const suffix = unitSuffix(unit);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '6px 10px',
        background: style.bg,
        borderRadius: radius.sm,
        color: style.fg,
        minWidth: '160px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 600, fontSize: '14px', fontFamily: 'var(--font-mono)' }}>
          {value.toFixed(1)} {suffix}
        </span>
        <span style={{ fontSize: '11px', color: palette.textMuted }}>
          / {target} {suffix}
        </span>
      </div>
      <div
        aria-hidden
        style={{
          position: 'relative',
          height: '6px',
          background: palette.surfaceAlt,
          borderRadius: '999px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${pct}%`,
            background: style.barFill,
            borderRadius: '999px',
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}
