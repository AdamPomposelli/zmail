const stamp = () => new Date().toISOString().slice(11, 23);

export const log = {
  info: (scope: string, ...args: unknown[]) => console.log(stamp(), `[${scope}]`, ...args),
  warn: (scope: string, ...args: unknown[]) => console.warn(stamp(), `[${scope}]`, ...args),
  error: (scope: string, ...args: unknown[]) => console.error(stamp(), `[${scope}]`, ...args),
};
