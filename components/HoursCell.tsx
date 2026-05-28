import type { Band } from '@/lib/types';
import { bandStyle, palette, radius } from '@/lib/tokens';

interface Props {
  hours: number;
  band: Band;
  target: number;
}

export function HoursCell({ hours, band, target }: Props) {
  const style = bandStyle[band];
  const pct = Math.min(100, (hours / target) * 100);

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
        <span style={{ fontWeight: 600, fontSize: '14px' }}>{hours.toFixed(1)} h</span>
        <span style={{ fontSize: '11px', color: palette.textMuted }}>/ {target}</span>
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
