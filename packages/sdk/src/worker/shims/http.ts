/**
 * Virtual HTTP Server and Client implementation for browser Web Worker
 */
import { EventEmitter } from './events.js';
import { Readable, Writable } from './stream.js';
import { Socket } from './net.js';
import { Buffer } from './buffer.js';

export const STATUS_CODES: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export const METHODS = [
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE'
];

export class IncomingMessage extends Readable {
  public method: string;
  public url: string;
  public headers: Record<string, string>;
  public rawHeaders: string[];
  public statusCode?: number;
  public statusMessage?: string;
  public socket: Socket;

  constructor(options: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    socket?: Socket;
  }) {
    super();
    this.method = options.method || 'GET';
    this.url = options.url || '/';
    this.headers = options.headers || {};
    this.rawHeaders = [];
    for (const [k, v] of Object.entries(this.headers)) {
      this.rawHeaders.push(k, String(v));
    }
    this.socket = options.socket || new Socket();
  }
}

export class ServerResponse extends Writable {
  public statusCode: number = 200;
  public statusMessage: string = 'OK';
  public headersSent: boolean = false;
  private _headers: Record<string, string | string[]> = {};
  private _replyPort?: MessagePort;
  private _chunks: Uint8Array[] = [];

  constructor(options?: { replyPort?: MessagePort }) {
    super();
    this._replyPort = options?.replyPort;
  }

  public setHeader(name: string, value: any): this {
    if (this.headersSent) throw new Error('Cannot set headers after they are sent to the client');
    this._headers[name.toLowerCase()] = value;
    return this;
  }

  public getHeader(name: string): any {
    return this._headers[name.toLowerCase()];
  }

  public getHeaders(): Record<string, any> {
    return { ...this._headers };
  }

  public hasHeader(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._headers, name.toLowerCase());
  }

  public removeHeader(name: string): void {
    if (this.headersSent) throw new Error('Cannot remove headers after they are sent to the client');
    delete this._headers[name.toLowerCase()];
  }

  public writeHead(statusCode: number, statusMessageOrHeaders?: any, headers?: any): this {
    if (this.headersSent) throw new Error('Cannot writeHead after headers are sent');
    this.statusCode = statusCode;
    if (typeof statusMessageOrHeaders === 'string') {
      this.statusMessage = statusMessageOrHeaders;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
      }
    } else if (statusMessageOrHeaders) {
      for (const [k, v] of Object.entries(statusMessageOrHeaders)) this.setHeader(k, v);
    }
    this.flushHeaders();
    return this;
  }

  public flushHeaders(): void {
    if (this.headersSent) return;
    this.headersSent = true;
    if (!this.statusMessage) {
      this.statusMessage = STATUS_CODES[this.statusCode] || 'OK';
    }

    if (this._replyPort) {
      const flatHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(this._headers)) {
        flatHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
      }
      this._replyPort.postMessage({
        type: 'headers',
        status: this.statusCode,
        statusText: this.statusMessage,
        headers: flatHeaders,
      });
    }
  }

  public _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    if (!this.headersSent) {
      this.flushHeaders();
    }
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk;
    this._chunks.push(buf);

    if (this._replyPort) {
      this._replyPort.postMessage({
        type: 'chunk',
        data: buf,
      });
    }
    callback();
  }

  public end(chunk?: any, encodingOrCb?: any, cb?: any): this {
    super.end(chunk, encodingOrCb, cb);

    if (!this.headersSent) {
      this.flushHeaders();
    }

    if (this._replyPort) {
      const merged = Buffer.concat(this._chunks);
      this._replyPort.postMessage({
        type: 'end',
        status: this.statusCode,
        statusText: this.statusMessage,
        headers: this._headers,
        body: merged.buffer,
      });
    }
    return this;
  }
}

export class Server extends EventEmitter {
  public listening = false;
  private _port: number = 3000;
  private _handler?: (req: IncomingMessage, res: ServerResponse) => void;

  constructor(optionsOrCallback?: any, cb?: (req: IncomingMessage, res: ServerResponse) => void) {
    super();
    if (typeof optionsOrCallback === 'function') {
      this._handler = optionsOrCallback;
      this.on('request', optionsOrCallback);
    } else if (cb) {
      this._handler = cb;
      this.on('request', cb);
    }
  }

  public listen(port: number = 3000, ...args: any[]): this {
    this._port = port;
    this.listening = true;
    const cb = args.find(a => typeof a === 'function');

    activeHttpServers.set(port, this);

    // Notify worker main thread that port is open
    if (typeof self !== 'undefined' && self.postMessage) {
      self.postMessage({ type: 'port:listen', port });
    }

    if (cb) setTimeout(cb, 0);
    setTimeout(() => this.emit('listening'), 0);
    return this;
  }

  public close(callback?: () => void): this {
    this.listening = false;
    activeHttpServers.delete(this._port);

    if (typeof self !== 'undefined' && self.postMessage) {
      self.postMessage({ type: 'port:close', port: this._port });
    }

    if (callback) setTimeout(callback, 0);
    setTimeout(() => this.emit('close'), 0);
    return this;
  }

  public dispatchRequest(payload: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: ArrayBuffer | null;
    replyPort?: MessagePort;
  }) {
    const socket = new Socket();
    const req = new IncomingMessage({
      method: payload.method,
      url: payload.path,
      headers: payload.headers,
      socket,
    });
    const res = new ServerResponse({ replyPort: payload.replyPort });

    this.emit('request', req, res);

    if (payload.body && payload.body.byteLength > 0) {
      req.push(new Uint8Array(payload.body));
    }
    req.push(null);
  }
}

export const activeHttpServers = new Map<number, Server>();

export function createServer(optionsOrCallback?: any, cb?: (req: IncomingMessage, res: ServerResponse) => void): Server {
  return new Server(optionsOrCallback, cb);
}

export class Agent {
  public destroy() {}
}

export default {
  STATUS_CODES,
  METHODS,
  IncomingMessage,
  ServerResponse,
  Server,
  createServer,
  Agent,
  activeHttpServers,
};
