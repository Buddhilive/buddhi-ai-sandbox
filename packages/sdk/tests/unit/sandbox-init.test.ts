import { describe, it, expect } from 'vitest';
import {
  createRingBuffer,
  createRingBufferReader,
  createRingBufferWriter,
  DEFAULT_RING_BUFFER_SIZE,
} from '../../src/worker-bridge.js';
import { OOMError, SandboxError } from '../../src/types.js';

describe('SharedArrayBuffer Ring Buffer I/O Bridge', () => {
  it('creates an initialized SharedArrayBuffer with correct header layout', () => {
    const sab = createRingBuffer(1024);
    expect(sab.byteLength).toBe(16 + 1024);

    const int32 = new Int32Array(sab, 0, 4);
    expect(int32[0]).toBe(0); // FLAG_EMPTY
    expect(int32[1]).toBe(0); // writeHead
    expect(int32[2]).toBe(0); // readHead
    expect(int32[3]).toBe(1024); // capacity
  });

  it('writes and reads data through the ring buffer stream reader/writer', async () => {
    const sab = createRingBuffer(4096);
    const reader = createRingBufferReader(sab);
    const writer = createRingBufferWriter(sab);

    const streamWriter = writer.getWriter();
    const streamReader = reader.getReader();

    const testPayload = new TextEncoder().encode('Hello WebAssembly Ring Buffer!');
    await streamWriter.write(testPayload);
    await streamWriter.close();

    const { value, done } = await streamReader.read();
    expect(done).toBe(false);
    expect(value).toBeDefined();

    const decoded = new TextDecoder().decode(value);
    expect(decoded).toBe('Hello WebAssembly Ring Buffer!');
  });

  it('handles multiple sequential writes and drains accurately', async () => {
    const sab = createRingBuffer(2048);
    const reader = createRingBufferReader(sab);
    const writer = createRingBufferWriter(sab);

    const streamWriter = writer.getWriter();
    const streamReader = reader.getReader();

    await streamWriter.write(new TextEncoder().encode('Part 1: '));
    await streamWriter.write(new TextEncoder().encode('Part 2: '));
    await streamWriter.write(new TextEncoder().encode('Finished.'));
    await streamWriter.close();

    let fullOutput = '';
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await streamReader.read();
      if (done) break;
      if (value) fullOutput += decoder.decode(value);
    }

    expect(fullOutput).toBe('Part 1: Part 2: Finished.');
  });

  it('instantiates OOMError with correct error code', () => {
    const oom = new OOMError('WebAssembly memory limit exceeded');
    expect(oom).toBeInstanceOf(SandboxError);
    expect(oom.code).toBe('ERR_OUT_OF_MEMORY');
  });
});

