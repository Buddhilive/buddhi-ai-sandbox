/**
 * Node.js zlib polyfill using fflate
 */
import { gzipSync as fflateGzipSync, gunzipSync as fflateGunzipSync, deflateSync as fflateDeflateSync, inflateSync as fflateInflateSync } from 'fflate';
import { Buffer } from './buffer.js';
import { Transform } from './stream.js';

export function gzipSync(buf: Uint8Array, options?: any): Buffer {
  const res = fflateGzipSync(buf, options);
  return Buffer.from(res);
}

export function gunzipSync(buf: Uint8Array, options?: any): Buffer {
  const res = fflateGunzipSync(buf, options);
  return Buffer.from(res);
}

export function deflateSync(buf: Uint8Array, options?: any): Buffer {
  const res = fflateDeflateSync(buf, options);
  return Buffer.from(res);
}

export function inflateSync(buf: Uint8Array, options?: any): Buffer {
  const res = fflateInflateSync(buf, options);
  return Buffer.from(res);
}

export function gzip(buf: Uint8Array, optionsOrCallback: any, cb?: (err: any, res?: Buffer) => void) {
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : cb;
  try {
    const res = gzipSync(buf);
    if (callback) callback(null, res);
  } catch (err) {
    if (callback) callback(err);
  }
}

export function gunzip(buf: Uint8Array, optionsOrCallback: any, cb?: (err: any, res?: Buffer) => void) {
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : cb;
  try {
    const res = gunzipSync(buf);
    if (callback) callback(null, res);
  } catch (err) {
    if (callback) callback(err);
  }
}

export class Gzip extends Transform {
  private chunks: Uint8Array[] = [];

  public _transform(chunk: any, encoding: string, callback: any): void {
    this.chunks.push(chunk);
    callback();
  }

  public _flush(callback: any): void {
    try {
      const merged = Buffer.concat(this.chunks);
      const res = gzipSync(merged);
      this.push(res);
      callback();
    } catch (err) {
      callback(err);
    }
  }
}

export class Gunzip extends Transform {
  private chunks: Uint8Array[] = [];

  public _transform(chunk: any, encoding: string, callback: any): void {
    this.chunks.push(chunk);
    callback();
  }

  public _flush(callback: any): void {
    try {
      const merged = Buffer.concat(this.chunks);
      const res = gunzipSync(merged);
      this.push(res);
      callback();
    } catch (err) {
      callback(err);
    }
  }
}

export function createGzip(options?: any): Gzip {
  return new Gzip(options);
}

export function createGunzip(options?: any): Gunzip {
  return new Gunzip(options);
}

export function createDeflate(options?: any): Gzip {
  return new Gzip(options);
}

export function createInflate(options?: any): Gunzip {
  return new Gunzip(options);
}

export default {
  gzipSync,
  gunzipSync,
  deflateSync,
  inflateSync,
  gzip,
  gunzip,
  createGzip,
  createGunzip,
  createDeflate,
  createInflate,
  Gzip,
  Gunzip,
};
