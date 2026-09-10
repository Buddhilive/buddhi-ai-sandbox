/**
 * Node.js net polyfill / stubs for virtual sandbox
 */
import { EventEmitter } from './events.js';
import { Duplex } from './stream.js';

export class Socket extends Duplex {
  public connecting = false;
  public readyState: string = 'open';

  constructor(options?: any) {
    super(options);
  }

  public connect(...args: any[]): this {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    this.connecting = false;
    this.readyState = 'open';
    if (cb) setTimeout(cb, 0);
    setTimeout(() => this.emit('connect'), 0);
    return this;
  }

  public address() {
    return { port: 0, family: 'IPv4', address: '127.0.0.1' };
  }

  public setTimeout(timeout: number, callback?: () => void): this {
    if (callback) this.once('timeout', callback);
    return this;
  }

  public setNoDelay(noDelay?: boolean): this { return this; }
  public setKeepAlive(enable?: boolean, initialDelay?: number): this { return this; }
  public ref(): this { return this; }
  public unref(): this { return this; }
}

export class Server extends EventEmitter {
  public listening = false;
  private _port: number = 0;

  constructor(options?: any, connectionListener?: (socket: Socket) => void) {
    super();
    if (connectionListener) this.on('connection', connectionListener);
  }

  public listen(...args: any[]): this {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const port = typeof args[0] === 'number' ? args[0] : (args[0]?.port || 3000);
    this._port = port;
    this.listening = true;
    if (cb) setTimeout(cb, 0);
    setTimeout(() => this.emit('listening'), 0);
    return this;
  }

  public close(callback?: (err?: Error) => void): this {
    this.listening = false;
    if (callback) setTimeout(callback, 0);
    setTimeout(() => this.emit('close'), 0);
    return this;
  }

  public address() {
    return { port: this._port, family: 'IPv4', address: '127.0.0.1' };
  }

  public ref(): this { return this; }
  public unref(): this { return this; }
}

export function createServer(options?: any, connectionListener?: (socket: Socket) => void): Server {
  return new Server(options, connectionListener);
}

export function createConnection(...args: any[]): Socket {
  const socket = new Socket();
  return socket.connect(...args);
}

export const connect = createConnection;

export function isIP(input: string): number {
  if (isIPv4(input)) return 4;
  if (isIPv6(input)) return 6;
  return 0;
}

export function isIPv4(input: string): boolean {
  return /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(input);
}

export function isIPv6(input: string): boolean {
  return /^[0-9a-fA-F:]+$/.test(input);
}

export default {
  Socket,
  Server,
  createServer,
  createConnection,
  connect,
  isIP,
  isIPv4,
  isIPv6,
};
