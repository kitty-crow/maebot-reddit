export type Wire =
  | null
  | boolean
  | number
  | string
  | Wire[]
  | { readonly [key: string]: Wire };

export type DecodedValue =
  | null
  | boolean
  | number
  | string
  | bigint
  | Date
  | Uint8Array
  | DecodedValue[]
  | Map<DecodedValue, DecodedValue>
  | { readonly [key: string]: DecodedValue };

type RuntimeCallable = (...args: DecodedValue[]) => RuntimeValue | Promise<RuntimeValue>;

export type RuntimeValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | bigint
  | symbol
  | object
  | RuntimeCallable;

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
  reddit: object;
  media: object;
}>;

type Budget = {
  nodes: number;
  bytes: number;
};

type WireMap = { readonly [key: string]: Wire };

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

const wireMap = (value: Wire, context: string): WireMap => {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${context} must be an object`);
  }
  return value;
};

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
    if (forbiddenMembers.has(key)) throw new Error('Invalid adapter object key');
    assertWire(child, state, depth + 1);
  }
};

export const parseJsonWire = (raw: string): Wire => {
  const parsed: Wire = JSON.parse(raw);
  assertWire(parsed, budget());
  return parsed;
};

export const parseAdapterCommand = (value: Wire): AdapterCommand => {
  const raw = wireMap(value, 'Adapter command');
  const id = raw['id'];
  const root = raw['root'];
  const rawSteps = raw['steps'];

  if (typeof id !== 'string') throw new Error('Adapter command id must be a string');
  if (root !== 'reddit' && root !== 'media') {
    throw new Error('Adapter command root must be reddit or media');
  }
  if (!Array.isArray(rawSteps)) throw new Error('Adapter command steps must be an array');

  const steps: AdapterStep[] = rawSteps.map((value, index) => {
    const step = wireMap(value, `Adapter step ${index}`);
    const name = step['name'];
    const kind = step['kind'];

    if (typeof name !== 'string') {
      throw new Error(`Adapter step ${index} name must be a string`);
    }
    if (kind === 'get') {
      return { kind: 'get', name };
    }
    if (kind === 'call') {
      const args = step['args'];
      if (!Array.isArray(args)) {
        throw new Error(`Adapter call step ${index} args must be an array`);
      }
      return { kind: 'call', name, args };
    }
    if (kind === 'find') {
      if (!Object.hasOwn(step, 'equals')) {
        throw new Error(`Adapter find step ${index} requires equals`);
      }
      const equals = step['equals'];
      if (equals === undefined) throw new Error(`Adapter find step ${index} requires equals`);
      return { kind: 'find', name, equals };
    }
    throw new Error(`Adapter step ${index} has an invalid kind`);
  });

  const command: AdapterCommand = { id, root, steps };
  validateCommand(command);
  return command;
};

export const validateCommand = (command: AdapterCommand): void => {
  if (!idPattern.test(command.id)) throw new Error('Invalid adapter command id');
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

const decodeWire = (value: Wire, depth = 0): DecodedValue => {
  if (depth > MAX_DEPTH) throw new Error('Adapter value exceeds maximum depth');
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'number'
    || typeof value === 'string'
  ) {
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

    const mapValue = value['$map'];
    if (Array.isArray(mapValue)) {
      if (mapValue.length > MAX_COLLECTION) throw new Error('Adapter map is too large');
      const entries: Array<[DecodedValue, DecodedValue]> = mapValue.map(entry => {
        if (!Array.isArray(entry) || entry.length !== 2) {
          throw new Error('Invalid adapter map entry');
        }
        const key = entry[0];
        const child = entry[1];
        if (key === undefined || child === undefined) {
          throw new Error('Invalid adapter map entry');
        }
        return [decodeWire(key, depth + 1), decodeWire(child, depth + 1)];
      });
      return new Map<DecodedValue, DecodedValue>(entries);
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, decodeWire(child, depth + 1)]),
  );
};

const isRuntimeArray = (value: RuntimeValue): value is RuntimeValue[] => Array.isArray(value);

const isRuntimeMap = (
  value: RuntimeValue,
): value is Map<RuntimeValue, RuntimeValue> => value instanceof Map;

const runtimeProperty = (target: object, key: string): RuntimeValue => {
  const value: RuntimeValue = Reflect.get(target, key);
  return value;
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

    const add = (key: string, child: RuntimeValue): void => {
      if (child === undefined || typeof child === 'function' || forbiddenMembers.has(key)) return;
      if (Object.hasOwn(out, key)) return;
      count += 1;
      if (count > MAX_COLLECTION) throw new Error('Adapter result object is too large');
      consume(state, stringBytes(key));
      out[key] = encodeWire(child, seen, state, depth + 1);
    };

    for (const key of Object.keys(value)) add(key, runtimeProperty(value, key));

    let prototype: object | null = Object.getPrototypeOf(value);
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
          add(key, runtimeProperty(value, key));
        } catch {
          // Optional Devvit model getters may legitimately be unavailable.
        }
      }
      prototype = Object.getPrototypeOf(prototype);
      prototypeDepth += 1;
    }
    return out;
  } finally {
    seen.delete(value);
  }
};

const encodeWire = (
  value: RuntimeValue,
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
  if (typeof value === 'symbol' || typeof value === 'function') {
    throw new Error(`Unsupported adapter result type: ${typeof value}`);
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
  if (isRuntimeArray(value)) {
    consume(state);
    if (value.length > MAX_COLLECTION) throw new Error('Adapter result array is too large');
    return value.map(child => encodeWire(child, seen, state, depth + 1));
  }
  if (isRuntimeMap(value)) {
    consume(state);
    if (value.size > MAX_COLLECTION) throw new Error('Adapter result map is too large');
    return {
      $map: [...value.entries()].map(([key, child]) => [
        encodeWire(key, seen, state, depth + 1),
        encodeWire(child, seen, state, depth + 1),
      ]),
    };
  }

  consume(state);
  return encodeObject(value, seen, state, depth);
};

export const encodeResult = (value: RuntimeValue): Wire =>
  encodeWire(value, new WeakSet<object>(), budget(), 0);

export const decodeValue = (value: Wire): DecodedValue => {
  assertWire(value, budget());
  return decodeWire(value);
};

const objectTarget = (value: RuntimeValue, member: string): object => {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) return value;
  throw new Error(`Cannot access ${member} on a non-object adapter value`);
};

const findProperty = (
  values: RuntimeValue[],
  name: string,
  expected: DecodedValue,
): RuntimeValue => {
  const found = values.find(item => {
    if (item === null || (typeof item !== 'object' && typeof item !== 'function')) return false;
    return Object.is(runtimeProperty(item, name), expected);
  });
  if (found === undefined) throw new Error(`No adapter item matched ${name}`);
  return found;
};

export const executeAdapterCommand = async (
  command: AdapterCommand,
  roots: AdapterRoots,
): Promise<Wire> => {
  validateCommand(command);
  let current: RuntimeValue = roots[command.root];

  for (const step of command.steps) {
    if (step.kind === 'find') {
      if (!isRuntimeArray(current)) throw new Error('Adapter find requires an array');
      current = findProperty(current, step.name, decodeValue(step.equals));
      continue;
    }

    const target = objectTarget(current, step.name);
    const member = runtimeProperty(target, step.name);

    if (step.kind === 'get') {
      current = member;
      continue;
    }

    if (typeof member !== 'function') throw new Error(`${step.name} is not callable`);
    const args = step.args.map(decodeValue);
    const result: RuntimeValue = await Reflect.apply(member, target, args);
    current = result;
  }

  return encodeResult(current);
};
