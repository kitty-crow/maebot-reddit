import { describe, expect, test } from 'bun:test';
import { scoreInventoryFullnames, voteMonitoringExpiresAt } from '../src/reputation/inventory.ts';
import type { JsonMap } from '../src/types/json.ts';

const contribution = (createdAt: number, extra: JsonMap = {}): JsonMap => ({
  fullname: 't1_alpha',
  author: 'Alice',
  createdAt,
  exempt: false,
  verdict: 'clean',
  ...extra,
});

const state = (value: JsonMap): JsonMap => ({
  schema: 1,
  users: {
    alice: { status: 'ordinary' },
  },
  contributions: {
    alpha: value,
  },
});

describe('Reddit vote monitoring inventory', () => {
  test('six month expiry uses calendar months from Reddit creation time', () => {
    const createdAt = Math.floor(Date.parse('2026-01-31T12:00:00Z') / 1_000);
    expect(voteMonitoringExpiresAt(createdAt))
      .toBe(Math.floor(Date.parse('2026-07-31T12:00:00Z') / 1_000));
  });

  test('clean content is sampled before its six month expiry and retired at expiry', () => {
    const createdAt = Math.floor(Date.parse('2026-02-23T10:00:00Z') / 1_000);
    const expiry = voteMonitoringExpiresAt(createdAt);
    expect(scoreInventoryFullnames(state(contribution(createdAt)), expiry - 1)).toEqual(['t1_alpha']);
    expect(scoreInventoryFullnames(state(contribution(createdAt)), expiry)).toEqual([]);
  });

  test('Reddit archived content is retired immediately', () => {
    const createdAt = Math.floor(Date.parse('2026-08-01T10:00:00Z') / 1_000);
    expect(scoreInventoryFullnames(state(contribution(createdAt, { archived: true })), createdAt + 60)).toEqual([]);
  });

  test('confirmed manipulation can permanently disable future vote credit for an item', () => {
    const createdAt = Math.floor(Date.parse('2026-08-01T10:00:00Z') / 1_000);
    expect(scoreInventoryFullnames(state(contribution(createdAt, { voteCreditDisabled: true })), createdAt + 60)).toEqual([]);
  });

  test('non-clean contributions never enter the vote inventory', () => {
    const createdAt = Math.floor(Date.parse('2026-08-01T10:00:00Z') / 1_000);
    expect(scoreInventoryFullnames(state(contribution(createdAt, { verdict: 'low' })), createdAt + 60)).toEqual([]);
  });
});
