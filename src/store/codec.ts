import type { ProtoBuffCodec } from '@kittycrypto/server';
import * as pb from 'protobufjs';
import type { Json, JsonMap } from '../types/json.ts';

const schema = `
syntax = "proto3";
message JVal {
  oneof kind {
    bool nil = 1;
    bool b = 2;
    double n = 3;
    string s = 4;
    JObj o = 5;
    JArr a = 6;
  }
}
message JObj { map<string, JVal> fields = 1; }
message JArr { repeated JVal items = 1; }
message Store { uint32 schema = 1; JVal root = 2; }
`;

type WVal = { nil?: boolean; b?: boolean; n?: number; s?: string; o?: WObj; a?: WArr };
type WObj = { fields?: { [key: string]: WVal } };
type WArr = { items?: WVal[] };
type Wire = { schema?: number; root?: WVal };

const encObj = (v: JsonMap): WObj => ({
  fields: Object.fromEntries(Object.entries(v).map(([key, value]) => [key, enc(value)])),
});

const enc = (v: Json): WVal => {
  if (v === null) return { nil: true };
  if (typeof v === 'boolean') return { b: v };
  if (typeof v === 'number') return { n: v };
  if (typeof v === 'string') return { s: v };
  if (Array.isArray(v)) return { a: { items: v.map(enc) } };
  return { o: encObj(v) };
};

const decObj = (v: WObj): JsonMap => {
  const out: JsonMap = {};
  for (const [key, value] of Object.entries(v.fields ?? {})) out[key] = dec(value);
  return out;
};

const dec = (v: WVal): Json => {
  if (v.nil === true) return null;
  if (v.b !== undefined) return v.b;
  if (v.n !== undefined) return v.n;
  if (v.s !== undefined) return v.s;
  if (v.o !== undefined) return decObj(v.o);
  if (v.a !== undefined) return (v.a.items ?? []).map(dec);
  throw new Error('Invalid protobuf JSON value');
};

class JsonCodec implements ProtoBuffCodec<Json> {
  private readonly type: pb.Type;

  public constructor() {
    this.type = pb.parse(schema).root.lookupType('Store');
  }

  public encode(value: Json): Buffer {
    const wire: Wire = { schema: 1, root: enc(value) };
    const error = this.type.verify(wire);
    if (error !== null) throw new Error(`Invalid Reddit store payload: ${error}`);
    return Buffer.from(this.type.encode(this.type.fromObject(wire)).finish());
  }

  public decode(raw: Buffer): Json {
    const decoded = this.type.decode(raw);
    const wire = this.type.toObject(decoded, { defaults: false, arrays: true, objects: true }) as Wire;
    if (wire.schema !== 1 || wire.root === undefined) throw new Error('Unsupported Reddit store payload');
    return dec(wire.root);
  }
}

export const jsonCodec = (): ProtoBuffCodec<Json> => new JsonCodec();
