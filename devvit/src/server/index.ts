import { media, reddit, settings, type TaskResponse } from '@devvit/web/server';
import type { OnCommentSubmitRequest, TriggerResponse } from '@devvit/web/shared';
import { Hono } from 'hono';

type Wire =
  | null
  | boolean
  | number
  | string
  | Wire[]
  | { readonly [key: string]: Wire };

type Step =
  | { readonly kind: 'get'; readonly name: string }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly Wire[] };

type Command = {
  readonly id: string;
  readonly root: 'reddit' | 'media';
  readonly steps: readonly Step[];
};

type Work = {
  readonly commands: readonly Command[];
};

type Result = {
  readonly id: string;
  readonly ok: boolean;
  readonly value?: Wire;
  readonly error?: string;
};

const app = new Hono();
const ingress = 'https://mae.kittycrow.dev/v1/devvit';
const namePattern = /^[A-Za-z][A-Za-z0-9_]*$/u;
const idPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

const secret = async (): Promise<string> => {
  const value = await settings.get<string>('maeBridgeSecret');
  if (value === undefined || value.trim().length < 32) {
    throw new Error('maeBridgeSecret is not configured');
  }
  return value.trim();
};

const wire = (value: unknown): Wire => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite number cannot cross the Mae bridge');
    return value;
  }
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (value instanceof Uint8Array) {
    return { $bytes: Buffer.from(value).toString('base64') };
  }
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
          // A generic bridge must not fail because one optional model getter is unavailable.
        }
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    return out;
  }
  throw new Error(`Unsupported bridge value: ${typeof value}`);
};

const decode = (value: Wire): unknown => {
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

const validate = (command: Command): void => {
  if (!idPattern.test(command.id)) throw new Error('Invalid command id');
  if (command.root !== 'reddit' && command.root !== 'media') throw new Error('Invalid command root');
  if (!Array.isArray(command.steps) || command.steps.length < 1 || command.steps.length > 16) {
    throw new Error('Invalid command steps');
  }
  for (const step of command.steps) {
    if (!namePattern.test(step.name) || step.name === '__proto__' || step.name === 'prototype' || step.name === 'constructor') {
      throw new Error('Invalid command member');
    }
    if (step.kind !== 'get' && step.kind !== 'call') throw new Error('Invalid command step');
    if (step.kind === 'call' && !Array.isArray(step.args)) throw new Error('Invalid command arguments');
  }
};

const execute = async (command: Command): Promise<Wire> => {
  validate(command);
  let current: unknown = command.root === 'reddit' ? reddit : media;

  for (const step of command.steps) {
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) {
      throw new Error(`Cannot access ${step.name} on a non-object bridge value`);
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

const request = async (path: '/work' | '/result', init?: RequestInit): Promise<Response> => {
  const token = await secret();
  return await fetch(`${ingress}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
};

const poll = async (): Promise<void> => {
  const response = await request('/work');
  if (!response.ok) throw new Error(`Mae ingress work request failed with HTTP ${response.status}`);
  const work = await response.json() as Work;
  if (!Array.isArray(work.commands)) throw new Error('Mae ingress returned invalid work');

  for (const command of work.commands) {
    let result: Result;
    try {
      result = { id: command.id, ok: true, value: await execute(command) };
    } catch (error) {
      result = {
        id: command.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const submitted = await request('/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(result),
    });
    if (!submitted.ok) {
      throw new Error(`Mae ingress result submission failed with HTTP ${submitted.status}`);
    }
  }
};

app.post('/internal/triggers/comment-submit', async c => {
  const input = await c.req.json<OnCommentSubmitRequest>();
  const submitted = await request('/event/comment', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(input),
  });
  if (!submitted.ok) {
    throw new Error(`Mae ingress comment submission failed with HTTP ${submitted.status}`);
  }
  return c.json<TriggerResponse>({ status: 'ok' });
});

app.post('/internal/scheduler/mae-reddit-rpc', async c => {
  await poll();
  return c.json<TaskResponse>({ status: 'ok' });
});

export default app;
