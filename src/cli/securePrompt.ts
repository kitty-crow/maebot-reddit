import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

const assertInteractiveTty = (): void => {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Secure Reddit credential entry requires an interactive TTY');
  }
};

export const promptText = async (label: string): Promise<string> => {
  assertInteractiveTty();
  const terminal = createInterface({ input: stdin, output: stdout, terminal: true });
  try {
    return (await terminal.question(label)).trim();
  } finally {
    terminal.close();
  }
};

export const promptSecret = async (label: string): Promise<string> => {
  assertInteractiveTty();
  stdout.write(label);

  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();

  let listener: ((chunk: Buffer) => void) | null = null;
  try {
    return await new Promise<string>((resolve, reject) => {
      listener = (chunk: Buffer): void => {
        for (const character of chunk.toString('utf8')) {
          if (character === '\r' || character === '\n') {
            resolve(buffered);
            return;
          }
          if (character === '\u0003' || character === '\u0004') {
            reject(new Error('Secure credential entry cancelled'));
            return;
          }
          if (character === '\u007f' || character === '\b') {
            buffered = [...buffered].slice(0, -1).join('');
            continue;
          }
          if (character >= ' ') buffered += character;
        }
      };

      let buffered = '';
      stdin.on('data', listener);
    });
  } finally {
    if (listener !== null) stdin.off('data', listener);
    stdin.setRawMode(wasRaw);
    stdin.pause();
    stdout.write('\n');
  }
};
