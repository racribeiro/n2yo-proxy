import { apiGet, apiPatch } from './client';
import type { OrbitalObject } from '../types';

export interface PublicConfig {
  home_location: { latitude: number; longitude: number; altitude?: number };
  search_locations: Array<{ latitude: number; longitude: number }>;
  sqlite_db_path: string;
  tle_max_age_hours: number;
  full_sweep_max_age_hours: number;
  request_threshold_window_minutes: number;
  request_thresholds_by_verb: Record<string, number>;
  refresh_interval: number;
  hasN2yoApiKey: boolean;
  hasProxyApiKey: boolean;
}

export interface StatusPayload {
  running: boolean;
  lastFullSweepAt: string | null;
  lastSweepStatus: string | null;
  stale: boolean;
  tleCount: number;
  objectCount: number;
}

export const fetchConfig = () => apiGet<PublicConfig>('/api/config');
export const patchConfig = (body: Record<string, unknown>) => apiPatch<PublicConfig>('/api/config', body);
export const fetchStatus = () => apiGet<StatusPayload>('/api/status');
export const fetchCategories = () => apiGet<{ categories: string[] }>('/api/categories');
export const fetchSweeps = () => apiGet<{ sweeps: Array<Record<string, unknown>> }>('/api/sweeps');
export const runSweepNow = () => apiGet<{ ok: boolean }>('/api/sweeps/run');

export const fetchObjects = (query: Record<string, string | number | undefined>) =>
  apiGet<{ count: number; objects: OrbitalObject[] }>('/api/objects', query);
