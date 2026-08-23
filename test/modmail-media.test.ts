import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModmailMediaService } from '../src/modmail/media/service.ts';
import { ModmailMediaStore } from '../src/modmail/media/store.ts';
import { ModmailStore } from '../src/modmail/store.ts';
import type { ModmailConversation } from '../src/modmail/types.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const conversation = (id: string, state: ModmailConversation['state'] = 'inprogress'): ModmailConversation => ({
  id,
  subreddit: 'catgirlcoin',
  subject: 'Media test',
  participant: {
    id: 'u1',
    name: 'SomeUser',
    isModerator: false,
    isAdmin: false,
    isParticipant: true,
    isHidden: false,
    isDeleted: false,
  },
  kind: 'sr_user',
  state,
  isInternal: false,
  isAuto: false,
  lastUpdatedAt: 100,
  messages: [{
    id: `m-${id}`,
    conversationId: id,
    author: {
      id: 'u1',
      name: 'SomeUser',
      isModerator: false,
      isAdmin: false,
      isParticipant: true,
      isHidden: false,
      isDeleted: false,
    },
    bodyMarkdown: 'Hello',
    createdAt: 100,
    isInternal: false,
    participatingAs: 'participant_user',
  }],
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-modmail-media-'));
  roots.push(root);
  const conversations = new ModmailStore(join(root, 'modmail.pb'));
  await conversations.sync([conversation('abc123'), conversation('other123')], 100);
  const uploads: { name: string; mimeType: string; bytes: number }[] = [];
  const service = new ModmailMediaService(
    conversations,
    {
      uploadMedia: async (name, mimeType, bytes) => {
        uploads.push({ name, mimeType, bytes: bytes.byteLength });
        return `https://reddit-uploaded-media.s3-accelerate.amazonaws.com/${encodeURIComponent(name)}`;
      },
    },
    new ModmailMediaStore(join(root, 'media.pb')),
  );
  return { service, uploads };
};

test('Modmail media is uploaded once and durably scoped to its exact conversation', async () => {
  const { service, uploads } = await fixture();
  const attachment = await service.upload({
    conversationId: 'abc123',
    name: 'context image.png',
    mimeType: 'image/png',
    bytes: new Uint8Array([1, 2, 3]),
  });
  expect(uploads).toEqual([{ name: 'context image.png', mimeType: 'image/png', bytes: 3 }]);
  expect(attachment.kind).toBe('image');
  expect((await service.resolve('abc123', [attachment.id]))[0]?.id).toBe(attachment.id);
  await expect(service.resolve('other123', [attachment.id])).rejects.toThrow('Unknown Modmail attachment');
});

test('Modmail media rejects unsupported types, oversized files and too many attachment references', async () => {
  const { service } = await fixture();
  await expect(service.upload({
    conversationId: 'abc123',
    name: 'note.txt',
    mimeType: 'text/plain',
    bytes: new Uint8Array([1]),
  })).rejects.toThrow('Unsupported Modmail media type');
  await expect(service.upload({
    conversationId: 'abc123',
    name: 'large.mp4',
    mimeType: 'video/mp4',
    bytes: new Uint8Array(20 * 1024 * 1024 + 1),
  })).rejects.toThrow('between 1 byte and 20 MB');
  await expect(service.resolve('abc123', Array.from({ length: 9 }, (_, index) => `id-${index}`)))
    .rejects.toThrow('at most 8');
});
