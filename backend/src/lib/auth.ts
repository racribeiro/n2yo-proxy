import type { RequestHandler } from 'express';

import { logger } from './logger.js';
import type { ConfigService } from '../services/config.js';

const normalizeApiKey = (value: string): string => {
  try {
    return decodeURIComponent(value).trim().replace(/\/+$/, '');
  } catch {
    return value.trim().replace(/\/+$/, '');
  }
};

const extractApiKeyFromUrl = (url: string): string => {
  const suffixIdx = url.indexOf('/&apiKey=');
  if (suffixIdx >= 0) {
    const raw = url.slice(suffixIdx + '/&apiKey='.length).split(/[?&]/, 1)[0];
    return normalizeApiKey(raw);
  }

  const match = url.match(/[?&]apiKey=([^&]+)/);
  if (!match) return '';
  return normalizeApiKey(match[1]);
};

const extractApiKeyFromQuery = (queryValue: unknown): string => {
  if (typeof queryValue !== 'string') return '';
  return normalizeApiKey(queryValue);
};

export const proxyAuth = (config: ConfigService): RequestHandler => (req, res, next) => {
  const queryApiKey = extractApiKeyFromQuery(req.query.apiKey);
  const rawUrl = req.originalUrl || req.url || '';
  const rawUrlApiKey = extractApiKeyFromUrl(rawUrl);
  const apiKey = queryApiKey || rawUrlApiKey;
  const expected = normalizeApiKey(config.get().proxy_api_key);
  if (!apiKey || apiKey !== expected) {
    logger.warn('proxy auth unauthorized', {
      method: req.method,
      path: req.path,
      hasQueryApiKey: Boolean(queryApiKey),
      hasRawUrlApiKey: Boolean(rawUrlApiKey)
    });
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
};
