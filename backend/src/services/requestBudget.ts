import { nowIso } from '../lib/time.js';
import type { VerbLimitKey } from '../types.js';
import { DbService } from './db.js';
import { ConfigService } from './config.js';

export class RequestBudgetService {
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService
  ) {}

  canSpend(verb: VerbLimitKey): boolean {
    const cfg = this.config.get();
    const windowMinutes = cfg.request_threshold_window_minutes;
    const limit = cfg.request_thresholds_by_verb[verb];
    const counter = this.db.ensureVerbCounter(verb);

    const started = new Date(counter.window_started_at);
    const ageMs = Date.now() - started.getTime();
    const windowMs = windowMinutes * 60 * 1000;

    if (ageMs >= windowMs) {
      this.db.setVerbCounter(verb, nowIso(), 0);
      return true;
    }

    return counter.count < limit;
  }

  spend(verb: VerbLimitKey): void {
    const counter = this.db.ensureVerbCounter(verb);
    this.db.setVerbCounter(verb, counter.window_started_at, counter.count + 1);
  }

  snapshot(): Record<VerbLimitKey, { count: number; limit: number; windowStartedAt: string }> {
    const cfg = this.config.get();
    return {
      tle: {
        ...this.counterWithLimit('tle', cfg.request_thresholds_by_verb.tle)
      },
      positions: {
        ...this.counterWithLimit('positions', cfg.request_thresholds_by_verb.positions)
      },
      visualpasses: {
        ...this.counterWithLimit('visualpasses', cfg.request_thresholds_by_verb.visualpasses)
      },
      radiopasses: {
        ...this.counterWithLimit('radiopasses', cfg.request_thresholds_by_verb.radiopasses)
      },
      above: {
        ...this.counterWithLimit('above', cfg.request_thresholds_by_verb.above)
      }
    };
  }

  private counterWithLimit(verb: VerbLimitKey, limit: number): { count: number; limit: number; windowStartedAt: string } {
    const c = this.db.ensureVerbCounter(verb);
    return { count: c.count, limit, windowStartedAt: c.window_started_at };
  }
}
