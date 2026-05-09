import type { StaleDataErrorPayload } from '../types.js';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly payload?: unknown) {
    super(message);
  }
}

export class StaleDataError extends HttpError {
  constructor(message: string, details?: string) {
    const payload: StaleDataErrorPayload = {
      code: 'STALE_DATA_REFRESH_FAILED',
      message,
      details
    };
    super(503, message, payload);
  }
}
