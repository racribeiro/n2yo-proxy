import { Router } from 'express';

import { HttpError } from '../lib/errors.js';
import { isVisibleFrom } from '../lib/visibility.js';
import type { AppContext } from '../services/context.js';

export const buildApiRouter = (ctx: AppContext): Router => {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.json(ctx.config.getPublic());
  });

  router.patch('/config', (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const patched = ctx.config.patch(body as any);
      res.json(patched);
    } catch (error) {
      next(error);
    }
  });

  router.get('/objects', async (req, res, next) => {
    try {
      const filters = {
        category: req.query.category as string | undefined,
        q: req.query.q as string | undefined,
        minAlt: req.query.minAlt ? Number(req.query.minAlt) : undefined,
        maxAlt: req.query.maxAlt ? Number(req.query.maxAlt) : undefined,
        owner: req.query.owner as string | undefined,
        country: req.query.country as string | undefined,
        satid: req.query.satid ? Number(req.query.satid) : undefined,
        launchDate: req.query.launchDate as string | undefined
      };

      let objects = ctx.catalog.list(filters);

      const visibilityMode = req.query.visibility as string | undefined;
      const locLat = req.query.locLat ? Number(req.query.locLat) : undefined;
      const locLng = req.query.locLng ? Number(req.query.locLng) : undefined;

      if (visibilityMode === 'home' || visibilityMode === 'location') {
        const lat = visibilityMode === 'home' ? ctx.config.get().home_location.latitude : locLat;
        const lng = visibilityMode === 'home' ? ctx.config.get().home_location.longitude : locLng;
        if (typeof lat !== 'number' || typeof lng !== 'number') throw new HttpError(400, 'location visibility filter requires coordinates');

        const filtered: typeof objects = [];
        for (const obj of objects) {
          const tle = await ctx.tle.getOrRefresh(obj.satid).catch(() => null);
          if (!tle) continue;
          if (isVisibleFrom(tle.line1, tle.line2, lat, lng, 0)) filtered.push(obj);
        }
        objects = filtered;
      }

      res.json({ count: objects.length, objects });
    } catch (error) {
      next(error);
    }
  });

  router.get('/status', (_req, res) => {
    const sweeper = ctx.sweeper.status();
    const lastFullSweepAt = sweeper.lastFullSweepAt;
    const maxAgeMs = ctx.config.get().full_sweep_max_age_hours * 3600 * 1000;
    const stale = !lastFullSweepAt || Date.now() - new Date(lastFullSweepAt).getTime() > maxAgeMs;
    res.json({
      ...sweeper,
      stale,
      requestBudgets: ctx.budget.snapshot(),
      tleCount: ctx.db.getAllTle().length,
      objectCount: ctx.catalog.list({}).length
    });
  });

  router.get('/sweeps', (_req, res) => {
    res.json({ sweeps: ctx.db.getSweeps(100) });
  });

  router.get('/categories', (_req, res) => {
    res.json({ categories: ctx.catalog.categories() });
  });

  router.get('/tle', async (_req, res) => {
    res.json({ tles: await ctx.tle.getAll() });
  });

  router.get('/tle/:satid', async (req, res, next) => {
    try {
      const satid = Number(req.params.satid);
      const tle = await ctx.tle.getOrRefresh(satid);
      res.json(tle);
    } catch (error) {
      next(error);
    }
  });

  router.post('/sweeps/run', async (_req, res, next) => {
    try {
      await ctx.sweeper.runSweepIfDue(true);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
