import { describe, it, expect } from 'vitest';
import EventEmitter from '../../src/worker/shims/events.js';
import { Buffer } from '../../src/worker/shims/buffer.js';
import { StringDecoder } from '../../src/worker/shims/string-decoder.js';
import { Readable, Writable, pipeline } from '../../src/worker/shims/stream.js';
import { createHash, randomBytes, randomUUID } from '../../src/worker/shims/crypto.js';
import { platform, homedir, tmpdir } from '../../src/worker/shims/os.js';
import { gzipSync, gunzipSync } from '../../src/worker/shims/zlib.js';
import { createServer, STATUS_CODES } from '../../src/worker/shims/http.js';

describe('Node.js Shims in Sandbox Web Worker', () => {
  it('events: EventEmitter handles on, once, and emit correctly', () => {
    const ee = new EventEmitter();
    let count = 0;
    ee.on('test', (val) => { count += val; });
    ee.once('test', () => { count += 10; });

    ee.emit('test', 5);
    expect(count).toBe(15);

    ee.emit('test', 2);
    expect(count).toBe(17);
  });

  it('buffer: Buffer handles utf8, hex, base64, and alloc', () => {
    const buf = Buffer.from('hello world');
    expect(buf.toString()).toBe('hello world');
    expect(buf.toString('hex')).toBe('68656c6c6f20776f726c64');
    expect(buf.toString('base64')).toBe('aGVsbG8gd29ybGQ=');

    const fromHex = Buffer.from('68656c6c6f', 'hex');
    expect(fromHex.toString()).toBe('hello');

    const alloc = Buffer.alloc(4, 0x41);
    expect(alloc.toString()).toBe('AAAA');
    expect(Buffer.isBuffer(alloc)).toBe(true);
  });

  it('string_decoder: decodes UTF-8 buffers progressively', () => {
    const decoder = new StringDecoder('utf8');
    const part1 = Buffer.from([0xe2, 0x82]);
    const part2 = Buffer.from([0xac]); // Euro sign € is e2 82 ac
    const str1 = decoder.write(part1);
    const str2 = decoder.write(part2);
    expect(str1 + str2).toBe('€');
  });

  it('crypto: generates deterministic sha256 and random UUIDs', () => {
    const hash = createHash('sha256').update('buddhi-sandbox').digest('hex');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(64);

    const uuid = randomUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const bytes = randomBytes(16);
    expect(bytes.length).toBe(16);
  });

  it('stream: pipes data from Readable to Writable through pipeline', async () => {
    const readable = new Readable();
    const chunks: string[] = [];
    const writable = new Writable({
      write(chunk: any, encoding: any, callback: any) {
        chunks.push(chunk.toString());
        callback();
      },
    });

    const finishedPromise = new Promise((resolve, reject) => {
      pipeline(readable, writable, (err: any) => {
        if (err) reject(err);
        else resolve(true);
      });
    });

    readable.push('chunk1 ');
    readable.push('chunk2');
    readable.push(null);

    await finishedPromise;
    expect(chunks.join('')).toBe('chunk1 chunk2');
  });

  it('os: returns browser-wasm platform metadata', () => {
    expect(platform()).toBe('browser-wasm');
    expect(homedir()).toBe('/workspace');
    expect(tmpdir()).toBe('/tmp');
  });

  it('zlib: compresses and decompresses payloads', () => {
    const text = 'Next.js App Router Server Component Wire Protocol';
    const compressed = gzipSync(Buffer.from(text));
    expect(compressed.length).toBeGreaterThan(0);

    const decompressed = gunzipSync(compressed);
    expect(decompressed.toString()).toBe(text);
  });

  it('http: creates virtual server and dispatches request', (done) => {
    const server = createServer((req, res) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/api/hello');
      expect(req.headers['x-custom']).toBe('test-val');

      let body = '';
      req.on('data', (c) => { body += c.toString(); });
      req.on('end', () => {
        expect(body).toBe('request-body');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      });
    });

    server.listen(3000);
    expect(STATUS_CODES[200]).toBe('OK');

    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      if (event.data.type === 'end') {
        expect(event.data.status).toBe(200);
        server.close();
      }
    };

    server.dispatchRequest({
      method: 'POST',
      path: '/api/hello',
      headers: { 'x-custom': 'test-val' },
      body: new TextEncoder().encode('request-body').buffer,
      replyPort: channel.port2,
    });
  });
});
