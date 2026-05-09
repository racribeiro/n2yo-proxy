import path from 'node:path';

import { CatalogService } from './catalog.js';
import { ConfigService } from './config.js';
import { DbService } from './db.js';
import { N2yoService } from './n2yo.js';
import { RequestBudgetService } from './requestBudget.js';
import { SweeperService } from './sweeper.js';
import { TleService } from './tle.js';

export class AppContext {
  db: DbService;
  config: ConfigService;
  budget: RequestBudgetService;
  n2yo: N2yoService;
  catalog: CatalogService;
  tle: TleService;
  sweeper: SweeperService;

  constructor() {
    const configFilePath = path.resolve(process.cwd(), 'backend/config.json');
    const initialDb = new DbService(path.resolve('./backend/data/bootstrap.db'));
    this.config = new ConfigService(configFilePath, initialDb);

    const dbPath = this.config.get().sqlite_db_path;
    if (path.resolve(dbPath) !== path.resolve('./backend/data/bootstrap.db')) {
      initialDb.db.close();
      this.db = new DbService(dbPath);
      this.config = new ConfigService(configFilePath, this.db);
    } else {
      this.db = initialDb;
    }

    this.n2yo = new N2yoService(process.env.N2YO_BASE_URL || 'https://api.n2yo.com');
    this.budget = new RequestBudgetService(this.db, this.config);
    this.catalog = new CatalogService(this.db);
    this.tle = new TleService(this.db, this.config, this.n2yo, this.budget);
    this.sweeper = new SweeperService(this.config, this.db, this.catalog, this.n2yo, this.budget, this.tle);
  }
}
