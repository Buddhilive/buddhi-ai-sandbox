import { describe, it, expect, vi } from 'vitest';
import { gzipSync, tarSync } from 'fflate';
import { NpmInstaller, untar } from '../../src/npm-installer.js';
import { FsNamespace } from '../../src/fs-namespace.js';
import { WorkerBridge } from '../../src/worker-bridge.js';

class MockFsWorker {
  public files = new Map<string, Uint8Array>();
  public onmessage: ((e: any) => void) | null = null;

  postMessage(msg: any) {
    setTimeout(() => {
      if (msg.type === 'fs:write') {
        this.files.set(msg.path, msg.data);
        this.onmessage?.({ data: { type: 'fs:response', id: msg.id, result: null } });
      } else if (msg.type === 'fs:read') {
        const d = this.files.get(msg.path);
        if (d) {
          this.onmessage?.({ data: { type: 'fs:response', id: msg.id, result: d } });
        } else {
          this.onmessage?.({ data: { type: 'fs:response', id: msg.id, error: 'ENOENT' } });
        }
      } else if (msg.type === 'fs:mkdir') {
        this.onmessage?.({ data: { type: 'fs:response', id: msg.id, result: null } });
      } else if (msg.type === 'fs:symlink') {
        this.onmessage?.({ data: { type: 'fs:response', id: msg.id, result: null } });
      }
    }, 0);
  }
  terminate() {}
}

function createTar(files: Record<string, Uint8Array>): Uint8Array {
  const blocks: Uint8Array[] = [];

  for (const [name, data] of Object.entries(files)) {
    const header = new Uint8Array(512);
    // Write name (0..100)
    const nameBytes = new TextEncoder().encode(name);
    header.set(nameBytes.subarray(0, 100), 0);

    // Write mode: "0000644\0" (100..108)
    header.set(new TextEncoder().encode('0000644\0'), 100);

    // Write size in octal: 11 digits + space/null (124..136)
    const sizeOctal = data.length.toString(8).padStart(11, '0') + ' ';
    header.set(new TextEncoder().encode(sizeOctal), 124);

    // Typeflag: '0' (156)
    header[156] = 48; // '0'

    // Compute checksum (148..156) with 8 spaces
    header.set(new TextEncoder().encode('        '), 148);
    let chksum = 0;
    for (let i = 0; i < 512; i++) {
      chksum += header[i];
    }
    const chksumStr = chksum.toString(8).padStart(6, '0') + '\0 ';
    header.set(new TextEncoder().encode(chksumStr), 148);

    blocks.push(header);

    // Data blocks padded to 512
    const dataPadded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    dataPadded.set(data, 0);
    blocks.push(dataPadded);
  }

  // Two 512-byte zero blocks at end of tar
  blocks.push(new Uint8Array(1024));

  const totalLen = blocks.reduce((acc, b) => acc + b.length, 0);
  const result = new Uint8Array(totalLen);
  let cur = 0;
  for (const b of blocks) {
    result.set(b, cur);
    cur += b.length;
  }
  return result;
}

describe('NpmInstaller Unit Tests (T040)', () => {
  it('downloads tarball, decompresses via fflate, and writes files to VirtualFS', async () => {
    const mockWorker = new MockFsWorker();
    const bridge = new WorkerBridge(mockWorker as any);
    const fs = new FsNamespace(bridge);
    const installer = new NpmInstaller(fs);

    // Create a mock tarball with fflate
    const pkgJson = JSON.stringify({ name: 'test-lib', version: '1.0.0', main: 'index.js' });
    const indexJs = 'module.exports = { greet: () => "hello" };';

    const tarData = createTar({
      'package/package.json': new TextEncoder().encode(pkgJson),
      'package/index.js': new TextEncoder().encode(indexJs),
    });

    // Mock global fetch
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('.tgz')) {
        return new Response(Buffer.from(tarData), { status: 200 });
      } else if (url.includes('registry.npmjs.org/test-lib')) {
        return new Response(
          JSON.stringify({
            'dist-tags': { latest: '1.0.0' },
            versions: {
              '1.0.0': {
                dist: { tarball: 'https://registry.npmjs.org/test-lib/-/test-lib-1.0.0.tgz' },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    const extracted = untar(tarData);
    expect(Object.keys(extracted)).toContain('package/package.json');
    expect(Object.keys(extracted)).toContain('package/index.js');

    await installer.install('test-lib');

    expect(mockWorker.files.has('/node_modules/test-lib/package.json')).toBe(true);
    expect(mockWorker.files.has('/node_modules/test-lib/index.js')).toBe(true);

    const writtenIndex = new TextDecoder().decode(mockWorker.files.get('/node_modules/test-lib/index.js')!);
    expect(writtenIndex).toBe(indexJs);
  });
});
