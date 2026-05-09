import type { RequestHandler } from 'express';

import type { ConfigService } from '../services/config.js';

export const proxyAuth = (config: ConfigService): RequestHandler => (req, res, next) => {
  const apiKey = typeof req.query.apiKey === 'string' ? req.query.apiKey : '';
  if (!apiKey || apiKey !== config.get().proxy_api_key) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
};
