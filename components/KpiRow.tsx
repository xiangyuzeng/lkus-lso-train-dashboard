import type { PayloadKpis } from '@/lib/types';
import { KpiCard } from './KpiCard';

interface Props {
  kpis: PayloadKpis;
  target: number;
}

export function KpiRow({ kpis, target }: Props) {
  const pct = (kpis.target_rate * 100).toFixed(1);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '12px',
      }}
    >
      <KpiCard title="在训小伙伴总数" value={kpis.total} accent="neutral" suffix="人" />
      <KpiCard title="已达 72h" value={kpis.ge72} accent="yellow" suffix="人" />
      <KpiCard title="已达 96h" value={kpis.ge96} accent="orange" suffix="人" />
      <KpiCard
        title={`已达 ${target}h 目标`}
        value={kpis.ge112}
        accent="red"
        suffix={`人 · 达成率 ${pct}%`}
      />
      <KpiCard title="平均训练时长" value={kpis.avg.toFixed(1)} accent="neutral" suffix="h" />
      <KpiCard title="中位训练时长" value={kpis.median.toFixed(1)} accent="neutral" suffix="h" />
    </div>
  );
}
