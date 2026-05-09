import axios from 'axios';

import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/time.js';
import type { LatLon } from '../types.js';
import { CatalogService } from './catalog.js';
import { ConfigService } from './config.js';
import { DbService } from './db.js';
import { N2yoService } from './n2yo.js';
import { RequestBudgetService } from './requestBudget.js';
import { TleService } from './tle.js';

export class SweeperService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly db: DbService,
    private readonly catalog: CatalogService,
    private readonly n2yo: N2yoService,
    private readonly budget: RequestBudgetService,
    private readonly tleService: TleService
  ) {}

  start(): void {
    this.scheduleNext(5_000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this.runSweepIfDue();
      this.scheduleNext(this.config.get().refresh_interval * 1000);
    }, ms);
  }

  async runSweepIfDue(force = false): Promise<void> {
    if (this.running) return;
    const cfg = this.config.get();
    const last = this.db.getMetadata('lastFullSweepAt');
    const staleLimit = cfg.full_sweep_max_age_hours * 3600 * 1000;
    const due = !last || Date.now() - new Date(last).getTime() > staleLimit;

    if (!force && !due) return;

    this.running = true;
    const sweepId = this.db.startSweep();
    let discovered = 0;

    try {
      for (const point of cfg.search_locations) {
        if (!this.budget.canSpend('above')) {
          logger.warn('above request budget exhausted; finishing partial sweep');
          break;
        }
        const count = await this.fetchAbovePoint(point);
        discovered += count;
      }

      await this.backfillFromListing();

      this.db.finishSweep(sweepId, 'success', discovered);
      this.db.setMetadata('lastFullSweepAt', nowIso());
      this.db.setMetadata('lastSweepStatus', 'success');
    } catch (error) {
      const message = String(error);
      this.db.finishSweep(sweepId, 'failed', discovered, message);
      this.db.setMetadata('lastSweepStatus', 'failed');
      logger.error('sweep failed', message);
    } finally {
      this.running = false;
    }
  }

  private async fetchAbovePoint(point: LatLon): Promise<number> {
    const cfg = this.config.get();
    if (!cfg.n2yo_api_key) return 0;

    const data = await this.n2yo.above({
      observerLat: point.latitude,
      observerLng: point.longitude,
      observerAlt: 0,
      searchRadius: 90,
      categoryId: 0,
      apiKey: cfg.n2yo_api_key
    });
    this.budget.spend('above');

    const category = String(data.info?.category ?? '').trim() || undefined;
    const above = Array.isArray(data.above) ? data.above : [];

    for (const entry of above) {
      const obj = this.catalog.upsertFromAbove(entry, category);
      await this.tleService.getOrRefresh(obj.satid).catch(() => undefined);
    }

    return above.length;
  }

  private async backfillFromListing(): Promise<void> {
    const response = await axios.get('https://www.n2yo.com/satellites/', { timeout: 15_000 });
    const html = String(response.data ?? '');
    const matches = [...html.matchAll(/satellite\/\?s=(\d+)/g)].map((m) => Number(m[1]));

    for (const satid of new Set(matches)) {
      if (!Number.isFinite(satid)) continue;
      await this.tleService.getOrRefresh(satid).catch(() => undefined);
    }
  }

  status(): { running: boolean; lastFullSweepAt: string | null; lastSweepStatus: string | null } {
    return {
      running: this.running,
      lastFullSweepAt: this.db.getMetadata('lastFullSweepAt'),
      lastSweepStatus: this.db.getMetadata('lastSweepStatus')
    };
  }
}
