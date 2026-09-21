import type { RedditAuthCfg } from '../env.ts';
import type { DevvitRpcStep, DevvitWire } from './devvitRpc.ts';
import { DevvitRpcClient, DevvitRpcSpool } from './devvitRpc.ts';

export const devvitRpcClient = (cfg: RedditAuthCfg): DevvitRpcClient =>
  new DevvitRpcClient(new DevvitRpcSpool(cfg.devvitRpcStateFile), cfg.devvitRpcTimeoutMs);

export const redditCall = async (
  client: DevvitRpcClient,
  name: string,
  args: readonly DevvitWire[] = [],
): Promise<DevvitWire> => await client.call('reddit', [{ kind: 'call', name, args }]);

export const redditChain = async (
  client: DevvitRpcClient,
  steps: readonly DevvitRpcStep[],
): Promise<DevvitWire> => await client.call('reddit', steps);

export const mediaCall = async (
  client: DevvitRpcClient,
  name: string,
  args: readonly DevvitWire[] = [],
): Promise<DevvitWire> => await client.call('media', [{ kind: 'call', name, args }]);

export const wireMap = (value: DevvitWire, context: string): { readonly [key: string]: DevvitWire } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${context} did not return an object`);
  }
  return value;
};

export const wireArray = (value: DevvitWire, context: string): readonly DevvitWire[] => {
  if (!Array.isArray(value)) throw new Error(`${context} did not return an array`);
  return value;
};

export const wireText = (
  value: DevvitWire | undefined,
  context: string,
  fallback?: string,
): string => {
  if (typeof value === 'string') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${context} did not return text`);
};

export const wireMaybeText = (value: DevvitWire | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

export const wireNumber = (
  value: DevvitWire | undefined,
  context: string,
  fallback?: number,
): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${context} did not return a finite number`);
};

export const wireMaybeNumber = (value: DevvitWire | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const wireBoolean = (
  value: DevvitWire | undefined,
  context: string,
  fallback?: boolean,
): boolean => {
  if (typeof value === 'boolean') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${context} did not return a boolean`);
};

export const wireMaybeBoolean = (value: DevvitWire | undefined): boolean | null =>
  typeof value === 'boolean' ? value : null;

export const wireDateSeconds = (
  value: DevvitWire | undefined,
  context: string,
): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1_000) : Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1_000);
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const encoded = value['$date'];
    if (typeof encoded === 'string') {
      const parsed = Date.parse(encoded);
      if (Number.isFinite(parsed)) return Math.floor(parsed / 1_000);
    }
  }
  throw new Error(`${context} did not return a date`);
};

export const bareId = (value: string, prefix: 't1_' | 't2_' | 't3_' | 't4_' | 't5_'): string =>
  value.startsWith(prefix) ? value.slice(prefix.length) : value;

export const fullname = (value: string, prefix: 't1_' | 't2_' | 't3_' | 't4_' | 't5_'): string =>
  value.startsWith(prefix) ? value : `${prefix}${value}`;

export const bytesWire = (bytes: Uint8Array | ArrayBuffer): DevvitWire => ({
  $bytes: Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64'),
});
