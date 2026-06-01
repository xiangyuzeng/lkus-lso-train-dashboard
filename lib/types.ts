// Canonical payload contract (schema v2). Matches the shape produced by
// pipeline/collect.py and consumed by the static dashboard.
//
// v2 generalises the original single-level (LSO100-only) payload into a
// four-level board. Each Level carries its own unit (hours vs days), target,
// thresholds and rows, so freshness/seed/source mechanics stay identical while
// the UI renders one tab per level.

export type ISO8601 = string;
export type Band = 'none' | 'yellow' | 'orange' | 'red';
export type Unit = 'hours' | 'days';
export type LevelKey = 'LSO100' | 'LSO200' | 'LSO300' | 'LSO400';
export type PayloadSource = 'seed' | 'confirmed';

export interface Thresholds {
  yellow: number;
  orange: number;
  red: number;
}

export interface PayloadMeta {
  board_id: string;
  schema_version: number;
  generated_at: ISO8601;
  generated_by: string;
  tz: string;
  source: PayloadSource;
  base_def: string;        // e.g. "active_store" — Active + LKUS + store dept
  store_count: number;     // live count of active-staffed stores
  regions: string[];       // ["—"] until a real store→region rollup exists
  cert_source: string;
  attend_source: string;
  course_source: string;
}

export interface LevelKpis {
  total: number;
  ge_yellow: number;
  ge_orange: number;
  ge_red: number;
  target_rate: number;     // ge_red / total
  avg: number;
  median: number;
}

export interface PayloadRow {
  full_name: string;
  employee_no: string;
  store: string;
  region: string;          // "—" until a rollup is wired
  position: string;
  hire_date: string;
  value: number;           // hours for LSO100, days (hours/8) for LSO200/300/400
  band: Band;              // computed vs the level's thresholds
  lso_course: string | null;       // label, or "pending"; null when has_course_col is false
  lso_course_date: string | null;  // class date (YYYY-MM-DD) when known
  status: 'Active' | 'Separated';
}

export interface Level {
  key: LevelKey;
  title: string;           // role name, e.g. "Shift Supervisor"
  unit: Unit;
  target: number;
  thresholds: Thresholds;
  in_training_def: string; // human-readable cohort definition
  has_course_col: boolean; // true for LSO200/300/400
  kpis: LevelKpis;
  rows: PayloadRow[];
}

export interface Payload {
  meta: PayloadMeta;
  levels: Level[];
}
