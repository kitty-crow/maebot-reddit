import type { AdapterRoots } from './controller.ts';
import {
  handleLegacyRead,
  type LegacyCompatRequest,
  type LegacyCompatResponse,
} from './legacyCompat.ts';
import { handleLegacyMutation } from './legacyMutationCompat.ts';

export const handleLegacyCompat = async (
  request: LegacyCompatRequest,
  roots: AdapterRoots,
): Promise<LegacyCompatResponse> => {
  if (request.method === 'GET') return await handleLegacyRead(request, roots);
  return await handleLegacyMutation(request, roots);
};
