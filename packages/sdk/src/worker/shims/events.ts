/**
 * Node.js events polyfill for the browser Web Worker environment
 */

type Listener = (...args: any[]) => void;

export class EventEmitter {
  private _events: Map<string | symbol, Listener[]> = new Map();
  private _maxListeners: number = 10;

  public static defaultMaxListeners = 10;

  public on(event: string | symbol, listener: Listener): this {
    return this.addListener(event, listener);
  }

  public addListener(event: string | symbol, listener: Listener): this {
    if (typeof listener !== 'function') {
      throw new TypeError('The "listener" argument must be of type function');
    }
    const listeners = this._events.get(event) || [];
    listeners.push(listener);
    this._events.set(event, listeners);
    return this;
  }

  public once(event: string | symbol, listener: Listener): this {
    if (typeof listener !== 'function') {
      throw new TypeError('The "listener" argument must be of type function');
    }
    const onceWrapper = (...args: any[]) => {
      this.removeListener(event, onceWrapper);
      listener.apply(this, args);
    };
    (onceWrapper as any).listener = listener;
    return this.addListener(event, onceWrapper);
  }

  public emit(event: string | symbol, ...args: any[]): boolean {
    const listeners = this._events.get(event);
    if (!listeners || listeners.length === 0) {
      if (event === 'error') {
        const err = args[0] instanceof Error ? args[0] : new Error(`Unhandled error event: ${args[0]}`);
        throw err;
      }
      return false;
    }

    const copy = [...listeners];
    for (const listener of copy) {
      try {
        listener.apply(this, args);
      } catch (err) {
        if (event !== 'error') {
          this.emit('error', err);
        } else {
          throw err;
        }
      }
    }
    return true;
  }

  public removeListener(event: string | symbol, listener: Listener): this {
    const listeners = this._events.get(event);
    if (!listeners) return this;

    const idx = listeners.findIndex(l => l === listener || (l as any).listener === listener);
    if (idx !== -1) {
      listeners.splice(idx, 1);
      if (listeners.length === 0) {
        this._events.delete(event);
      }
    }
    return this;
  }

  public off(event: string | symbol, listener: Listener): this {
    return this.removeListener(event, listener);
  }

  public removeAllListeners(event?: string | symbol): this {
    if (event !== undefined) {
      this._events.delete(event);
    } else {
      this._events.clear();
    }
    return this;
  }

  public setMaxListeners(n: number): this {
    this._maxListeners = n;
    return this;
  }

  public getMaxListeners(): number {
    return this._maxListeners;
  }

  public listenerCount(event: string | symbol): number {
    const listeners = this._events.get(event);
    return listeners ? listeners.length : 0;
  }

  public listeners(event: string | symbol): Listener[] {
    return [...(this._events.get(event) || [])];
  }

  public rawListeners(event: string | symbol): Listener[] {
    return [...(this._events.get(event) || [])];
  }

  public eventNames(): (string | symbol)[] {
    return Array.from(this._events.keys());
  }
}

export default EventEmitter;
