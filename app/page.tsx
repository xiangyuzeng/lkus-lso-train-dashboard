'use client';

import { useState } from 'react';
import { FreshnessBadge } from '@/components/FreshnessBadge';
import { SeedBadge } from '@/components/SeedBadge';
import { LevelTabs } from '@/components/LevelTabs';
import { KpiRow } from '@/components/KpiRow';
import { TrainingTable } from '@/components/TrainingTable';
import { freshness } from '@/lib/freshness';
import { palette, space, unitSuffix } from '@/lib/tokens';
import { usePayload } from '@/lib/payload';
import type { Level, LevelKey, PayloadMeta } from '@/lib/types';

export default function Page() {
  const { status, payload, error } = usePayload();
  const [activeKey, setActiveKey] = useState<LevelKey>('LSO100');

  if (status === 'loading' || !payload) {
    return (
      <main style={mainStyle}>
        <Shell>
          <div style={{ padding: space['2xl'], color: palette.textMuted }}>Loading…</div>
        </Shell>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main style={mainStyle}>
        <Shell>
          <div style={{ padding: space['2xl'], color: palette.danger }}>
            Failed to load data: {error ?? 'unknown error'}
          </div>
        </Shell>
      </main>
    );
  }

  const stale = freshness(payload.meta.generated_at).isStale;
  const isSeed = payload.meta.source === 'seed';
  const activeLevel = payload.levels.find((l) => l.key === activeKey) ?? payload.levels[0];

  if (!activeLevel) {
    return (
      <main style={mainStyle}>
        <Shell>
          <div style={{ padding: space['2xl'], color: palette.danger }}>No levels in payload.</div>
        </Shell>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <div className={stale ? 'board--stale' : undefined}>
        <Shell>
          <Header generatedAt={payload.meta.generated_at} isSeed={isSeed} tz={payload.meta.tz} />

          <section style={{ marginTop: space.xl }}>
            <LevelTabs levels={payload.levels} active={activeLevel.key} onSelect={setActiveKey} />
          </section>

          <section style={{ marginTop: space.xl }}>
            <KpiRow level={activeLevel} />
          </section>

          <section style={{ marginTop: space.xl }}>
            <TrainingTable level={activeLevel} regions={payload.meta.regions} />
          </section>

          <Footnote level={activeLevel} />

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
          LSO Training Progress
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
          <span>Luckin Coffee · North America · LKUS · reporting TZ {tz}</span>
          {isSeed && <SeedBadge />}
        </div>
      </div>
      <FreshnessBadge generatedAt={generatedAt} />
    </header>
  );
}

function Footnote({ level }: { level: Level }) {
  const u = unitSuffix(level.unit);
  const metric = level.unit === 'hours' ? 'hours' : 'days (hours ÷ 8)';
  return (
    <p
      style={{
        marginTop: space.lg,
        color: palette.textMuted,
        fontSize: '12px',
        lineHeight: 1.6,
      }}
    >
      Training time = cumulative actual clocked-in work {metric} from hire date to today (settled attendance,
      excludes scheduled-but-unclocked time). {level.key} in-training = {level.in_training_def}. Heat bands:{' '}
      ≥ {level.thresholds.yellow}{u} amber · ≥ {level.thresholds.orange}{u} orange · ≥ {level.thresholds.red}{u} red
      (target {level.target}{u}).
      {level.has_course_col &&
        ' LSO Course = the training class attended for this level (from the working-hour application); shown as "pending" when no record exists.'}
    </p>
  );
}

function SourceLine({ meta }: { meta: PayloadMeta }) {
  return (
    <p
      style={{
        marginTop: space.sm,
        color: palette.textPlaceholder,
        fontSize: '11px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      base: {meta.base_def} · stores: {meta.store_count} · cert: {meta.cert_source} · attendance: {meta.attend_source}{' '}
      · course: {meta.course_source} · generated_by: {meta.generated_by}
    </p>
  );
}
