import { expect, test } from 'bun:test';
import { preserveKaomojiForReddit } from '../src/reddit/markdown.ts';

test('preserves Mae-style kaomoji without flattening normal Markdown', () => {
  const input = [
    '**Bold stays bold**',
    '',
    'Mae says _>ω<_ and (╥﹏╥) and ¯\\_(ツ)_/¯',
    '',
    '[normal link](https://example.test/path_with_underscore)',
  ].join('\n');
  const output = preserveKaomojiForReddit(input);
  expect(output).toContain('**Bold stays bold**');
  expect(output).toContain('\\_\\>ω\\<\\_');
  expect(output).toContain('(╥﹏╥)');
  expect(output).toContain('¯\\_(');
  expect(output).toContain(')\\_/¯');
  expect(output).toContain('[normal link](https://example.test/path_with_underscore)');
});

test('does not reinterpret ordinary underscore text as a kaomoji', () => {
  expect(preserveKaomojiForReddit('snake_case and _ordinary emphasis_ stay alone'))
    .toBe('snake_case and _ordinary emphasis_ stay alone');
});

test('handles common compact and bracketed kaomoji forms', () => {
  const input = '(づ｡◕‿‿◕｡)づ  ಠ_ಠ  (ง^ᗜ^)ง  ^_^';
  const output = preserveKaomojiForReddit(input);
  expect(output).toContain('(づ｡◕‿‿◕｡)づ');
  expect(output).toContain('ಠ\\_ಠ');
  expect(output).toContain('(ง\\^ᗜ\\^)ง');
  expect(output).toContain('\\^\\_\\^');
});
