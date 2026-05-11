import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';

import { proxyAuth } from './lib/auth.js';
import { HttpError } from './lib/errors.js';
import { buildApiRouter } from './routes/api.js';
import { buildSatelliteRouter } from './routes/satellite.js';
import type { AppContext } from './services/context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDistPath = process.env.FRONTEND_DIST_PATH ?? path.resolve(__dirname, '../frontend-dist');
const frontendIndexPath = path.join(frontendDistPath, 'index.html');

const apiKeyParameter = {
  name: 'apiKey',
  in: 'query',
  required: true,
  schema: { type: 'string' },
  description: 'Proxy API key. N2YO-compatible legacy `/&apiKey=...` path suffixes are also accepted on satellite routes.'
} as const;

const numericPathParameter = (name: string, description?: string) =>
  ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'number' },
    ...(description ? { description } : {})
  }) as const;

const integerPathParameter = (name: string, description?: string) =>
  ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'integer' },
    ...(description ? { description } : {})
  }) as const;

const jsonResponse = (description: string, schema: unknown) => ({
  description,
  content: {
    'application/json': {
      schema
    }
  }
});

const protectedResponses = {
  401: jsonResponse('Missing or invalid proxy API key.', { $ref: '#/components/schemas/ErrorResponse' }),
  500: jsonResponse('Unhandled server error.', { $ref: '#/components/schemas/ErrorResponse' })
};

const staleDataResponse = jsonResponse('Cached data was stale and refresh failed or was blocked by request budget limits.', {
  $ref: '#/components/schemas/StaleDataError'
});

const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'N2YO Hybrid Proxy API',
    version: '0.1.0',
    description:
      'Local proxy and cache for N2YO-compatible satellite data. `/api/*` and `/rest/v1/satellite/*` require the proxy API key, not the upstream N2YO key.'
  },
  servers: [{ url: '/' }],
  components: {
    securitySchemes: {
      proxyApiKey: {
        type: 'apiKey',
        in: 'query',
        name: 'apiKey',
        description: 'Proxy API key configured in `proxy_api_key`.'
      }
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' }
        },
        required: ['error']
      },
      StaleDataError: {
        type: 'object',
        properties: {
          code: { type: 'string', enum: ['STALE_DATA_REFRESH_FAILED'] },
          message: { type: 'string' },
          details: { type: 'string' }
        },
        required: ['code', 'message']
      },
      LatLon: {
        type: 'object',
        properties: {
          latitude: { type: 'number' },
          longitude: { type: 'number' }
        },
        required: ['latitude', 'longitude']
      },
      Location: {
        allOf: [
          { $ref: '#/components/schemas/LatLon' },
          {
            type: 'object',
            properties: {
              altitude: { type: 'number' }
            }
          }
        ]
      },
      RequestThresholds: {
        type: 'object',
        properties: {
          tle: { type: 'number' },
          positions: { type: 'number' },
          visualpasses: { type: 'number' },
          radiopasses: { type: 'number' },
          above: { type: 'number' }
        },
        required: ['tle', 'positions', 'visualpasses', 'radiopasses', 'above']
      },
      PublicConfig: {
        type: 'object',
        properties: {
          home_location: { $ref: '#/components/schemas/Location' },
          search_locations: { type: 'array', items: { $ref: '#/components/schemas/LatLon' } },
          sqlite_db_path: { type: 'string' },
          tle_max_age_hours: { type: 'number' },
          full_sweep_max_age_hours: { type: 'number' },
          request_threshold_window_minutes: { type: 'number' },
          request_thresholds_by_verb: { $ref: '#/components/schemas/RequestThresholds' },
          refresh_interval: { type: 'number' },
          hasN2yoApiKey: { type: 'boolean' },
          hasProxyApiKey: { type: 'boolean' }
        },
        required: [
          'home_location',
          'search_locations',
          'sqlite_db_path',
          'tle_max_age_hours',
          'full_sweep_max_age_hours',
          'request_threshold_window_minutes',
          'request_thresholds_by_verb',
          'refresh_interval',
          'hasN2yoApiKey',
          'hasProxyApiKey'
        ],
        description: 'Public configuration. Secret values are write-only and are returned only as boolean presence flags.'
      },
      ConfigPatch: {
        type: 'object',
        properties: {
          home_location: { $ref: '#/components/schemas/Location' },
          search_locations: { type: 'array', items: { $ref: '#/components/schemas/LatLon' } },
          n2yo_api_key: { type: 'string', writeOnly: true },
          proxy_api_key: { type: 'string', writeOnly: true },
          sqlite_db_path: { type: 'string' },
          tle_max_age_hours: { type: 'number' },
          full_sweep_max_age_hours: { type: 'number' },
          request_threshold_window_minutes: { type: 'number' },
          request_thresholds_by_verb: { $ref: '#/components/schemas/RequestThresholds' },
          refresh_interval: { type: 'number' }
        },
        description: 'Partial config update. `n2yo_api_key` and `proxy_api_key` can be written but are never returned.'
      },
      SatelliteObject: {
        type: 'object',
        properties: {
          satid: { type: 'integer' },
          satname: { type: 'string' },
          satlat: { type: 'number' },
          satlng: { type: 'number' },
          satalt: { type: 'number' },
          category: { type: 'string' },
          owner: { type: 'string' },
          country: { type: 'string' },
          launchDate: { type: 'string' },
          lastSeenAt: { type: 'string', format: 'date-time' },
          source: { type: 'string', enum: ['above', 'tle', 'bootstrap'] }
        },
        required: ['satid', 'satname', 'lastSeenAt', 'source']
      },
      TleRecord: {
        type: 'object',
        properties: {
          satid: { type: 'integer' },
          satname: { type: 'string' },
          line1: { type: 'string' },
          line2: { type: 'string' },
          fetched_at: { type: 'string', format: 'date-time' },
          expires_at: { type: 'string', format: 'date-time' }
        },
        required: ['satid', 'satname', 'line1', 'line2', 'fetched_at', 'expires_at']
      },
      SweepRecord: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          startedAt: { type: 'string', format: 'date-time' },
          finishedAt: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['running', 'success', 'failed'] },
          discoveredCount: { type: 'integer' },
          error: { type: 'string' }
        },
        required: ['startedAt', 'status', 'discoveredCount']
      },
      AboveSatellite: {
        type: 'object',
        properties: {
          satid: { type: 'integer' },
          satname: { type: 'string' },
          satlat: { type: 'number' },
          satlng: { type: 'number' },
          satalt: { type: 'number' }
        },
        required: ['satid', 'satname']
      },
      SatellitePosition: {
        type: 'object',
        properties: {
          satlatitude: { type: 'number' },
          satlongitude: { type: 'number' },
          sataltitude: { type: 'number' },
          azimuth: { type: 'number' },
          elevation: { type: 'number' },
          ra: { type: 'number' },
          dec: { type: 'number' },
          timestamp: { type: 'integer' },
          eclipsed: { type: 'boolean' }
        },
        required: ['satlatitude', 'satlongitude', 'sataltitude', 'azimuth', 'elevation', 'ra', 'dec', 'timestamp', 'eclipsed']
      },
      PassesResponse: {
        type: 'object',
        properties: {
          info: {
            type: 'object',
            properties: {
              satid: { type: 'integer' },
              satname: { type: 'string' },
              passescount: { type: 'integer' }
            },
            required: ['satid', 'satname', 'passescount']
          },
          passes: { type: 'array', items: { type: 'object', additionalProperties: true } }
        },
        required: ['info', 'passes'],
        description: 'Currently scaffolded by the backend and returns an empty `passes` array.'
      }
    }
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        tags: ['System'],
        responses: {
          200: jsonResponse('Service health.', {
            type: 'object',
            properties: {
              service: { type: 'string' },
              version: { type: 'string' },
              status: { type: 'string', enum: ['ok'] }
            },
            required: ['service', 'version', 'status']
          })
        }
      }
    },
    '/api/config': {
      get: {
        summary: 'Get public configuration',
        tags: ['Operational API'],
        security: [{ proxyApiKey: [] }],
        parameters: [apiKeyParameter],
        responses: {
          200: jsonResponse('Public configuration with secret presence flags.', { $ref: '#/components/schemas/PublicConfig' }),
          ...protectedResponses
        }
      },
      patch: {
        summary: 'Patch configuration',
        tags: ['Operational API'],
        security: [{ proxyApiKey: [] }],
        parameters: [apiKeyParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ConfigPatch' }
            }
          }
        },
        responses: {
          200: jsonResponse('Updated public configuration. Secrets are returned only as presence flags.', { $ref: '#/components/schemas/PublicConfig' }),
          401: protectedResponses[401],
          500: protectedResponses[500]
        }
      }
    },
    '/api/objects': {
      get: {
        summary: 'List cached satellite objects',
        tags: ['Operational API'],
        security: [{ proxyApiKey: [] }],
        parameters: [
          apiKeyParameter,
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'minAlt', in: 'query', schema: { type: 'number' } },
          { name: 'maxAlt', in: 'query', schema: { type: 'number' } },
          { name: 'owner', in: 'query', schema: { type: 'string' } },
          { name: 'country', in: 'query', schema: { type: 'string' } },
          { name: 'satid', in: 'query', schema: { type: 'integer' } },
          { name: 'launchDate', in: 'query', schema: { type: 'string' } },
          { name: 'visibility', in: 'query', schema: { type: 'string', enum: ['home', 'location'] } },
          { name: 'locLat', in: 'query', schema: { type: 'number' }, description: 'Required when `visibility=location`.' },
          { name: 'locLng', in: 'query', schema: { type: 'number' }, description: 'Required when `visibility=location`.' }
        ],
        responses: {
          200: jsonResponse('Matching cached satellite objects.', {
            type: 'object',
            properties: {
              count: { type: 'integer' },
              objects: { type: 'array', items: { $ref: '#/components/schemas/SatelliteObject' } }
            },
            required: ['count', 'objects']
          }),
          400: jsonResponse('Invalid visibility filter coordinates.', { $ref: '#/components/schemas/ErrorResponse' }),
          ...protectedResponses
        }
      }
    },
    '/api/status': {
      get: {
        summary: 'Get sweep, budget, upstream, and cache status',
        tags: ['Operational API'],
        security: [{ proxyApiKey: [] }],
        parameters: [apiKeyParameter],
        responses: {
          200: jsonResponse('Backend status.', {
            type: 'object',
            additionalProperties: true,
            properties: {
              running: { type: 'boolean' },
              lastFullSweepAt: { type: 'string', nullable: true },
              lastSweepStatus: { type: 'string', nullable: true },
              stale: { type: 'boolean' },
              requestBudgets: { type: 'object', additionalProperties: true },
              n2yo: { type: 'object', additionalProperties: true },
              tleCount: { type: 'integer' },
              objectCount: { type: 'integer' }
            }
          }),
          ...protectedResponses
        }
      }
    },
    '/api/sweeps': {
      get: {
        summary: 'List recent sweeps',
        tags: ['Operational API'],
        security: [{ proxyApiKey: [] }],
        parameters: [apiKeyParameter],
        responses: {
          200: jsonResponse('Recent sweep records.', {
            type: 'object',
            properties: {
              sweeps: { type: 'array', items: { $ref: '#/components/schemas/SweepRecord' } }
            },
            required: ['sweeps']
          }),
          ...protectedResponses
        }
      }
    },
    '/api/sweeps/run': {
      post: {
        summary: 'Force a sweep',
        tags: ['Operational API'],
        security: [{ proxyApiKey: [] }],
        parameters: [apiKeyParameter],
        responses: {
          200: jsonResponse('Sweep completed or was already running.', {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok']
          }),
          ...protectedResponses
        }
      }
    },
    '/api/categories': {
      get: {
        summary: 'List cached categories',
        tags: ['Operational API'],
        security: [{ proxyApiKey: [] }],
        parameters: [apiKeyParameter],
        responses: {
          200: jsonResponse('Distinct categories.', {
            type: 'object',
            properties: { categories: { type: 'array', items: { type: 'string' } } },
            required: ['categories']
          }),
          ...protectedResponses
        }
      }
    },
    '/api/tle': {
      get: {
        summary: 'List cached TLE records',
        tags: ['Operational API'],
        security: [{ proxyApiKey: [] }],
        parameters: [apiKeyParameter],
        responses: {
          200: jsonResponse('Cached TLE records.', {
            type: 'object',
            properties: { tles: { type: 'array', items: { $ref: '#/components/schemas/TleRecord' } } },
            required: ['tles']
          }),
          ...protectedResponses
        }
      }
    },
    '/api/tle/{satid}': {
      get: {
        summary: 'Get or refresh a TLE record',
        tags: ['Operational API'],
        security: [{ proxyApiKey: [] }],
        parameters: [apiKeyParameter, integerPathParameter('satid', 'Satellite NORAD catalog ID.')],
        responses: {
          200: jsonResponse('TLE record.', { $ref: '#/components/schemas/TleRecord' }),
          503: staleDataResponse,
          ...protectedResponses
        }
      }
    },
    '/rest/v1/satellite/above/{observerLat}/{observerLng}/{observerAlt}/{searchRadius}/{categoryId}/': {
      get: {
        summary: 'List cached satellites above an observer',
        tags: ['N2YO-compatible API'],
        security: [{ proxyApiKey: [] }],
        parameters: [
          apiKeyParameter,
          numericPathParameter('observerLat'),
          numericPathParameter('observerLng'),
          numericPathParameter('observerAlt'),
          numericPathParameter('searchRadius'),
          integerPathParameter('categoryId')
        ],
        responses: {
          200: jsonResponse('N2YO-style above response from the local catalog.', {
            type: 'object',
            properties: {
              info: {
                type: 'object',
                properties: {
                  category: { type: 'integer' },
                  transactionscount: { type: 'integer' },
                  observer: { type: 'object', additionalProperties: { type: 'number' } }
                },
                required: ['category', 'transactionscount', 'observer']
              },
              above: { type: 'array', items: { $ref: '#/components/schemas/AboveSatellite' } }
            },
            required: ['info', 'above']
          }),
          ...protectedResponses
        }
      }
    },
    '/rest/v1/satellite/tle/{satid}': {
      get: {
        summary: 'Get N2YO-style TLE text',
        tags: ['N2YO-compatible API'],
        security: [{ proxyApiKey: [] }],
        parameters: [apiKeyParameter, integerPathParameter('satid', 'Satellite NORAD catalog ID.')],
        responses: {
          200: jsonResponse('N2YO-style TLE response.', {
            type: 'object',
            properties: {
              info: {
                type: 'object',
                properties: {
                  satid: { type: 'integer' },
                  satname: { type: 'string' }
                },
                required: ['satid', 'satname']
              },
              tle: { type: 'string', description: 'Two TLE lines separated by CRLF.' }
            },
            required: ['info', 'tle']
          }),
          503: staleDataResponse,
          ...protectedResponses
        }
      }
    },
    '/rest/v1/satellite/positions/{satid}/{observerLat}/{observerLng}/{observerAlt}/{seconds}/': {
      get: {
        summary: 'Compute satellite positions from cached TLE data',
        tags: ['N2YO-compatible API'],
        security: [{ proxyApiKey: [] }],
        parameters: [
          apiKeyParameter,
          integerPathParameter('satid', 'Satellite NORAD catalog ID.'),
          numericPathParameter('observerLat'),
          numericPathParameter('observerLng'),
          numericPathParameter('observerAlt'),
          integerPathParameter('seconds')
        ],
        responses: {
          200: jsonResponse('N2YO-style positions response.', {
            type: 'object',
            properties: {
              info: {
                type: 'object',
                properties: {
                  satid: { type: 'integer' },
                  satname: { type: 'string' },
                  transactionscount: { type: 'integer' }
                },
                required: ['satid', 'satname', 'transactionscount']
              },
              positions: { type: 'array', items: { $ref: '#/components/schemas/SatellitePosition' } }
            },
            required: ['info', 'positions']
          }),
          503: staleDataResponse,
          ...protectedResponses
        }
      }
    },
    '/rest/v1/satellite/visualpasses/{satid}/{observerLat}/{observerLng}/{observerAlt}/{days}/{minVisibility}/': {
      get: {
        summary: 'Get visual passes placeholder response',
        tags: ['N2YO-compatible API'],
        security: [{ proxyApiKey: [] }],
        parameters: [
          apiKeyParameter,
          integerPathParameter('satid', 'Satellite NORAD catalog ID.'),
          numericPathParameter('observerLat'),
          numericPathParameter('observerLng'),
          numericPathParameter('observerAlt'),
          integerPathParameter('days'),
          integerPathParameter('minVisibility')
        ],
        responses: {
          200: jsonResponse('N2YO-style visual passes response. Currently returns no passes.', { $ref: '#/components/schemas/PassesResponse' }),
          503: staleDataResponse,
          ...protectedResponses
        }
      }
    },
    '/rest/v1/satellite/radiopasses/{satid}/{observerLat}/{observerLng}/{observerAlt}/{days}/{minElevation}/': {
      get: {
        summary: 'Get radio passes placeholder response',
        tags: ['N2YO-compatible API'],
        security: [{ proxyApiKey: [] }],
        parameters: [
          apiKeyParameter,
          integerPathParameter('satid', 'Satellite NORAD catalog ID.'),
          numericPathParameter('observerLat'),
          numericPathParameter('observerLng'),
          numericPathParameter('observerAlt'),
          integerPathParameter('days'),
          integerPathParameter('minElevation')
        ],
        responses: {
          200: jsonResponse('N2YO-style radio passes response. Currently returns no passes.', { $ref: '#/components/schemas/PassesResponse' }),
          503: staleDataResponse,
          ...protectedResponses
        }
      }
    }
  }
};

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
