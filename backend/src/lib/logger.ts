export const logger = {
  info: (msg: string, meta?: unknown) => console.log(`[info] ${msg}`, meta ?? ''),
  warn: (msg: string, meta?: unknown) => console.warn(`[warn] ${msg}`, meta ?? ''),
  error: (msg: string, meta?: unknown) => console.error(`[error] ${msg}`, meta ?? '')
};

export const errorToMeta = (error: unknown): Record<string, unknown> => {
  if (!error || typeof error !== 'object') return { message: String(error) };
  const maybe = error as { name?: unknown; message?: unknown; code?: unknown; stack?: unknown };
  return {
    name: typeof maybe.name === 'string' ? maybe.name : undefined,
    message: typeof maybe.message === 'string' ? maybe.message : String(error),
    code: typeof maybe.code === 'string' ? maybe.code : undefined,
    stack: typeof maybe.stack === 'string' ? maybe.stack : undefined
  };
};
