import type { Json, JsonMap } from './json.ts';
import { isMap } from './json.ts';

export const mapVal = (v: Json | undefined, name: string): JsonMap => {
  if (!isMap(v)) throw new Error(`${name} must be an object`);
  return v;
};

export const arrVal = (v: Json | undefined, name: string): Json[] => {
  if (!Array.isArray(v)) throw new Error(`${name} must be an array`);
  return v;
};

export const strVal = (v: Json | undefined, name: string): string => {
  if (typeof v !== 'string') throw new Error(`${name} must be a string`);
  return v;
};

export const optStr = (v: Json | undefined): string | null => typeof v === 'string' ? v : null;

export const boolVal = (v: Json | undefined, name: string): boolean => {
  if (typeof v !== 'boolean') throw new Error(`${name} must be a boolean`);
  return v;
};

export const optBool = (v: Json | undefined): boolean | null => typeof v === 'boolean' ? v : null;

export const numVal = (v: Json | undefined, name: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a finite number`);
  return v;
};

export const optNum = (v: Json | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
