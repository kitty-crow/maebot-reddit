import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const source = async (path: string): Promise<string> => await readFile(path, 'utf8');

test('focused Modmail page uses static TSX rendering without a browser React runtime', async () => {
  const view = await source('src/modmail/terminalPageView.tsx');
  const staticUi = await source('src/modmail/web/staticUi.tsx');
  const runtime = await source('src/modmail/web/runtime.ts');
  const packageJson = await source('package.json');
  expect(view).toContain("from './web/staticUi.tsx'");
  expect(view).toContain('render2Mkup(');
  expect(staticUi).toContain("from 'react-dom/server'");
  expect(staticUi).toContain('renderToStaticMarkup');
  expect(packageJson).toContain('"react": "19.2.4"');
  expect(packageJson).toContain('"react-dom": "19.2.4"');
  expect(runtime).not.toContain('hydrateRoot');
  expect(runtime).not.toContain('createRoot');
});

test('focused Modmail page is mobile-first and prevents iOS form zoom', async () => {
  const view = await source('src/modmail/terminalPageView.tsx');
  const styles = await source('src/modmail/web/styles.ts');
  expect(view).toContain('maximum-scale=1,user-scalable=no,viewport-fit=cover');
  expect(styles).toContain('font-size: 16px;');
  expect(styles).toContain('env(safe-area-inset-top)');
  expect(styles).toContain('env(safe-area-inset-bottom)');
  expect(styles).toContain('@media (max-width: 520px)');
});

test('focused Modmail is exactly viewport-height with only the conversation scrolling', async () => {
  const viewport = await source('src/modmail/web/viewport.ts');
  const scroll = await source('src/modmail/web/scroll.ts');
  expect(viewport).toContain('height: 100vh;');
  expect(viewport).toContain('height: 100dvh;');
  expect(viewport).toContain('overflow: hidden;');
  expect(viewport).toContain('grid-template-rows: auto minmax(0, 1fr) auto;');
  expect(viewport).toContain('.messages {');
  expect(viewport).toContain('overflow-y: auto;');
  expect(viewport).toContain('min-height: 0;');
  expect(scroll).toContain('new MutationObserver');
  expect(scroll).toContain('new ResizeObserver');
  expect(scroll).toContain("toBottom('auto')");
  expect(scroll).toContain('messages.scrollHeight');
});

test('mobile header is compact app chrome rather than dashboard tiles', async () => {
  const viewport = await source('src/modmail/web/viewport.ts');
  expect(viewport).toContain('.terminal-header {');
  expect(viewport).toContain('padding: 7px 8px;');
  expect(viewport).toContain('grid-template-columns: auto auto minmax(0, 1fr);');
  expect(viewport).toContain('background: transparent;');
  expect(viewport).toContain('text-overflow: ellipsis;');
});

test('focused Modmail theme follows system preference and persists an explicit override', async () => {
  const theme = await source('src/modmail/web/theme.ts');
  const styles = await source('src/modmail/web/styles.ts');
  expect(theme).toContain("matchMedia('(prefers-color-scheme: dark)')");
  expect(theme).toContain('localStorage.getItem(key)');
  expect(theme).toContain('localStorage.setItem(key, current)');
  expect(styles).toContain(':root[data-theme="dark"]');
  expect(styles).toContain('@media (prefers-color-scheme: dark)');
});

test('focused Modmail conversation uses purple user bubbles and pink moderator bubbles', async () => {
  const bubbles = await source('src/modmail/web/bubbles.ts');
  expect(bubbles).toContain('--user-bubble: linear-gradient');
  expect(bubbles).toContain('--mod-bubble: linear-gradient');
  expect(bubbles).toContain('.message-wrapper.participant');
  expect(bubbles).toContain('align-self: flex-start');
  expect(bubbles).toContain('.message-wrapper.moderator');
  expect(bubbles).toContain('align-self: flex-end');
  expect(bubbles).toContain('border-bottom-left-radius');
  expect(bubbles).toContain('border-bottom-right-radius');
  expect(bubbles).toContain(':root[data-theme="dark"]');
});

test('preview is a busy read-only visual QA thread with app metadata, media and Lorem Ipsum stress text', async () => {
  const runtime = await source('src/modmail/web/runtime.ts');
  expect(runtime).toContain("sender: 'u/ExampleUser', origin: 'Reddit'");
  expect(runtime).toContain("sender: '@AliceMod', origin: 'Discord'");
  expect(runtime).toContain("sender: '@KarlaMod', origin: 'Telegram'");
  expect(runtime).toContain("side: 'internal'");
  expect(runtime).toContain('Lorem ipsum dolor sit amet');
  expect(runtime).toContain('Supercalifragilisticexpialidocious-very-long-token-example');
  expect(runtime).toContain('Consecutive moderator message for spacing.');
  expect(runtime).toContain("kind: 'image'");
  expect(runtime).toContain('Mock Modmail image');
  expect(runtime).toContain('Preview only · replies are disabled');
  expect(runtime).toContain('Synthetic read-only preview. Nothing here can reach Reddit.');
});

test('bubble metadata renders sender, app, timestamp and trusted media separately from message body', async () => {
  const runtime = await source('src/modmail/web/runtime.ts');
  const media = await source('src/modmail/web/media.ts');
  expect(runtime).toContain("message.sender + ' · ' + message.origin");
  expect(runtime).toContain('new Date(message.createdAt * 1000).toLocaleString()');
  expect(runtime).toContain("time.className = 'timestamp'");
  expect(runtime).toContain("body.textContent = message.bodyMarkdown || ''");
  expect(runtime).toContain('media.renderMessageAttachments');
  expect(media).toContain("image.loading = 'lazy'");
  expect(media).toContain('video.controls = true');
});

test('focused Modmail composer uploads selected media before queueing attachment ids', async () => {
  const view = await source('src/modmail/terminalPageView.tsx');
  const runtime = await source('src/modmail/web/runtime.ts');
  const media = await source('src/modmail/web/media.ts');
  expect(view).toContain('id="media-picker"');
  expect(view).toContain('📎 Attach media');
  expect(view).toContain('video/mp4,video/webm');
  expect(media).toContain("fetch(base + '/media'");
  expect(media).toContain('20 * 1024 * 1024');
  expect(media).toContain('maxFiles = 8');
  expect(runtime).toContain('attachmentIds: attachments.map(item => item.id)');
  expect(runtime).toContain('Uploading media to Reddit…');
});
