// Canonical payload contract. Matches the shape produced by pipeline/collect.py
// and consumed by the static dashboard.

export type ISO8601 = string;
export type Band = 'none' | 'yellow' | 'orange' | 'red';
export type CohortDef = 'a' | 'b' | 'c';
export type PayloadSource = 'seed' | 'confirmed';

export interface PayloadMeta {
  board_id: string;
  generated_at: ISO8601;
  generated_by: string;
  tz: string;
  target_hours: number;
  thresholds: { yellow: number; orange: number; red: number };
  cohort_def: CohortDef;
  source: PayloadSource;
  attend_source: string;
}

export interface PayloadKpis {
  total: number;
  ge72: number;
  ge96: number;
  ge112: number;
  target_rate: number;
  avg: number;
  median: number;
}

export interface PayloadRow {
  full_name: string;
  employee_no: string;
  store: string;
  region: string;
  position: string;
  hire_date: string;
  hours: number;
  band: Band;
  status: 'Active' | 'Separated';
}

export interface Payload {
  meta: PayloadMeta;
  kpis: PayloadKpis;
  regions: string[];
  rows: PayloadRow[];
}
