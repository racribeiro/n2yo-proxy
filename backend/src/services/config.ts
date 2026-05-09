import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { DbService } from './db.js';
import type { AppConfig } from '../types.js';

const configSchema = z.object({
  home_location: z.object({ latitude: z.number(), longitude: z.number(), altitude: z.number().optional() }),
  search_locations: z.array(z.object({ latitude: z.number(), longitude: z.number() })),
  n2yo_api_key: z.string(),
  proxy_api_key: z.string(),
  sqlite_db_path: z.string(),
  tle_max_age_hours: z.number().positive(),
  full_sweep_max_age_hours: z.number().positive(),
  request_threshold_window_minutes: z.number().positive(),
  request_thresholds_by_verb: z.object({
    tle: z.number().positive(),
    positions: z.number().positive(),
    visualpasses: z.number().positive(),
    radiopasses: z.number().positive(),
    above: z.number().positive()
  }),
  refresh_interval: z.number().positive()
});

export type PublicConfig = Omit<AppConfig, 'n2yo_api_key' | 'proxy_api_key'> & {
  hasN2yoApiKey: boolean;
  hasProxyApiKey: boolean;
};

export class ConfigService {
  private readonly configPath: string;
  private readonly db: DbService;
  private cache: AppConfig;

  constructor(configPath: string, db: DbService) {
    this.configPath = path.resolve(configPath);
    this.db = db;
    this.cache = this.loadInitial();
  }

  private loadInitial(): AppConfig {
    const fromDb = this.db.getConfig();
    if (fromDb) return configSchema.parse(fromDb);

    const fileRaw = fs.readFileSync(this.configPath, 'utf8');
    const parsed = configSchema.parse(JSON.parse(fileRaw));
    this.db.upsertConfig(parsed);
    return parsed;
  }

  get(): AppConfig {
    return this.cache;
  }

  getPublic(): PublicConfig {
    const { n2yo_api_key, proxy_api_key, ...rest } = this.cache;
    return {
      ...rest,
      hasN2yoApiKey: Boolean(n2yo_api_key),
      hasProxyApiKey: Boolean(proxy_api_key)
    };
  }

  patch(patch: Partial<AppConfig>): PublicConfig {
    const merged = configSchema.parse({ ...this.cache, ...patch });
    this.cache = merged;
    this.db.upsertConfig(merged);

    const persisted = {
      ...merged,
      n2yo_api_key: patch.n2yo_api_key ?? this.cache.n2yo_api_key,
      proxy_api_key: patch.proxy_api_key ?? this.cache.proxy_api_key
    };
    fs.writeFileSync(this.configPath, JSON.stringify(persisted, null, 2));

    return this.getPublic();
  }
}
