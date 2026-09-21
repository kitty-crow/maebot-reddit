export type Wire =
  | null
  | boolean
  | number
  | string
  | Wire[]
  | { readonly [key: string]: Wire };

export type Step =
  | { readonly kind: 'get'; readonly name: string }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly Wire[] }
  | { readonly kind: 'find'; readonly name: string; readonly equals: Wire };

export type Command = {
  readonly id: string;
  readonly root: 'reddit' | 'media';
  readonly steps: readonly Step[];
};

const namePattern = /^[A-Za-z][A-Za-z0-9_]*$/u;
const idPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

export const wire = (value: unknown): Wire => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite number cannot cross the Mae bridge');
    return value;
  }
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(wire);
  if (value instanceof Map) {
    return { $map: [...value.entries()].map(([key, child]) => [wire(key), wire(child)]) };
  }
  if (typeof value === 'object') {
    const out: { [key: string]: Wire } = {};
    const toJSON = Reflect.get(value, 'toJSON');
    if (typeof toJSON === 'function') {
      const encoded = wire(Reflect.apply(toJSON, value, []));
      if (typeof encoded === 'object' && encoded !== null && !Array.isArray(encoded)) {
        Object.assign(out, encoded);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined && typeof child !== 'function') out[key] = wire(child);
    }
    let prototype = Object.getPrototypeOf(value) as object | null;
    while (prototype !== null && prototype !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(prototype)) {
        if (key === 'constructor' || out[key] !== undefined) continue;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
        if (descriptor?.get === undefined) continue;
        try {
          const child = Reflect.get(value, key);
          if (child !== undefined && typeof child !== 'function') out[key] = wire(child);
        } catch {
          // One unavailable optional model getter must not break the generic controller.
        }
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    return out;
  }
  throw new Error(`Unsupported bridge value: ${typeof value}`);
};

export const decode = (value: Wire): unknown => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) return value.map(decode);
  const bytes = value['$bytes'];
  if (typeof bytes === 'string' && Object.keys(value).length === 1) {
    return Uint8Array.from(Buffer.from(bytes, 'base64'));
  }
  const wide = value['$bigint'];
  if (typeof wide === 'string' && Object.keys(value).length === 1) return BigInt(wide);
  const date = value['$date'];
  if (typeof date === 'string' && Object.keys(value).length === 1) return new Date(date);
  const map = value['$map'];
  if (Array.isArray(map) && Object.keys(value).length === 1) {
    return new Map(map.map(entry => {
      if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Invalid bridge map entry');
      return [decode(entry[0] as Wire), decode(entry[1] as Wire)];
    }));
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decode(child)]));
};

export const validate = (command: Command): void => {
  if (!idPattern.test(command.id)) throw new Error('Invalid command id');
  if (command.root !== 'reddit' && command.root !== 'media') throw new Error('Invalid command root');
  if (command.steps.length < 1 || command.steps.length > 16) throw new Error('Invalid command steps');
  for (const step of command.steps) {
    if (
      !namePattern.test(step.name)
      || step.name === '__proto__'
      || step.name === 'prototype'
      || step.name === 'constructor'
    ) throw new Error('Invalid command member');
  }
};

export const execute = async (
  command: Command,
  roots: Readonly<{ reddit: unknown; media: unknown }>,
): Promise<Wire> => {
  validate(command);
  let current: unknown = roots[command.root];

  for (const step of command.steps) {
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) {
      throw new Error(`Cannot access ${step.name} on a non-object bridge value`);
    }
    if (step.kind === 'find') {
      if (!Array.isArray(current)) throw new Error('find requires an array bridge value');
      const expected = decode(step.equals);
      const found = current.find(item =>
        (typeof item === 'object' || typeof item === 'function')
        && item !== null
        && Object.is(Reflect.get(item, step.name), expected));
      if (found === undefined) throw new Error(`No bridge item matched ${step.name}`);
      current = found;
      continue;
    }
    const member = Reflect.get(current, step.name);
    if (step.kind === 'get') {
      current = member;
      continue;
    }
    if (typeof member !== 'function') throw new Error(`${step.name} is not callable`);
    current = await Reflect.apply(member, current, step.args.map(decode));
  }

  return wire(current);
};
