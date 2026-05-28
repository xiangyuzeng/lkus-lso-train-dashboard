'use client';

import { useMemo, useState } from 'react';
import type { PayloadRow } from '@/lib/types';
import { palette, radius, shadow } from '@/lib/tokens';
import { HoursCell } from './HoursCell';

interface Props {
  rows: PayloadRow[];
  regions: string[];
  target: number;
  thresholds: { yellow: number; orange: number; red: number };
}

type SortKey = 'full_name' | 'employee_no' | 'store' | 'region' | 'position' | 'hire_date' | 'hours';
type SortDir = 'asc' | 'desc';
type BandFilter = 'all' | 'lt72' | 'ge72' | 'ge96' | 'ge112';

const BAND_OPTIONS: { key: BandFilter; label: string }[] = [
  { key: 'all',   label: '全部' },
  { key: 'lt72',  label: '<72h' },
  { key: 'ge72',  label: '≥72h' },
  { key: 'ge96',  label: '≥96h' },
  { key: 'ge112', label: '≥112h' },
];

function bandMatches(filter: BandFilter, row: PayloadRow, t: Props['thresholds']): boolean {
  switch (filter) {
    case 'all':   return true;
    case 'lt72':  return row.hours < t.yellow;
    case 'ge72':  return row.hours >= t.yellow;
    case 'ge96':  return row.hours >= t.orange;
    case 'ge112': return row.hours >= t.red;
  }
}

function compare(a: PayloadRow, b: PayloadRow, key: SortKey, dir: SortDir): number {
  const va = a[key];
  const vb = b[key];
  let cmp = 0;
  if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
  else cmp = String(va).localeCompare(String(vb), 'zh-Hans');
  return dir === 'asc' ? cmp : -cmp;
}

export function TrainingTable({ rows, regions, target, thresholds }: Props) {
  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState<BandFilter>('all');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('hours');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = rows.filter((r) => {
      if (!bandMatches(bandFilter, r, thresholds)) return false;
      if (regionFilter !== 'all' && r.region !== regionFilter) return false;
      if (q) {
        const hay = `${r.full_name} ${r.employee_no} ${r.store} ${r.region} ${r.position}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    result.sort((a, b) => compare(a, b, sortKey, sortDir));
    return result;
  }, [rows, search, bandFilter, regionFilter, sortKey, sortDir, thresholds]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'hours' ? 'desc' : 'asc');
    }
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

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
          alignItems: 'center',
          gap: '12px',
          padding: '14px 18px',
          borderBottom: `1px solid ${palette.border}`,
          background: palette.surfaceAlt,
        }}
      >
        <input
          type="search"
          placeholder="搜索 姓名 / 工号 / 门店 / 区域 / 职位"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: '1 1 260px',
            minWidth: '220px',
            padding: '8px 12px',
            border: `1px solid ${palette.border}`,
            borderRadius: radius.md,
            background: palette.surface,
            color: palette.text,
            fontSize: '13px',
          }}
        />
        <ChipRow>
          {BAND_OPTIONS.map((o) => (
            <Chip
              key={o.key}
              active={bandFilter === o.key}
              onClick={() => setBandFilter(o.key)}
              label={o.label}
            />
          ))}
        </ChipRow>
        <ChipRow>
          <Chip
            active={regionFilter === 'all'}
            onClick={() => setRegionFilter('all')}
            label="区域 · 全部"
          />
          {regions.map((r) => (
            <Chip
              key={r}
              active={regionFilter === r}
              onClick={() => setRegionFilter(r)}
              label={r}
            />
          ))}
        </ChipRow>
        <span
          style={{
            marginLeft: 'auto',
            color: palette.textMuted,
            fontSize: '13px',
            whiteSpace: 'nowrap',
          }}
        >
          共 <strong style={{ color: palette.text }}>{filtered.length}</strong> / {rows.length} 行
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
                姓名{sortIndicator('full_name')}
              </Th>
              <Th sticky onClick={() => onSort('employee_no')}>
                工号{sortIndicator('employee_no')}
              </Th>
              <Th sticky onClick={() => onSort('store')}>
                所在门店{sortIndicator('store')}
              </Th>
              <Th sticky onClick={() => onSort('region')}>
                所在区域{sortIndicator('region')}
              </Th>
              <Th sticky onClick={() => onSort('position')}>
                职位{sortIndicator('position')}
              </Th>
              <Th sticky onClick={() => onSort('hire_date')}>
                入职日期{sortIndicator('hire_date')}
              </Th>
              <Th sticky onClick={() => onSort('hours')} align="right">
                训练时长(小时){sortIndicator('hours')}
              </Th>
              <Th sticky>状态</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <Tr key={r.employee_no} row={r} target={target} />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    padding: '40px 16px',
                    textAlign: 'center',
                    color: palette.textMuted,
                  }}
                >
                  当前筛选无匹配数据
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

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{children}</div>;
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 11px',
        borderRadius: radius.pill,
        background: active ? palette.navy : palette.surface,
        color: active ? '#FFFFFF' : palette.text,
        border: `1px solid ${active ? palette.navy : palette.border}`,
        fontSize: '12px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
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
        background: palette.surface,
        borderBottom: `2px solid ${palette.border}`,
        padding: '10px 14px',
        textAlign: align ?? 'left',
        color: palette.textMuted,
        fontWeight: 600,
        fontSize: '12px',
        letterSpacing: '0.02em',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}

function Tr({ row, target }: { row: PayloadRow; target: number }) {
  return (
    <tr>
      <Td firstColumn>
        <span style={{ fontWeight: 500 }}>{row.full_name}</span>
      </Td>
      <Td>
        <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' }}>
          {row.employee_no}
        </code>
      </Td>
      <Td>{row.store}</Td>
      <Td>
        <span style={{ color: row.region === '—' ? palette.textMuted : palette.text }}>
          {row.region}
        </span>
      </Td>
      <Td>{row.position}</Td>
      <Td>
        <span style={{ color: palette.textMuted }}>{row.hire_date}</span>
      </Td>
      <Td align="right">
        <HoursCell hours={row.hours} band={row.band} target={target} />
      </Td>
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
      {active ? '在职' : '离职'}
    </span>
  );
}

