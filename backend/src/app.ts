import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

import { proxyAuth } from './lib/auth.js';
import { HttpError } from './lib/errors.js';
import { buildApiRouter } from './routes/api.js';
import { buildSatelliteRouter } from './routes/satellite.js';
import type { AppContext } from './services/context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDistPath = process.env.FRONTEND_DIST_PATH ?? path.resolve(__dirname, '../frontend-dist');
const frontendIndexPath = path.join(frontendDistPath, 'index.html');

export const buildApp = (ctx: AppContext): express.Express => {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          upgradeInsecureRequests: null
        }
      }
    })
  );
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan('dev'));

  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'N2YO Hybrid Proxy API',
        version: '0.1.0'
      }
    },
    apis: []
  });

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.get('/health', (_req, res) => {
    res.json({
      service: 'N2YO Hybrid Proxy Backend',
      version: '0.1.0',
      status: 'ok'
    });
  });

  app.use('/api', proxyAuth(ctx.config), buildApiRouter(ctx));
  app.use('/rest/v1/satellite', proxyAuth(ctx.config), buildSatelliteRouter(ctx));

  app.use(express.static(frontendDistPath));
  app.get('*', (req, res, next) => {
    if (!req.accepts('html')) {
      next();
      return;
    }

    res.sendFile(frontendIndexPath, (error) => {
      if (error) next(error);
    });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json(error.payload ?? { error: error.message });
      return;
    }

    res.status(500).json({ error: String(error) });
  });

  return app;
};
