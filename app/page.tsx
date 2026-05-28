'use client';

import { FreshnessBadge } from '@/components/FreshnessBadge';
import { SeedBadge } from '@/components/SeedBadge';
import { KpiRow } from '@/components/KpiRow';
import { TrainingTable } from '@/components/TrainingTable';
import { freshness } from '@/lib/freshness';
import { palette, space } from '@/lib/tokens';
import { usePayload } from '@/lib/payload';

export default function Page() {
  const { status, payload, error } = usePayload();

  if (status === 'loading' || !payload) {
    return (
      <main style={mainStyle}>
        <Shell>
          <div style={{ padding: space['2xl'], color: palette.textMuted }}>加载中…</div>
        </Shell>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main style={mainStyle}>
        <Shell>
          <div style={{ padding: space['2xl'], color: palette.danger }}>
            数据加载失败：{error ?? '未知错误'}
          </div>
        </Shell>
      </main>
    );
  }

  const stale = freshness(payload.meta.generated_at).isStale;
  const isSeed = payload.meta.source === 'seed';

  return (
    <main style={mainStyle}>
      <div className={stale ? 'board--stale' : undefined}>
        <Shell>
          <Header
            generatedAt={payload.meta.generated_at}
            isSeed={isSeed}
            tz={payload.meta.tz}
          />

          <section style={{ marginTop: space.xl }}>
            <KpiRow kpis={payload.kpis} target={payload.meta.target_hours} />
          </section>

          <section style={{ marginTop: space.xl }}>
            <TrainingTable
              rows={payload.rows}
              regions={payload.regions}
              target={payload.meta.target_hours}
              thresholds={payload.meta.thresholds}
            />
          </section>

          <Footnote />

          <SourceLine meta={payload.meta} />
        </Shell>
      </div>
    </main>
  );
}

const mainStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: palette.page,
  paddingBottom: space['3xl'],
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: `${space['2xl']} ${space.xl}`,
      }}
    >
      {children}
    </div>
  );
}

function Header({ generatedAt, isSeed, tz }: { generatedAt: string; isSeed: boolean; tz: string }) {
  return (
    <header
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: space.md,
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: '24px',
            fontWeight: 700,
            color: palette.navy,
            letterSpacing: '-0.01em',
          }}
        >
          LSO100 在训训练时长看板
        </h1>
        <div
          style={{
            marginTop: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: palette.textMuted,
            fontSize: '13px',
          }}
        >
          <span>瑞幸咖啡 · 北美 · LKUS · 报告时区 {tz}</span>
          {isSeed && <SeedBadge />}
        </div>
      </div>
      <FreshnessBadge generatedAt={generatedAt} />
    </header>
  );
}

function Footnote() {
  return (
    <p
      style={{
        marginTop: space.lg,
        color: palette.textMuted,
        fontSize: '12px',
        lineHeight: 1.6,
      }}
    >
      训练时长 = 入职日期至今在考勤系统中的实际打卡上班时长累计（小时），不含排班未打卡时间。
      阈值 72h 黄 / 96h 橘 / 112h 红（目标）。
    </p>
  );
}

function SourceLine({ meta }: { meta: { attend_source: string; cohort_def: string; generated_by: string } }) {
  return (
    <p
      style={{
        marginTop: space.sm,
        color: palette.textPlaceholder,
        fontSize: '11px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      attend_source: {meta.attend_source} · cohort_def: {meta.cohort_def} · generated_by: {meta.generated_by}
    </p>
  );
}
