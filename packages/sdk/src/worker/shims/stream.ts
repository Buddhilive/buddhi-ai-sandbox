/**
 * Node.js stream polyfill for the browser Web Worker environment
 */
import { EventEmitter } from './events.js';
import { Buffer } from './buffer.js';

export class Readable extends EventEmitter {
  public readable = true;
  public readableEnded = false;
  protected _buffer: any[] = [];
  protected _paused = false;

  constructor(options?: any) {
    super();
  }

  public _read(size?: number): void {}

  public push(chunk: any): boolean {
    if (chunk === null) {
      this.readableEnded = true;
      this.emit('end');
      return false;
    }
    const buf = chunk instanceof Buffer ? chunk : (typeof chunk === 'string' || chunk instanceof Uint8Array || ArrayBuffer.isView(chunk) ? Buffer.from(chunk as any) : chunk);
    this._buffer.push(buf);
    this.emit('data', buf);
    return !this._paused;
  }

  public read(size?: number): any {
    if (this._buffer.length === 0) return null;
    return this._buffer.shift();
  }

  public pause(): this {
    this._paused = true;
    this.emit('pause');
    return this;
  }

  public resume(): this {
    this._paused = false;
    this.emit('resume');
    return this;
  }

  public isPaused(): boolean {
    return this._paused;
  }

  public pipe<T extends Writable>(destination: T, options?: { end?: boolean }): T {
    this.on('data', (chunk) => {
      destination.write(chunk);
    });
    this.once('end', () => {
      if (!options || options.end !== false) {
        destination.end();
      }
    });
    this.once('error', (err) => {
      destination.emit('error', err);
    });
    return destination;
  }

  public static from(iterable: any): Readable {
    const stream = new Readable();
    (async () => {
      try {
        for await (const chunk of iterable) {
          stream.push(chunk);
        }
        stream.push(null);
      } catch (err) {
        stream.emit('error', err);
      }
    })();
    return stream;
  }

  public static fromWeb(webStream: any): Readable {
    const stream = new Readable();
    const reader = webStream.getReader();
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            stream.push(null);
            break;
          }
          stream.push(value);
        }
      } catch (err) {
        stream.emit('error', err);
      }
    })();
    return stream;
  }

  public static toWeb(nodeStream: Readable): any {
    return new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk) => controller.enqueue(chunk));
        nodeStream.once('end', () => controller.close());
        nodeStream.once('error', (err) => controller.error(err));
      },
    });
  }

  public [Symbol.asyncIterator]() {
    return {
      next: () => {
        return new Promise((resolve, reject) => {
          if (this._buffer.length > 0) {
            return resolve({ value: this._buffer.shift(), done: false });
          }
          if (this.readableEnded) {
            return resolve({ value: undefined, done: true });
          }
          const onData = (data: any) => {
            cleanup();
            resolve({ value: data, done: false });
          };
          const onEnd = () => {
            cleanup();
            resolve({ value: undefined, done: true });
          };
          const onError = (err: any) => {
            cleanup();
            reject(err);
          };
          const cleanup = () => {
            this.removeListener('data', onData);
            this.removeListener('end', onEnd);
            this.removeListener('error', onError);
          };
          this.once('data', onData);
          this.once('end', onEnd);
          this.once('error', onError);
        });
      },
    };
  }
}

export class Writable extends EventEmitter {
  public writable = true;
  public writableEnded = false;

  constructor(options?: any) {
    super();
    if (options && typeof options.write === 'function') {
      this._write = options.write;
    }
  }

  public _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    callback();
  }

  public write(chunk: any, encodingOrCb?: any, cb?: any): boolean {
    const encoding = typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8';
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;

    const buf = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk;
    this._write(buf, encoding, (err) => {
      if (err) {
        this.emit('error', err);
        if (callback) callback(err);
      } else {
        if (callback) callback(null);
      }
    });
    return true;
  }

  public end(chunk?: any, encodingOrCb?: any, cb?: any): this {
    if (chunk) {
      this.write(chunk, encodingOrCb, cb);
    } else if (typeof encodingOrCb === 'function') {
      encodingOrCb();
    }
    this.writableEnded = true;
    this.emit('finish');
    this.emit('close');
    return this;
  }

  public static fromWeb(writableStream: any): Writable {
    const writer = writableStream.getWriter();
    const nodeWritable = new Writable();
    nodeWritable._write = async (chunk, encoding, callback) => {
      try {
        await writer.write(chunk);
        callback();
      } catch (err: any) {
        callback(err);
      }
    };
    nodeWritable.on('finish', () => writer.close());
    return nodeWritable;
  }

  public static toWeb(nodeWritable: Writable): any {
    return new WritableStream({
      write(chunk) {
        return new Promise((resolve, reject) => {
          nodeWritable.write(chunk, (err: any) => {
            if (err) reject(err);
            else resolve(undefined);
          });
        });
      },
      close() {
        return new Promise((resolve) => {
          nodeWritable.end(() => resolve(undefined));
        });
      },
    });
  }
}

export class Duplex extends Readable {
  public writable = true;
  public writableEnded = false;

  public _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    callback();
  }

  public write(chunk: any, encodingOrCb?: any, cb?: any): boolean {
    return Writable.prototype.write.call(this, chunk, encodingOrCb, cb);
  }

  public end(chunk?: any, encodingOrCb?: any, cb?: any): this {
    return Writable.prototype.end.call(this, chunk, encodingOrCb, cb) as any;
  }
}

export class Transform extends Duplex {
  public _transform(chunk: any, encoding: string, callback: (error?: Error | null, data?: any) => void): void {
    callback(null, chunk);
  }

  public _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    this._transform(chunk, encoding, (err, data) => {
      if (err) {
        this.emit('error', err);
        return callback(err);
      }
      if (data) this.push(data);
      callback();
    });
  }
}

export class PassThrough extends Transform {}

export function pipeline(...args: any[]): any {
  const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
  const streams = args;

  for (let i = 0; i < streams.length - 1; i++) {
    streams[i].pipe(streams[i + 1]);
  }

  const last = streams[streams.length - 1];
  if (cb) {
    last.once('finish', () => cb(null));
    last.once('error', (err: any) => cb(err));
  }
  return last;
}

export function finished(stream: any, callback: (err?: any) => void): () => void {
  const onFinish = () => { cleanup(); callback(null); };
  const onError = (err: any) => { cleanup(); callback(err); };
  const cleanup = () => {
    stream.removeListener('finish', onFinish);
    stream.removeListener('end', onFinish);
    stream.removeListener('error', onError);
  };
  stream.once('finish', onFinish);
  stream.once('end', onFinish);
  stream.once('error', onError);
  return cleanup;
}

export const promises = {
  pipeline: (...streams: any[]) => new Promise((resolve, reject) => {
    pipeline(...streams, (err: any) => {
      if (err) reject(err);
      else resolve(undefined);
    });
  }),
  finished: (stream: any) => new Promise((resolve, reject) => {
    finished(stream, (err) => {
      if (err) reject(err);
      else resolve(undefined);
    });
  }),
};

export default {
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  pipeline,
  finished,
  promises,
};
