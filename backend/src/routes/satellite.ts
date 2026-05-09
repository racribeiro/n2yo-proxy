import { Router } from 'express';

import type { AppContext } from '../services/context.js';

export const buildSatelliteRouter = (ctx: AppContext): Router => {
  const router = Router();

  router.get('/above/:observerLat/:observerLng/:observerAlt/:searchRadius/:categoryId/', async (req, res, next) => {
    try {
      const observerLat = Number(req.params.observerLat);
      const observerLng = Number(req.params.observerLng);
      const observerAlt = Number(req.params.observerAlt);
      const searchRadius = Number(req.params.searchRadius);
      const categoryId = Number(req.params.categoryId);

      const all = ctx.catalog.list({});
      const filtered = all.filter((o) => typeof o.satlat === 'number' && typeof o.satlng === 'number').slice(0, 5000);

      res.json({
        info: {
          category: categoryId,
          transactionscount: filtered.length,
          observer: { observerLat, observerLng, observerAlt, searchRadius }
        },
        above: filtered.map((obj) => ({
          satid: obj.satid,
          satname: obj.satname,
          satlat: obj.satlat,
          satlng: obj.satlng,
          satalt: obj.satalt
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/tle/:satid', async (req, res, next) => {
    try {
      const satid = Number(req.params.satid);
      const tle = await ctx.tle.getOrRefresh(satid);
      res.json({
        info: { satid: tle.satid, satname: tle.satname },
        tle: `${tle.line1}\r\n${tle.line2}`
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/positions/:satid/:observerLat/:observerLng/:observerAlt/:seconds/', async (req, res, next) => {
    try {
      const payload = await ctx.tle.computePositions({
        satid: Number(req.params.satid),
        observerLat: Number(req.params.observerLat),
        observerLng: Number(req.params.observerLng),
        observerAlt: Number(req.params.observerAlt),
        seconds: Number(req.params.seconds)
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get('/visualpasses/:satid/:observerLat/:observerLng/:observerAlt/:days/:minVisibility/', async (req, res, next) => {
    try {
      const payload = await ctx.tle.computeVisualPasses({
        satid: Number(req.params.satid),
        observerLat: Number(req.params.observerLat),
        observerLng: Number(req.params.observerLng),
        observerAlt: Number(req.params.observerAlt),
        days: Number(req.params.days),
        minVisibility: Number(req.params.minVisibility)
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get('/radiopasses/:satid/:observerLat/:observerLng/:observerAlt/:days/:minElevation/', async (req, res, next) => {
    try {
      const payload = await ctx.tle.computeRadioPasses({
        satid: Number(req.params.satid),
        observerLat: Number(req.params.observerLat),
        observerLng: Number(req.params.observerLng),
        observerAlt: Number(req.params.observerAlt),
        days: Number(req.params.days),
        minElevation: Number(req.params.minElevation)
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  return router;
};
