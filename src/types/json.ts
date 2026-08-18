export type Json = null | boolean | number | string | Json[] | JsonMap;

export type JsonMap = {
  [key: string]: Json;
};

const max = BigInt(Number.MAX_SAFE_INTEGER);
const min = BigInt(Number.MIN_SAFE_INTEGER);
const digit = (c: string): boolean => c >= '0' && c <= '9';

const quoteWideInts = (raw: string): string => {
  let out = '';
  let quoted = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (c === undefined) break;
    if (quoted) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      out += c;
      continue;
    }
    if (c !== '-' && !digit(c)) {
      out += c;
      continue;
    }
    let j = i + 1;
    while (j < raw.length) {
      const x = raw[j];
      if (x === undefined || !/[0-9eE+.\-]/u.test(x)) break;
      j += 1;
    }
    const token = raw.slice(i, j);
    if (/^-?\d+$/u.test(token)) {
      const n = BigInt(token);
      out += n > max || n < min ? JSON.stringify(token) : token;
    } else out += token;
    i = j - 1;
  }
  return out;
};

export const isMap = (v: Json | undefined): v is JsonMap =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const parseJson = (raw: string): Json => JSON.parse(quoteWideInts(raw)) as Json;

export const parseMap = (raw: string): JsonMap => {
  const value = parseJson(raw);
  if (!isMap(value)) throw new Error('JSON root must be an object');
  return value;
};

export const clone = (v: Json): Json => JSON.parse(JSON.stringify(v)) as Json;
