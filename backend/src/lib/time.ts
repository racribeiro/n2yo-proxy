export const nowIso = (): string => new Date().toISOString();

export const hoursAgo = (hours: number): Date => {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return d;
};
