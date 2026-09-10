/**
 * Node.js worker_threads polyfill stubs for virtual sandbox
 */
import { EventEmitter } from './events.js';

export const isMainThread = true;
export const parentPort = null;
export const workerData = null;

export class Worker extends EventEmitter {
  constructor(filename: string | URL, options?: any) {
    super();
    setTimeout(() => {
      this.emit('online');
    }, 0);
  }

  public postMessage(value: any, transferList?: any[]) {}
  public terminate(): Promise<number> {
    return Promise.resolve(0);
  }
}

export class MessageChannel {
  public port1 = new EventEmitter();
  public port2 = new EventEmitter();
}

export default {
  isMainThread,
  parentPort,
  workerData,
  Worker,
  MessageChannel,
};
