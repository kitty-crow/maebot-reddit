import { MutexProtoBuffStore } from '@kittycrypto/server';
import { clone, isMap, type Json, type JsonMap } from '../types/json.ts';
import { jsonCodec } from './codec.ts';

export class Store {
  private readonly raw: MutexProtoBuffStore<Json>;

  public constructor(file: string, initial: Json) {
    this.raw = new MutexProtoBuffStore<Json>({
      filePath: file,
      initialValue: () => clone(initial),
      codec: jsonCodec(),
      onCorrupt: ({ backupPath }) => {
        throw new Error(`Corrupt Reddit protobuf store preserved at ${backupPath}`);
      },
    });
  }

  public async read(): Promise<Json> {
    return await this.raw.read();
  }

  public async map(): Promise<JsonMap> {
    const value = await this.read();
    if (!isMap(value)) throw new Error('Reddit store root is not an object');
    return value;
  }

  public async edit(fn: (current: Json) => Json | Promise<Json>): Promise<Json> {
    return await this.raw.update(fn);
  }
}
