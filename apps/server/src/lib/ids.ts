import { createHash, randomBytes } from 'node:crypto';

export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url')}`;

export const hashId = (prefix: string, ...parts: (string | number)[]) =>
  `${prefix}_${createHash('sha256').update(parts.join('\u0000')).digest('base64url').slice(0, 16)}`;
