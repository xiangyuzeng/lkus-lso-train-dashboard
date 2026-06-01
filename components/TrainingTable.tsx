'use client';

import { useMemo, useState } from 'react';
import type { Level, PayloadRow } from '@/lib/types';
import { palette, radius, shadow, unitSuffix } from '@/lib/tokens';
import { ValueCell } from './ValueCell';

interface Props {
  level: Level;
  regions: string[];
}

type SortKey =
  | 'full_name'
  | 'employee_no'
  | 'store'
  | 'region'
  | 'position'
  | 'hire_date'
  | 'value'
  | 'lso_course';
type SortDir = 'asc' | 'desc';
type BandFilter = 'all' | 'ge_y' | 'ge_o' | 'ge_r';

function bandMatches(filter: BandFilter, row: PayloadRow, t: Level['thresholds']): boolean {
  switch (filter) {
    case 'all':  return true;
    case 'ge_y': return row.value >= t.yellow;
    case 'ge_o': return row.value >= t.orange;
    case 'ge_r': return row.value >= t.red;
  }
}

function compare(a: PayloadRow, b: PayloadRow, key: SortKey, dir: SortDir): number {
  const va = a[key];
  const vb = b[key];
  let cmp = 0;
  if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
  else cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'en');
  return dir === 'asc' ? cmp : -cmp;
}

export function TrainingTable({ level, regions }: Props) {
  const { rows, unit, target, thresholds, has_course_col } = level;
  const u = unitSuffix(unit);

  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState<BandFilter>('all');
  const [positionFilter, setPositionFilter] = useState<string>('all');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Band dropdown — per the level's own thresholds; "≥ X" shows rows at or above.
  const bandLabel = unit === 'hours' ? 'Training hours' : 'Training days';
  const bandOptions: { key: BandFilter; label: string }[] = [
    { key: 'all',  label: 'In training (all)' },
    { key: 'ge_y', label: `≥ ${thresholds.yellow}${u}` },
    { key: 'ge_o', label: `≥ ${thresholds.orange}${u}` },
    { key: 'ge_r', label: `≥ ${thresholds.red}${u} (target)` },
  ];

  // Position dropdown — drawn from the positions actually present in this level's
  // (already cert- + position-filtered) rows.
  const positions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.position).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'en')),
    [rows],
  );

  const hasRegions = regions.some((r) => r && r !== '—');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = rows.filter((r) => {
      if (!bandMatches(bandFilter, r, thresholds)) return false;
      if (positionFilter !== 'all' && r.position !== positionFilter) return false;
      if (hasRegions && regionFilter !== 'all' && r.region !== regionFilter) return false;
      if (q) {
        const hay =
          `${r.full_name} ${r.employee_no} ${r.store} ${r.region} ${r.position} ${r.lso_course ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    result.sort((a, b) => compare(a, b, sortKey, sortDir));
    return result;
  }, [rows, search, bandFilter, positionFilter, regionFilter, sortKey, sortDir, thresholds, hasRegions]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'value' ? 'desc' : 'asc');
    }
  };

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const valueHeader = unit === 'hours' ? 'Training Hours' : 'Training Days';
  const colCount = 8 + (has_course_col ? 1 : 0);

  return (
    <div
      style={{
        background: palette.surface,
        border: `1px solid ${palette.border}`,
        borderRadius: radius.lg,
        boxShadow: shadow.sm,
        overflow: 'hidden',
      }}
    >
      {/* Controls */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: '14px',
          padding: '14px 18px',
          borderBottom: `1px solid ${palette.border}`,
          background: palette.surfaceAlt,
        }}
      >
        <Field label="Search" grow>
          <input
            type="search"
            placeholder="Name / ID / store / position / course"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              minWidth: '200px',
              padding: '8px 12px',
              border: `1px solid ${palette.border}`,
              borderRadius: radius.md,
              background: palette.surface,
              color: palette.text,
              fontSize: '13px',
            }}
          />
        </Field>

        <Field label={bandLabel}>
          <Select value={bandFilter} onChange={(v) => setBandFilter(v as BandFilter)}>
            {bandOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Position">
          <Select value={positionFilter} onChange={setPositionFilter}>
            <option value="all">All positions</option>
            {positions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>

        {hasRegions && (
          <Field label="Region">
            <Select value={regionFilter} onChange={setRegionFilter}>
              <option value="all">All regions</option>
              {regions
                .filter((r) => r && r !== '—')
                .map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
            </Select>
          </Field>
        )}

        <span
          style={{
            marginLeft: 'auto',
            color: palette.textMuted,
            fontSize: '13px',
            whiteSpace: 'nowrap',
            paddingBottom: '8px',
          }}
        >
          <strong style={{ color: palette.text }}>{filtered.length}</strong> / {rows.length} shown
        </span>
      </div>

      {/* Table */}
      <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontSize: '13px',
          }}
        >
          <thead>
            <tr>
              <Th sticky firstColumn onClick={() => onSort('full_name')}>
                Name{sortIndicator('full_name')}
              </Th>
              <Th sticky onClick={() => onSort('employee_no')}>
                Employee ID{sortIndicator('employee_no')}
              </Th>
              <Th sticky onClick={() => onSort('store')}>
                Store{sortIndicator('store')}
              </Th>
              <Th sticky onClick={() => onSort('region')}>
                Region{sortIndicator('region')}
              </Th>
              <Th sticky onClick={() => onSort('position')}>
                Position{sortIndicator('position')}
              </Th>
              <Th sticky onClick={() => onSort('hire_date')}>
                Hire Date{sortIndicator('hire_date')}
              </Th>
              <Th sticky onClick={() => onSort('value')} align="right">
                {valueHeader}{sortIndicator('value')}
              </Th>
              {has_course_col && (
                <Th sticky onClick={() => onSort('lso_course')}>
                  LSO Course{sortIndicator('lso_course')}
                </Th>
              )}
              <Th sticky>Status</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <Tr key={r.employee_no} row={r} target={target} unit={unit} showCourse={has_course_col} />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={colCount}
                  style={{
                    padding: '40px 16px',
                    textAlign: 'center',
                    color: palette.textMuted,
                  }}
                >
                  No rows match the current filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────

function Field({ label, children, grow }: { label: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: grow ? '1 1 240px' : '0 0 auto' }}>
      <span
        style={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: palette.textMuted,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '8px 30px 8px 12px',
        border: `1px solid ${palette.border}`,
        borderRadius: radius.md,
        background: palette.surface,
        color: palette.text,
        fontSize: '13px',
        cursor: 'pointer',
        appearance: 'none',
        backgroundImage:
          `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2.5'><path d='M6 9l6 6 6-6'/></svg>")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 10px center',
        minWidth: '150px',
      }}
    >
      {children}
    </select>
  );
}

function Th({
  children,
  sticky,
  firstColumn,
  onClick,
  align,
}: {
  children: React.ReactNode;
  sticky?: boolean;
  firstColumn?: boolean;
  onClick?: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <th
      onClick={onClick}
      style={{
        position: sticky ? 'sticky' : undefined,
        top: 0,
        left: firstColumn ? 0 : undefined,
        zIndex: firstColumn ? 3 : sticky ? 2 : undefined,
        background: '#EEF2FB',
        borderBottom: `2px solid ${palette.borderStrong}`,
        padding: '11px 14px',
        textAlign: align ?? 'left',
        color: palette.navy,
        fontWeight: 600,
        fontSize: '11px',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}

function Tr({
  row,
  target,
  unit,
  showCourse,
}: {
  row: PayloadRow;
  target: number;
  unit: Level['unit'];
  showCourse: boolean;
}) {
  return (
    <tr>
      <Td firstColumn>
        <span style={{ fontWeight: 500 }}>{row.full_name}</span>
      </Td>
      <Td>
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{row.employee_no}</code>
      </Td>
      <Td>{row.store}</Td>
      <Td>
        <span style={{ color: row.region === '—' ? palette.textMuted : palette.text }}>{row.region}</span>
      </Td>
      <Td>{row.position}</Td>
      <Td>
        <span style={{ color: palette.textMuted, fontFamily: 'var(--font-mono)' }}>{row.hire_date}</span>
      </Td>
      <Td align="right">
        <ValueCell value={row.value} band={row.band} target={target} unit={unit} />
      </Td>
      {showCourse && (
        <Td>
          <CourseCell course={row.lso_course} date={row.lso_course_date} />
        </Td>
      )}
      <Td>
        <StatusChip status={row.status} />
      </Td>
    </tr>
  );
}

function Td({
  children,
  align,
  firstColumn,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  firstColumn?: boolean;
}) {
  return (
    <td
      style={{
        position: firstColumn ? 'sticky' : undefined,
        left: firstColumn ? 0 : undefined,
        zIndex: firstColumn ? 1 : undefined,
        background: firstColumn ? palette.surface : 'transparent',
        padding: '10px 14px',
        borderBottom: `1px solid ${palette.gray100}`,
        textAlign: align ?? 'left',
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </td>
  );
}

function CourseCell({ course, date }: { course: string | null; date: string | null }) {
  const pending = !course || course === 'pending';
  if (pending) {
    return <span style={{ color: palette.textPlaceholder, fontStyle: 'italic' }}>pending</span>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
      <span>{course}</span>
      {date && <span style={{ fontSize: '11px', color: palette.textMuted, fontFamily: 'var(--font-mono)' }}>{date}</span>}
    </div>
  );
}

function StatusChip({ status }: { status: PayloadRow['status'] }) {
  const active = status === 'Active';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: radius.pill,
        background: active ? palette.blueSoft : palette.gray100,
        color: active ? palette.navy : palette.gray500,
        fontSize: '11px',
        fontWeight: 500,
      }}
    >
      {active ? 'Active' : 'Separated'}
    </span>
  );
}
