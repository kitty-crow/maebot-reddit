import { describe, expect, test } from 'vitest';
import { decode, execute, validate, wire, type Command } from './controller.ts';

describe('generic Devvit controller', () => {
  test('calls arbitrary methods and serialises returned model getters', async () => {
    class Model {
      readonly #value: string;

      public constructor(value: string) {
        this.#value = value;
      }

      public get id(): string {
        return this.#value;
      }

      public toJSON(): { readonly label: string } {
        return { label: 'model' };
      }
    }

    const command: Command = {
      id: 'test:1',
      root: 'reddit',
      steps: [{ kind: 'call', name: 'getThing', args: ['abc'] }],
    };

    expect(await execute(command, {
      reddit: {
        async getThing(id: string): Promise<Model> {
          return new Model(id);
        },
      },
      media: {},
    })).toEqual({ id: 'abc', label: 'model' });
  });

  test('navigates nested services, listings and selected objects generically', async () => {
    const command: Command = {
      id: 'test:2',
      root: 'reddit',
      steps: [
        { kind: 'get', name: 'messages' },
        { kind: 'call', name: 'all', args: [] },
        { kind: 'find', name: 'id', equals: 't4_b' },
        { kind: 'call', name: 'markAsRead', args: [] },
      ],
    };

    let marked = '';
    await execute(command, {
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

  test('round-trips bridge-only values', () => {
    const value = {
      when: new Date('2026-01-01T00:00:00.000Z'),
      bytes: new Uint8Array([1, 2, 3]),
      wide: 9_007_199_254_740_993n,
    };
    const encoded = wire(value);
    const decoded = decode(encoded) as {
      readonly when: Date;
      readonly bytes: Uint8Array;
      readonly wide: bigint;
    };
    expect(decoded.when.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect([...decoded.bytes]).toEqual([1, 2, 3]);
    expect(decoded.wide).toBe(9_007_199_254_740_993n);
  });

  test('rejects prototype traversal', () => {
    expect(() => validate({
      id: 'bad',
      root: 'reddit',
      steps: [{ kind: 'get', name: '__proto__' }],
    })).toThrow('Invalid command member');
  });
});
