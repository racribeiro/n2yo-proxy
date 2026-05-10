import axios, { type AxiosInstance, type AxiosError } from 'axios';

import { errorToMeta, logger } from '../lib/logger.js';

type N2yoVerb = 'above' | 'tle' | 'positions' | 'visualpasses' | 'radiopasses';

type VerbStats = {
  total: number;
  success: number;
  timeout: number;
  networkError: number;
  http4xx: number;
  http5xx: number;
  otherError: number;
  lastStatus: number | null;
  lastLatencyMs: number | null;
  lastErrorAt: string | null;
  totalLatencyMs: number;
};

const newVerbStats = (): VerbStats => ({
  total: 0,
  success: 0,
  timeout: 0,
  networkError: 0,
  http4xx: 0,
  http5xx: 0,
  otherError: 0,
  lastStatus: null,
  lastLatencyMs: null,
  lastErrorAt: null,
  totalLatencyMs: 0
});

const sanitizeEndpoint = (endpoint: string): string => endpoint.replace(/apiKey=[^&]+/g, 'apiKey=***');

export class N2yoService {
  private readonly client: AxiosInstance;
  private readonly stats: Record<N2yoVerb, VerbStats> = {
    above: newVerbStats(),
    tle: newVerbStats(),
    positions: newVerbStats(),
    visualpasses: newVerbStats(),
    radiopasses: newVerbStats()
  };

  constructor(baseUrl: string) {
    this.client = axios.create({ baseURL: baseUrl, timeout: 15_000 });
  }

  snapshotStats(): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(this.stats).map(([verb, value]) => [
        verb,
        {
          ...value,
          avgLatencyMs: value.success > 0 ? Math.round(value.totalLatencyMs / value.success) : null
        }
      ])
    );
  }

  private async request<T>(verb: N2yoVerb, endpoint: string, paramSummary: Record<string, unknown>): Promise<T> {
    const startedAt = Date.now();
    const stat = this.stats[verb];
    stat.total += 1;
    const safeEndpoint = sanitizeEndpoint(endpoint);
    logger.info('n2yo request start', { verb, endpoint: safeEndpoint, params: paramSummary });
    try {
      const response = await this.client.get<T>(endpoint);
      const latencyMs = Date.now() - startedAt;
      stat.success += 1;
      stat.lastStatus = response.status;
      stat.lastLatencyMs = latencyMs;
      stat.totalLatencyMs += latencyMs;
      logger.info('n2yo request success', { verb, endpoint: safeEndpoint, status: response.status, latencyMs });
      return response.data;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      stat.lastLatencyMs = latencyMs;
      stat.lastErrorAt = new Date().toISOString();
      const err = error as AxiosError;
      const status = err.response?.status ?? null;
      stat.lastStatus = status;
      if (err.code === 'ECONNABORTED') stat.timeout += 1;
      else if (typeof status === 'number' && status >= 500) stat.http5xx += 1;
      else if (typeof status === 'number' && status >= 400) stat.http4xx += 1;
      else if (err.request) stat.networkError += 1;
      else stat.otherError += 1;
      logger.warn('n2yo request failed', {
        verb,
        endpoint: safeEndpoint,
        status,
        latencyMs,
        category:
          err.code === 'ECONNABORTED'
            ? 'timeout'
            : typeof status === 'number' && status >= 500
              ? 'http5xx'
              : typeof status === 'number' && status >= 400
                ? 'http4xx'
                : err.request
                  ? 'network'
                  : 'other',
        error: errorToMeta(error)
      });
      throw error;
    }
  }

  async above(params: {
    observerLat: number;
    observerLng: number;
    observerAlt: number;
    searchRadius: number;
    categoryId: number;
    apiKey: string;
  }): Promise<any> {
    const { observerLat, observerLng, observerAlt, searchRadius, categoryId, apiKey } = params;
    const path = `/rest/v1/satellite/above/${observerLat}/${observerLng}/${observerAlt}/${searchRadius}/${categoryId}/&apiKey=${apiKey}`;
    return this.request('above', path, { observerLat, observerLng, observerAlt, searchRadius, categoryId });
  }

  async tle(satid: number, apiKey: string): Promise<any> {
    return this.request('tle', `/rest/v1/satellite/tle/${satid}&apiKey=${apiKey}`, { satid });
  }

  async positions(params: {
    satid: number;
    observerLat: number;
    observerLng: number;
    observerAlt: number;
    seconds: number;
    apiKey: string;
  }): Promise<any> {
    const { satid, observerLat, observerLng, observerAlt, seconds, apiKey } = params;
    return this.request(
      'positions',
      `/rest/v1/satellite/positions/${satid}/${observerLat}/${observerLng}/${observerAlt}/${seconds}/&apiKey=${apiKey}`,
      { satid, observerLat, observerLng, observerAlt, seconds }
    );
  }

  async visualpasses(params: {
    satid: number;
    observerLat: number;
    observerLng: number;
    observerAlt: number;
    days: number;
    minVisibility: number;
    apiKey: string;
  }): Promise<any> {
    const { satid, observerLat, observerLng, observerAlt, days, minVisibility, apiKey } = params;
    return this.request(
      'visualpasses',
      `/rest/v1/satellite/visualpasses/${satid}/${observerLat}/${observerLng}/${observerAlt}/${days}/${minVisibility}/&apiKey=${apiKey}`,
      { satid, observerLat, observerLng, observerAlt, days, minVisibility }
    );
  }

  async radiopasses(params: {
    satid: number;
    observerLat: number;
    observerLng: number;
    observerAlt: number;
    days: number;
    minElevation: number;
    apiKey: string;
  }): Promise<any> {
    const { satid, observerLat, observerLng, observerAlt, days, minElevation, apiKey } = params;
    return this.request(
      'radiopasses',
      `/rest/v1/satellite/radiopasses/${satid}/${observerLat}/${observerLng}/${observerAlt}/${days}/${minElevation}/&apiKey=${apiKey}`,
      { satid, observerLat, observerLng, observerAlt, days, minElevation }
    );
  }
}
