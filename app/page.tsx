'use client';

import { useState } from 'react';
import { FreshnessBadge } from '@/components/FreshnessBadge';
import { SeedBadge } from '@/components/SeedBadge';
import { LevelTabs } from '@/components/LevelTabs';
import { KpiRow } from '@/components/KpiRow';
import { TrainingTable } from '@/components/TrainingTable';
import { freshness } from '@/lib/freshness';
import { bandStyle, palette, space, unitSuffix } from '@/lib/tokens';
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
      <BrandBar />
      <div className={stale ? 'board--stale' : undefined}>
        <Shell>
          <Header generatedAt={payload.meta.generated_at} isSeed={isSeed} tz={payload.meta.tz} />

          <section style={{ marginTop: space.xl }}>
            <LevelTabs levels={payload.levels} active={activeLevel.key} onSelect={setActiveKey} />
          </section>

          <section style={{ marginTop: space.xl, animation: 'lso-rise 0.5s ease both' }}>
            <KpiRow level={activeLevel} />
          </section>

          <section style={{ marginTop: space.xl, animation: 'lso-rise 0.5s ease 0.06s both' }}>
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
  background: 'transparent',
  paddingBottom: space['3xl'],
};

function BrandBar() {
  return (
    <div style={{ background: palette.navy, color: '#FFFFFF' }}>
      <div
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: `0 ${space.xl}`,
          height: '52px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            aria-hidden
            style={{
              width: '11px',
              height: '11px',
              borderRadius: '50%',
              background: '#4A90D9',
              boxShadow: '0 0 0 3px rgba(255,255,255,0.16)',
            }}
          />
          <span style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-0.01em' }}>
            luckin <span style={{ fontWeight: 400, opacity: 0.72 }}>coffee</span>
          </span>
        </div>
        <span
          style={{
            fontSize: '11px',
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.6)',
          }}
        >
          HR Operations · North America
        </span>
      </div>
    </div>
  );
}

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
            fontSize: '28px',
            fontWeight: 700,
            color: palette.navy,
            letterSpacing: '-0.02em',
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
          <span>In-training certification tracker · LKUS · reporting TZ {tz}</span>
          {isSeed && <SeedBadge />}
        </div>
      </div>
      <FreshnessBadge generatedAt={generatedAt} />
    </header>
  );
}

function Footnote({ level }: { level: Level }) {
  const u = unitSuffix(level.unit);
  const t = level.thresholds;
  const k = level.kpis;
  const metric = level.unit === 'hours' ? 'hours' : 'days (clocked-in hours ÷ 8)';
  const pct = (k.target_rate * 100).toFixed(1);

  return (
    <section
      style={{
        marginTop: space.xl,
        padding: space.lg,
        background: palette.surface,
        border: `1px solid ${palette.border}`,
        borderRadius: 12,
        color: palette.textMuted,
        fontSize: '12px',
        lineHeight: 1.65,
      }}
    >
      {/* Band legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: space.md }}>
        <LegendSwatch band="yellow" label={`≥ ${t.yellow}${u}`} />
        <LegendSwatch band="orange" label={`≥ ${t.orange}${u}`} />
        <LegendSwatch band="red" label={`≥ ${t.red}${u} · target`} />
      </div>

      <p style={{ margin: `0 0 ${space.sm} 0` }}>
        <strong style={{ color: palette.text }}>How to read the numbers.</strong>{' '}
        <strong style={{ color: palette.text }}>In training ({k.total})</strong> is this level&apos;s cohort:
        active LKUS store associates whose record shows {level.in_training_def.toLowerCase()}. Each{' '}
        <strong style={{ color: palette.text }}>“≥ X{u}”</strong> tile counts how many of those {k.total} have
        logged at least X {metric} since their hire date. The target tile{' '}
        <strong style={{ color: palette.text }}>
          “{k.ge_red} · {pct}%”
        </strong>{' '}
        means {k.ge_red} of the {k.total} have reached or passed the {t.red}{u} target — and {pct}% is that
        share ({k.ge_red} ÷ {k.total}). <strong style={{ color: palette.text }}>Average / Median</strong> are the
        mean and median {metric} across the same {k.total}-person cohort.
      </p>

      <p style={{ margin: 0 }}>
        <strong style={{ color: palette.text }}>What “target” means.</strong> {level.target}{u} is the expected
        maximum training time to earn {level.key} ({level.title}). An associate at or above it (the red band) has
        hit or exceeded the expected budget <em>without yet earning the certification</em> — i.e. overdue, not done.
        Targets by level: LSO100 112h · LSO200 45d · LSO300 60d · LSO400 90d.
        {level.has_course_col &&
          ' LSO Course is the prep class attended for this level (from the working-hour application); “pending” means no attendance record exists yet.'}
      </p>
    </section>
  );
}

function LegendSwatch({ band, label }: { band: 'yellow' | 'orange' | 'red'; label: string }) {
  const s = bandStyle[band];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 10px 3px 8px',
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        fontSize: '11px',
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
      }}
    >
      <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: s.barFill }} />
      {label}
    </span>
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
