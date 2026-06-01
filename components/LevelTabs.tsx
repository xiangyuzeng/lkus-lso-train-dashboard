'use client';

import type { Level, LevelKey } from '@/lib/types';
import { palette, radius } from '@/lib/tokens';

interface Props {
  levels: Level[];
  active: LevelKey;
  onSelect: (key: LevelKey) => void;
}

export function LevelTabs({ levels, active, onSelect }: Props) {
  return (
    <div
      role="tablist"
      aria-label="LSO level"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        borderBottom: `1px solid ${palette.border}`,
        paddingBottom: '2px',
      }}
    >
      {levels.map((lvl) => {
        const isActive = lvl.key === active;
        return (
          <button
            key={lvl.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(lvl.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 16px',
              borderRadius: `${radius.md} ${radius.md} 0 0`,
              background: isActive ? palette.navy : palette.surface,
              color: isActive ? '#FFFFFF' : palette.text,
              border: `1px solid ${isActive ? palette.navy : palette.border}`,
              borderBottom: isActive ? `1px solid ${palette.navy}` : `1px solid ${palette.border}`,
              fontSize: '13px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            <span>{lvl.key}</span>
            <span style={{ fontWeight: 500, opacity: isActive ? 0.85 : 0.7 }}>· {lvl.title}</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '22px',
                height: '20px',
                padding: '0 6px',
                borderRadius: radius.pill,
                background: isActive ? 'rgba(255,255,255,0.18)' : palette.gray100,
                color: isActive ? '#FFFFFF' : palette.textMuted,
                fontSize: '12px',
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {lvl.kpis.total}
            </span>
          </button>
        );
      })}
    </div>
  );
}
