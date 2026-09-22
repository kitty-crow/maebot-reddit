import { describe, expect, test } from 'vitest';
import {
  decodeValue,
  encodeResult,
  executeAdapterCommand,
  parseAdapterCommand,
  validateCommand,
  type AdapterCommand,
} from './controller.ts';

describe('generic Devvit Reddit adapter controller', () => {
  test('calls arbitrary root methods and serialises public getters', async () => {
    class Model {
      readonly #id: string;

      public constructor(id: string) {
        this.#id = id;
      }

      public get id(): string {
        return this.#id;
      }

      public get label(): string {
        return 'model';
      }

      public toJSON(): never {
        throw new Error('adapter must not invoke arbitrary toJSON hooks');
      }
    }

    const command: AdapterCommand = {
      id: 'test:1',
      root: 'reddit',
      steps: [{ kind: 'call', name: 'getThing', args: ['abc'] }],
    };

    expect(await executeAdapterCommand(command, {
      reddit: {
        async getThing(id: string): Promise<Model> {
          return new Model(id);
        },
      },
      media: {},
    })).toEqual({ id: 'abc', label: 'model' });
  });

  test('navigates nested services, listings and selected model methods', async () => {
    let marked = '';

    const command: AdapterCommand = {
      id: 'test:2',
      root: 'reddit',
      steps: [
        { kind: 'get', name: 'messages' },
        { kind: 'call', name: 'all', args: [] },
        { kind: 'find', name: 'id', equals: 't4_b' },
        { kind: 'call', name: 'markAsRead', args: [] },
      ],
    };

    await executeAdapterCommand(command, {
      reddit: {
        messages: {
          async all(): Promise<readonly object[]> {
            return [
              { id: 't4_a', async markAsRead(): Promise<void> { marked = 'a'; } },
              { id: 't4_b', async markAsRead(): Promise<void> { marked = 'b'; } },
            ];
          },
        },
      },
      media: {},
    });

    expect(marked).toBe('b');
  });

  test('round-trips adapter-only wire values without application types', () => {
    const original = {
      when: new Date('2026-01-01T00:00:00.000Z'),
      bytes: new Uint8Array([1, 2, 3]),
      wide: 9_007_199_254_740_993n,
      map: new Map([['a', 1]]),
    };

    const decoded = decodeValue(encodeResult(original)) as {
      readonly when: Date;
      readonly bytes: Uint8Array;
      readonly wide: bigint;
      readonly map: Map<string, number>;
    };

    expect(decoded.when.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect([...decoded.bytes]).toEqual([1, 2, 3]);
    expect(decoded.wide).toBe(9_007_199_254_740_993n);
    expect(decoded.map.get('a')).toBe(1);
  });

  test('parses generic JSON commands without trusting TypeScript casts', () => {
    expect(parseAdapterCommand({
      id: 'json:1',
      root: 'reddit',
      steps: [
        { kind: 'get', name: 'modMail' },
        { kind: 'call', name: 'getConversation', args: [{ conversationId: 'abc', markRead: false }] },
      ],
    })).toEqual({
      id: 'json:1',
      root: 'reddit',
      steps: [
        { kind: 'get', name: 'modMail' },
        { kind: 'call', name: 'getConversation', args: [{ conversationId: 'abc', markRead: false }] },
      ],
    });

    expect(() => parseAdapterCommand({
      id: 'bad',
      root: 'reddit',
      steps: [{ kind: 'call', name: 'getThing', args: 'not-an-array' }],
    })).toThrow('args must be an array');
  });

  test('rejects prototype traversal and unbounded commands', () => {
    expect(() => validateCommand({
      id: 'bad',
      root: 'reddit',
      steps: [{ kind: 'get', name: '__proto__' }],
    })).toThrow('Invalid adapter member');

    expect(() => validateCommand({
      id: 'too-many',
      root: 'reddit',
      steps: Array.from({ length: 17 }, () => ({ kind: 'get' as const, name: 'x' })),
    })).toThrow('Invalid adapter step count');
  });

  test('rejects cyclic results instead of walking arbitrary object graphs forever', () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(() => encodeResult(value)).toThrow('Adapter result contains a cycle');
  });

  test('rejects aggregate result growth even when individual fields are small', () => {
    const value = Array.from({ length: 10 }, () => 'x'.repeat(500_000));
    expect(() => encodeResult(value)).toThrow('Adapter value exceeds maximum wire size');
  });

  test('rejects malformed byte encodings', () => {
    expect(() => decodeValue({ $bytes: 'not base64!' })).toThrow('Invalid adapter byte encoding');
  });
});
