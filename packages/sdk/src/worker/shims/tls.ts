/**
 * Node.js tls polyfill stubs for virtual sandbox
 */
import { Socket } from './net.js';
import { EventEmitter } from './events.js';

export class TLSSocket extends Socket {
  public authorized = true;
  public encrypted = true;

  public getPeerCertificate() {
    return { subject: { CN: 'localhost' } };
  }
}

export class Server extends EventEmitter {
  public listen(...args: any[]): this {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    if (cb) setTimeout(cb, 0);
    return this;
  }
  public close(cb?: () => void): this {
    if (cb) setTimeout(cb, 0);
    return this;
  }
}

export function connect(...args: any[]): TLSSocket {
  const socket = new TLSSocket();
  return socket.connect(...args);
}

export function createServer(options?: any, listener?: any): Server {
  return new Server();
}

export function createSecureContext(options?: any) {
  return {};
}

export default {
  TLSSocket,
  Server,
  connect,
  createServer,
  createSecureContext,
};
