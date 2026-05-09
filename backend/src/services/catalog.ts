import type { SatelliteObject } from '../types.js';
import { nowIso } from '../lib/time.js';
import { DbService } from './db.js';

export class CatalogService {
  constructor(private readonly db: DbService) {}

  upsertFromAbove(entry: any, category?: string): SatelliteObject {
    const obj: SatelliteObject = {
      satid: Number(entry.satid),
      satname: String(entry.satname ?? `SAT-${entry.satid}`),
      satlat: Number(entry.satlat ?? 0),
      satlng: Number(entry.satlng ?? 0),
      satalt: Number(entry.satalt ?? 0),
      category,
      owner: entry.owner ?? undefined,
      country: entry.country ?? undefined,
      launchDate: entry.launchDate ?? undefined,
      lastSeenAt: nowIso(),
      source: 'above'
    };
    this.db.upsertObject(obj);

    if (category) this.db.upsertCategories(obj.satid, [category], 'above');

    return obj;
  }

  list(filters: {
    category?: string;
    q?: string;
    minAlt?: number;
    maxAlt?: number;
    owner?: string;
    country?: string;
    satid?: number;
    launchDate?: string;
  }): SatelliteObject[] {
    return this.db.getObjects(filters);
  }

  categories(): string[] {
    return this.db.getDistinctCategories();
  }
}
