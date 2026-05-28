import { palette, radius } from '@/lib/tokens';

export function SeedBadge() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        background: palette.goldBg,
        color: palette.gold,
        border: `1px solid ${palette.gold}`,
        borderRadius: radius.pill,
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
    >
      种子数据 (SEED) · 尚未接入真实打卡
    </span>
  );
}
