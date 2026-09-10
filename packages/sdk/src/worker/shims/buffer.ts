/**
 * Node.js Buffer polyfill for the browser Web Worker environment
 */

export class Buffer extends Uint8Array {
  public static isBuffer(obj: any): boolean {
    return obj instanceof Buffer || (obj != null && obj._isBuffer === true);
  }

  public readonly _isBuffer = true;

  public static from(value: any, encodingOrOffset?: any, length?: number): Buffer {
    if (typeof value === 'string') {
      const encoding = (encodingOrOffset || 'utf8').toLowerCase();
      if (encoding === 'hex') {
        const match = value.match(/.{1,2}/g) || [];
        const bytes = new Uint8Array(match.map(byte => parseInt(byte, 16)));
        const buf = new Buffer(bytes.length);
        buf.set(bytes);
        return buf;
      }
      if (encoding === 'base64') {
        const binStr = atob(value);
        const buf = new Buffer(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          buf[i] = binStr.charCodeAt(i);
        }
        return buf;
      }
      const encoded = new TextEncoder().encode(value);
      const buf = new Buffer(encoded.length);
      buf.set(encoded);
      return buf;
    }

    if (ArrayBuffer.isView(value)) {
      const buf = new Buffer(value.byteLength);
      buf.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      return buf;
    }

    if (value instanceof ArrayBuffer) {
      const offset = typeof encodingOrOffset === 'number' ? encodingOrOffset : 0;
      const len = length !== undefined ? length : value.byteLength - offset;
      const buf = new Buffer(len);
      buf.set(new Uint8Array(value, offset, len));
      return buf;
    }

    if (Array.isArray(value)) {
      const buf = new Buffer(value.length);
      buf.set(value);
      return buf;
    }

    throw new TypeError('First argument must be a string, Buffer, ArrayBuffer, or Array');
  }

  public static alloc(size: number, fill?: number | string, encoding?: string): Buffer {
    const buf = new Buffer(size);
    if (fill !== undefined) {
      if (typeof fill === 'number') {
        buf.fill(fill);
      } else if (typeof fill === 'string') {
        const fillBuf = Buffer.from(fill, encoding);
        for (let i = 0; i < size; i++) {
          buf[i] = fillBuf[i % fillBuf.length];
        }
      }
    }
    return buf;
  }

  public static allocUnsafe(size: number): Buffer {
    return new Buffer(size);
  }

  public static byteLength(string: string, encoding: string = 'utf8'): number {
    return Buffer.from(string, encoding).length;
  }

  public static concat(list: Uint8Array[], totalLength?: number): Buffer {
    if (totalLength === undefined) {
      totalLength = list.reduce((acc, curr) => acc + curr.length, 0);
    }
    const result = Buffer.alloc(totalLength);
    let offset = 0;
    for (const item of list) {
      result.set(item, offset);
      offset += item.length;
    }
    return result;
  }

  public toString(encoding: string = 'utf8', start: number = 0, end?: number): string {
    const slice = this.subarray(start, end !== undefined ? end : this.length);
    const enc = encoding.toLowerCase();
    if (enc === 'hex') {
      return Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    if (enc === 'base64') {
      let binary = '';
      for (let i = 0; i < slice.length; i++) {
        binary += String.fromCharCode(slice[i]);
      }
      return btoa(binary);
    }
    return new TextDecoder().decode(slice);
  }

  public write(string: string, offset: number = 0, length?: number, encoding: string = 'utf8'): number {
    const encoded = Buffer.from(string, encoding);
    const writeLen = Math.min(encoded.length, length !== undefined ? length : this.length - offset);
    for (let i = 0; i < writeLen; i++) {
      this[offset + i] = encoded[i];
    }
    return writeLen;
  }

  public copy(target: Uint8Array, targetStart: number = 0, sourceStart: number = 0, sourceEnd?: number): number {
    const end = sourceEnd !== undefined ? sourceEnd : this.length;
    const slice = this.subarray(sourceStart, end);
    target.set(slice, targetStart);
    return slice.length;
  }
}

export default { Buffer };
