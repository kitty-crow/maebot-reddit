export type Wire =
  | null
  | boolean
  | number
  | string
  | Wire[]
  | { readonly [key: string]: Wire };

export type AdapterStep =
  | { readonly kind: 'get'; readonly name: string }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly Wire[] }
  | { readonly kind: 'find'; readonly name: string; readonly equals: Wire };

export type AdapterCommand = {
  readonly id: string;
  readonly root: 'reddit' | 'media';
  readonly steps: readonly AdapterStep[];
};

export type AdapterRoots = Readonly<{
  reddit: unknown;
  media: unknown;
}>;

type Budget = {
  nodes: number;
  bytes: number;
};

const MAX_STEPS = 16;
const MAX_ARGS = 32;
const MAX_DEPTH = 16;
const MAX_COLLECTION = 2_000;
const MAX_STRING = 1_000_000;
const MAX_RAW_BYTES = 3 * 1024 * 1024;
const MAX_WIRE_BYTES = 4 * 1024 * 1024;
const MAX_NODES = 50_000;
const MAX_PROTOTYPE_DEPTH = 8;

const memberPattern = /^[A-Za-z][A-Za-z0-9_]*$/u;
const idPattern = /^[A-Za-z0-9._:-]{1,128}$/u;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const forbiddenMembers = new Set(['__proto__', 'prototype', 'constructor']);

const budget = (): Budget => ({ nodes: 0, bytes: 0 });

const consume = (state: Budget, bytes = 0): void => {
  state.nodes += 1;
  state.bytes += bytes;
  if (state.nodes > MAX_NODES) throw new Error('Adapter value has too many nodes');
  if (state.bytes > MAX_WIRE_BYTES) throw new Error('Adapter value exceeds maximum wire size');
};

const stringBytes = (value: string): number => Buffer.byteLength(value, 'utf8');

const assertMember = (name: string): void => {
  if (!memberPattern.test(name) || forbiddenMembers.has(name)) {
    throw new Error('Invalid adapter member');
  }
};

const assertWire = (value: Wire, state: Budget, depth = 0): void => {
  if (depth > MAX_DEPTH) throw new Error('Adapter value exceeds maximum depth');
  if (value === null || typeof value === 'boolean') {
    consume(state);
    return;
  }
  if (typeof value === 'number') {
    consume(state, 8);
    if (!Number.isFinite(value)) throw new Error('Adapter number must be finite');
    return;
  }
  if (typeof value === 'string') {
    const bytes = stringBytes(value);
    consume(state, bytes);
    if (value.length > MAX_STRING) throw new Error('Adapter string is too large');
    return;
  }
  if (Array.isArray(value)) {
    consume(state);
    if (value.length > MAX_COLLECTION) throw new Error('Adapter array is too large');
    for (const child of value) assertWire(child, state, depth + 1);
    return;
  }
  consume(state);
  const entries = Object.entries(value);
  if (entries.length > MAX_COLLECTION) throw new Error('Adapter object is too large');
  for (const [key, child] of entries) {
    consume(state, stringBytes(key));
    if (key.length > 256) throw new Error('Adapter object key is too large');
    assertWire(child, state, depth + 1);
  }
};

export const validateCommand = (command: AdapterCommand): void => {
  if (!idPattern.test(command.id)) throw new Error('Invalid adapter command id');
  if (command.root !== 'reddit' && command.root !== 'media') {
    throw new Error('Invalid adapter root');
  }
  if (command.steps.length < 1 || command.steps.length > MAX_STEPS) {
    throw new Error('Invalid adapter step count');
  }

  const state = budget();
  for (const step of command.steps) {
    assertMember(step.name);
    consume(state, stringBytes(step.name));
    if (step.kind === 'call') {
      if (step.args.length > MAX_ARGS) throw new Error('Adapter call has too many arguments');
      for (const arg of step.args) assertWire(arg, state);
    } else if (step.kind === 'find') {
      assertWire(step.equals, state);
    }
  }
};

const decodeWire = (value: Wire, depth = 0): unknown => {
  if (depth > MAX_DEPTH) throw new Error('Adapter value exceeds maximum depth');
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) return value.map(child => decodeWire(child, depth + 1));

  const keys = Object.keys(value);
  if (keys.length === 1) {
    const bytes = value['$bytes'];
    if (typeof bytes === 'string') {
      if (!base64Pattern.test(bytes)) throw new Error('Invalid adapter byte encoding');
      const decoded = Uint8Array.from(Buffer.from(bytes, 'base64'));
      if (decoded.byteLength > MAX_RAW_BYTES) throw new Error('Adapter byte payload is too large');
      return decoded;
    }
    const wide = value['$bigint'];
    if (typeof wide === 'string' && /^-?\d+$/u.test(wide)) return BigInt(wide);
    const date = value['$date'];
    if (typeof date === 'string') {
      const parsed = new Date(date);
      if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid adapter date');
      return parsed;
    }
    const map = value['$map'];
    if (Array.isArray(map)) {
      if (map.length > MAX_COLLECTION) throw new Error('Adapter map is too large');
      return new Map(map.map(entry => {
        if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Invalid adapter map entry');
        return [decodeWire(entry[0] as Wire, depth + 1), decodeWire(entry[1] as Wire, depth + 1)];
      }));
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, decodeWire(child, depth + 1)]),
  );
};

const encodeObject = (
  value: object,
  seen: WeakSet<object>,
  state: Budget,
  depth: number,
): { readonly [key: string]: Wire } => {
  if (seen.has(value)) throw new Error('Adapter result contains a cycle');
  seen.add(value);
  try {
    const out: Record<string, Wire> = {};
    let count = 0;

    const add = (key: string, child: unknown): void => {
      if (child === undefined || typeof child === 'function' || key === 'constructor') return;
      if (Object.hasOwn(out, key)) return;
      count += 1;
      if (count > MAX_COLLECTION) throw new Error('Adapter result object is too large');
      consume(state, stringBytes(key));
      out[key] = encodeWire(child, seen, state, depth + 1);
    };

    for (const key of Object.keys(value)) add(key, Reflect.get(value, key));

    let prototype = Object.getPrototypeOf(value) as object | null;
    let prototypeDepth = 0;
    while (
      prototype !== null
      && prototype !== Object.prototype
      && prototypeDepth < MAX_PROTOTYPE_DEPTH
    ) {
      for (const key of Object.getOwnPropertyNames(prototype)) {
        if (forbiddenMembers.has(key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
        if (descriptor?.get === undefined) continue;
        try {
          add(key, Reflect.get(value, key));
        } catch {
          // Optional Devvit model getters may legitimately be unavailable.
        }
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
      prototypeDepth += 1;
    }
    return out;
  } finally {
    seen.delete(value);
  }
};

const encodeWire = (
  value: unknown,
  seen: WeakSet<object>,
  state: Budget,
  depth: number,
): Wire => {
  if (depth > MAX_DEPTH) throw new Error('Adapter result exceeds maximum depth');
  if (value === undefined || value === null) {
    consume(state);
    return null;
  }
  if (typeof value === 'boolean') {
    consume(state);
    return value;
  }
  if (typeof value === 'string') {
    const bytes = stringBytes(value);
    consume(state, bytes);
    if (value.length > MAX_STRING) throw new Error('Adapter result string is too large');
    return value;
  }
  if (typeof value === 'number') {
    consume(state, 8);
    if (!Number.isFinite(value)) throw new Error('Adapter result number must be finite');
    return value;
  }
  if (typeof value === 'bigint') {
    const encoded = value.toString();
    consume(state, stringBytes(encoded));
    return { $bigint: encoded };
  }
  if (value instanceof Date) {
    const encoded = value.toISOString();
    consume(state, stringBytes(encoded));
    return { $date: encoded };
  }
  if (value instanceof Uint8Array) {
    if (value.byteLength > MAX_RAW_BYTES) throw new Error('Adapter result byte payload is too large');
    const encoded = Buffer.from(value).toString('base64');
    consume(state, stringBytes(encoded));
    return { $bytes: encoded };
  }
  if (Array.isArray(value)) {
    consume(state);
    if (value.length > MAX_COLLECTION) throw new Error('Adapter result array is too large');
    return value.map(child => encodeWire(child, seen, state, depth + 1));
  }
  if (value instanceof Map) {
    consume(state);
    if (value.size > MAX_COLLECTION) throw new Error('Adapter result map is too large');
    return {
      $map: [...value.entries()].map(([key, child]) => [
        encodeWire(key, seen, state, depth + 1),
        encodeWire(child, seen, state, depth + 1),
      ]),
    };
  }
  if (typeof value === 'object') {
    consume(state);
    return encodeObject(value, seen, state, depth);
  }
  throw new Error(`Unsupported adapter result type: ${typeof value}`);
};

export const encodeResult = (value: unknown): Wire =>
  encodeWire(value, new WeakSet<object>(), budget(), 0);

export const decodeValue = (value: Wire): unknown => {
  assertWire(value, budget());
  return decodeWire(value);
};

export const executeAdapterCommand = async (
  command: AdapterCommand,
  roots: AdapterRoots,
): Promise<Wire> => {
  validateCommand(command);
  let current: unknown = roots[command.root];

  for (const step of command.steps) {
    if (
      current === null
      || (typeof current !== 'object' && typeof current !== 'function')
    ) {
      throw new Error(`Cannot access ${step.name} on a non-object adapter value`);
    }

    if (step.kind === 'find') {
      if (!Array.isArray(current)) throw new Error('Adapter find requires an array');
      const expected = decodeValue(step.equals);
      const found = current.find(item =>
        item !== null
        && (typeof item === 'object' || typeof item === 'function')
        && Object.is(Reflect.get(item, step.name), expected));
      if (found === undefined) throw new Error(`No adapter item matched ${step.name}`);
      current = found;
      continue;
    }

    const member = Reflect.get(current, step.name);
    if (step.kind === 'get') {
      current = member;
      continue;
    }

    if (typeof member !== 'function') throw new Error(`${step.name} is not callable`);
    current = await Reflect.apply(member, current, step.args.map(decodeValue));
  }

  return encodeResult(current);
};
