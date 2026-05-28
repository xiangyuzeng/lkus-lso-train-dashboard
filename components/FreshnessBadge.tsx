'use client';

import { useEffect, useState } from 'react';
import { freshness, formatAge } from '@/lib/freshness';
import { palette, radius } from '@/lib/tokens';

interface Props {
  generatedAt: string;
  staleMin?: number;
}

export function FreshnessBadge({ generatedAt, staleMin }: Props) {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const f = freshness(generatedAt, staleMin);
  const dotColor = f.isStale ? palette.gold : '#10B981';
  const generatedDate = new Date(generatedAt);
  const generatedDisplay = `${generatedDate.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

  return (
    <div
      role="status"
      aria-live="polite"
      title={`数据生成于 ${generatedDisplay}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 14px',
        background: f.isStale ? palette.goldBg : palette.surfaceAlt,
        border: `1px solid ${f.isStale ? palette.gold : palette.border}`,
        borderRadius: radius.pill,
        fontSize: '13px',
        color: f.isStale ? palette.gold : palette.textMuted,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: dotColor,
          boxShadow: f.isStale ? 'none' : `0 0 0 3px ${palette.blueSoft}`,
        }}
      />
      <span style={{ fontWeight: 500 }}>数据更新于 {formatAge(f.ageMinutes)}</span>
      {f.isStale && <span style={{ fontSize: '12px' }}>· 超 90 分钟未刷新</span>}
    </div>
  );
}
