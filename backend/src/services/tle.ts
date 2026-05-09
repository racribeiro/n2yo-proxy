import satellite from 'satellite.js';

import { StaleDataError } from '../lib/errors.js';
import { DbService } from './db.js';
import { ConfigService } from './config.js';
import { N2yoService } from './n2yo.js';
import { RequestBudgetService } from './requestBudget.js';

interface TleRecord {
  satid: number;
  satname: string;
  raw_tle: string;
  line1: string;
  line2: string;
  fetched_at: string;
  expires_at: string;
}

export class TleService {
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly n2yo: N2yoService,
    private readonly budget: RequestBudgetService
  ) {}

  async getOrRefresh(satid: number): Promise<TleRecord> {
    const existing = this.db.getTle(satid);
    const stale = !existing || new Date(existing.expires_at).getTime() <= Date.now();

    if (!stale && existing) return existing;

    if (!this.budget.canSpend('tle')) {
      throw new StaleDataError('Cannot refresh TLE now due to request budget limits', `satid=${satid}`);
    }

    const key = this.config.get().n2yo_api_key;
    if (!key) throw new StaleDataError('Cannot refresh TLE because N2YO API key is not configured', `satid=${satid}`);

    try {
      const data = await this.n2yo.tle(satid, key);
      this.budget.spend('tle');

      const info = data.info ?? {};
      const tleRaw = String(data.tle ?? '').trim();
      const lines = tleRaw.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) throw new Error('Invalid TLE payload format');

      const expiresAt = new Date(Date.now() + this.config.get().tle_max_age_hours * 3600 * 1000).toISOString();
      this.db.persistTle(Number(info.satid ?? satid), String(info.satname ?? `SAT-${satid}`), tleRaw, lines[0], lines[1], expiresAt);

      const saved = this.db.getTle(satid);
      if (!saved) throw new Error('TLE not persisted');
      return saved;
    } catch (error) {
      throw new StaleDataError('Failed to refresh stale TLE from upstream', String(error));
    }
  }

  async getAll(): Promise<Array<{ satid: number; satname: string; line1: string; line2: string; fetched_at: string; expires_at: string }>> {
    return this.db.getAllTle();
  }

  async computePositions(params: {
    satid: number;
    observerLat: number;
    observerLng: number;
    observerAlt: number;
    seconds: number;
  }): Promise<any> {
    const tle = await this.getOrRefresh(params.satid);
    const satrec = satellite.twoline2satrec(tle.line1, tle.line2);

    const positions: any[] = [];
    const count = Math.max(1, Math.floor(params.seconds / 5));
    const stepSeconds = 5;

    for (let i = 0; i < count; i++) {
      const date = new Date(Date.now() + i * stepSeconds * 1000);
      const propagated = satellite.propagate(satrec, date);
      if (!propagated.position || typeof propagated.position === 'boolean') continue;
      const gmst = satellite.gstime(date);
      const geo = satellite.eciToGeodetic(propagated.position as satellite.EciVec3<number>, gmst);
      positions.push({
        satlatitude: satellite.degreesLat(geo.latitude),
        satlongitude: satellite.degreesLong(geo.longitude),
        sataltitude: geo.height,
        azimuth: 0,
        elevation: 0,
        ra: 0,
        dec: 0,
        timestamp: Math.floor(date.getTime() / 1000),
        eclipsed: false
      });
    }

    return {
      info: {
        satid: params.satid,
        satname: tle.satname,
        transactionscount: positions.length
      },
      positions
    };
  }

  async computeVisualPasses(params: {
    satid: number;
    observerLat: number;
    observerLng: number;
    observerAlt: number;
    days: number;
    minVisibility: number;
  }): Promise<any> {
    await this.getOrRefresh(params.satid);
    return {
      info: {
        satid: params.satid,
        satname: `SAT-${params.satid}`,
        passescount: 0
      },
      passes: []
    };
  }

  async computeRadioPasses(params: {
    satid: number;
    observerLat: number;
    observerLng: number;
    observerAlt: number;
    days: number;
    minElevation: number;
  }): Promise<any> {
    await this.getOrRefresh(params.satid);
    return {
      info: {
        satid: params.satid,
        satname: `SAT-${params.satid}`,
        passescount: 0
      },
      passes: []
    };
  }
}
