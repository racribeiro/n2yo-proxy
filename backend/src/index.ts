import 'dotenv/config';

import { buildApp } from './app.js';
import { logger } from './lib/logger.js';
import { AppContext } from './services/context.js';

const ctx = new AppContext();
const app = buildApp(ctx);

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  logger.info(`backend listening on http://localhost:${port}`);
  ctx.sweeper.start();
  ctx.sweeper.runSweepIfDue().catch((error) => logger.error('initial sweep failed', error));
});
