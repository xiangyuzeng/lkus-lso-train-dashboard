import type { Level } from '@/lib/types';
import { unitSuffix } from '@/lib/tokens';
import { KpiCard } from './KpiCard';

interface Props {
  level: Level;
}

export function KpiRow({ level }: Props) {
  const { kpis, thresholds, unit } = level;
  const u = unitSuffix(unit);
  const pct = (kpis.target_rate * 100).toFixed(1);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '12px',
      }}
    >
      <KpiCard title="In training" value={kpis.total} accent="neutral" suffix="associates" />
      <KpiCard title={`≥ ${thresholds.yellow}${u}`} value={kpis.ge_yellow} accent="yellow" suffix="associates" />
      <KpiCard title={`≥ ${thresholds.orange}${u}`} value={kpis.ge_orange} accent="orange" suffix="associates" />
      <KpiCard
        title={`≥ ${thresholds.red}${u} (target)`}
        value={kpis.ge_red}
        accent="red"
        suffix={`associates · ${pct}% met`}
      />
      <KpiCard title="Average" value={kpis.avg.toFixed(1)} accent="neutral" suffix={u} />
      <KpiCard title="Median" value={kpis.median.toFixed(1)} accent="neutral" suffix={u} />
    </div>
  );
}
