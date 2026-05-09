export type VerbLimitKey = 'tle' | 'positions' | 'visualpasses' | 'radiopasses' | 'above';

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface Location extends LatLon {
  altitude?: number;
}

export interface AppConfig {
  home_location: Location;
  search_locations: LatLon[];
  n2yo_api_key: string;
  proxy_api_key: string;
  sqlite_db_path: string;
  tle_max_age_hours: number;
  full_sweep_max_age_hours: number;
  request_threshold_window_minutes: number;
  request_thresholds_by_verb: Record<VerbLimitKey, number>;
  refresh_interval: number;
}

export interface SatelliteObject {
  satid: number;
  satname: string;
  satlat?: number;
  satlng?: number;
  satalt?: number;
  category?: string;
  owner?: string;
  country?: string;
  launchDate?: string;
  lastSeenAt: string;
  source: 'above' | 'tle' | 'bootstrap';
}

export interface SweepRecord {
  id?: number;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'failed';
  discoveredCount: number;
  error?: string;
}

export interface StaleDataErrorPayload {
  code: 'STALE_DATA_REFRESH_FAILED';
  message: string;
  details?: string;
}
