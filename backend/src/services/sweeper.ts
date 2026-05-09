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

    if (!force && !due) {
      logger.info('sweep skipped (not due)', {
        force,
        lastFullSweepAt: last,
        staleLimitMs: staleLimit,
        n2yoStats: this.n2yo.snapshotStats()
      });
      return;
    }

    this.running = true;
    const sweepId = this.db.startSweep();
    let discovered = 0;
    let hadFailures = false;
    let successfulPoints = 0;
    let attemptedPoints = 0;
    const startedAt = Date.now();
    logger.info('sweep started', {
      sweepId,
      force,
      searchPoints: cfg.search_locations.length,
      requestBudgetAbove: this.budget.snapshot().above,
      n2yoStats: this.n2yo.snapshotStats()
    });

    try {
      if (!cfg.n2yo_api_key) {
        const message = 'n2yo_api_key is not configured';
        this.db.finishSweep(sweepId, 'failed', 0, message);
        this.db.setMetadata('lastSweepStatus', 'failed');
        logger.warn('sweep skipped', message);
        return;
      }

      for (const point of cfg.search_locations) {
        attemptedPoints += 1;
        if (!this.budget.canSpend('above')) {
          logger.warn('above request budget exhausted; finishing partial sweep', {
            sweepId,
            attemptedPoints,
            successfulPoints,
            discovered,
            aboveBudget: this.budget.snapshot().above
          });
          break;
        }
        try {
          logger.info('sweep point fetch start', { sweepId, point, attemptedPoints });
          const count = await this.fetchAbovePoint(point);
          discovered += count;
          successfulPoints += 1;
          logger.info('sweep point fetch success', {
            sweepId,
            point,
            attemptedPoints,
            discoveredFromPoint: count,
            discoveredTotal: discovered
          });
        } catch (error) {
          hadFailures = true;
          logger.warn('above point fetch failed', { point, error: String(error) });
        }
      }

      try {
        await this.backfillFromListing();
        logger.info('listing backfill success', { sweepId });
      } catch (error) {
        // Listing backfill is a completeness enhancer, not a hard dependency for serving.
        hadFailures = true;
        logger.warn('listing backfill failed', String(error));
      }

      const totalHardFailure = successfulPoints === 0 && hadFailures;
      const finalStatus = totalHardFailure ? 'failed' : 'success';
      const finalError = totalHardFailure
        ? 'sweep failed for all points'
        : hadFailures
          ? 'partial sweep with upstream failures'
          : undefined;

      this.db.finishSweep(sweepId, finalStatus, discovered, finalError);
      this.db.setMetadata('lastFullSweepAt', nowIso());
      this.db.setMetadata('lastSweepStatus', totalHardFailure ? 'failed' : hadFailures ? 'partial' : 'success');
      logger.info('sweep finished', {
        sweepId,
        finalStatus,
        discovered,
        attemptedPoints,
        successfulPoints,
        durationMs: Date.now() - startedAt,
        finalError,
        n2yoStats: this.n2yo.snapshotStats()
      });
    } catch (error) {
      const message = String(error);
      this.db.finishSweep(sweepId, 'failed', discovered, message);
      this.db.setMetadata('lastSweepStatus', 'failed');
      logger.error('sweep failed', {
        sweepId,
        discovered,
        attemptedPoints,
        successfulPoints,
        durationMs: Date.now() - startedAt,
        error: message,
        n2yoStats: this.n2yo.snapshotStats()
      });
    } finally {
      this.running = false;
    }
  }

  private async fetchAbovePoint(point: LatLon): Promise<number> {
    const cfg = this.config.get();
    if (!cfg.n2yo_api_key) return 0;

    const data = await this.retry(async () =>
      this.n2yo.above({
        observerLat: point.latitude,
        observerLng: point.longitude,
        observerAlt: 0,
        searchRadius: 90,
        categoryId: 0,
        apiKey: cfg.n2yo_api_key
      })
    );
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
    const response = await this.retry(() => axios.get('https://www.n2yo.com/satellites/', { timeout: 60_000 }));
    const html = String(response.data ?? '');
    const matches = [...html.matchAll(/satellite\/\?s=(\d+)/g)].map((m) => Number(m[1]));

    for (const satid of new Set(matches)) {
      if (!Number.isFinite(satid)) continue;
      await this.tleService.getOrRefresh(satid).catch(() => undefined);
    }
  }

  private async retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < attempts - 1) {
          const backoffMs = 1000 * Math.pow(2, i);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }
    throw lastError;
  }

  status(): { running: boolean; lastFullSweepAt: string | null; lastSweepStatus: string | null } {
    return {
      running: this.running,
      lastFullSweepAt: this.db.getMetadata('lastFullSweepAt'),
      lastSweepStatus: this.db.getMetadata('lastSweepStatus')
    };
  }
}
