const markdownMeta = new Set(['*', '_', '~', '|', '[', ']', '#', '>', '<', '+', '-', '^']);

const faceChars = /[ωΩツノへ▽∀Дд◕｡╥﹏‿ᵔᵕづಠಥ益눈ᕙᗒᗕﾉﾟ∇✧☆♥•￣³]/u;
const asciiFace = /(?:[:;=xX8][\-^']?[)(/\\DPpOo]|[)(/\\DPpOo][\-^']?[:;=xX8])/u;

const isEscaped = (value: string, index: number): boolean => {
  let slashes = 0;
  for (let at = index - 1; at >= 0 && value[at] === '\\'; at -= 1) slashes += 1;
  return slashes % 2 === 1;
};

const escapeCandidate = (value: string): string => {
  let out = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? '';
    if (markdownMeta.has(char) && !isEscaped(value, index)) out += '\\';
    out += char;
  }
  return out;
};

const looksLikeKaomoji = (value: string): boolean => {
  if (value.length < 2 || value.length > 64) return false;
  if (/https?:\/\//iu.test(value) || /<\/?[A-Za-z][^>]*>/u.test(value)) return false;
  if (!/[()\[\]{}（）【】<>_\\/]/u.test(value)) return false;
  return faceChars.test(value) || asciiFace.test(value) || /[_^][^\s]{1,24}[_^]/u.test(value);
};

const bracketed = /(?:\([^\n()]{1,62}\)|\[[^\n\[\]]{1,62}\]|\{[^\n{}]{1,62}\}|（[^\n（）]{1,62}）|【[^\n【】]{1,62}】)/gu;
const compact = /(?<!\S)[^\s]{2,64}(?!\S)/gu;

export const preserveKaomojiForReddit = (markdown: string): string => {
  const protect = (candidate: string): string => looksLikeKaomoji(candidate) ? escapeCandidate(candidate) : candidate;
  return markdown
    .replace(bracketed, protect)
    .replace(compact, protect);
};
