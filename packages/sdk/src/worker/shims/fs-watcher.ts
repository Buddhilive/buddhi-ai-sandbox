/**
 * Node.js fs.watch and fs.watchFile polyfill for the sandbox VFS
 */
import { EventEmitter } from './events.js';

export class FSWatcher extends EventEmitter {
  public closed = false;
  public targetPath: string;
  public recursive: boolean;

  constructor(targetPath: string, recursive: boolean = false) {
    super();
    this.targetPath = targetPath;
    this.recursive = recursive;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    activeWatchers.delete(this);
    this.emit('close');
  }

  public ref(): this { return this; }
  public unref(): this { return this; }
}

const activeWatchers = new Set<FSWatcher>();
const debounceMap = new Map<string, number>();

export function watch(
  filename: string,
  options?: any,
  listener?: (eventType: string, filename: string | null) => void
): FSWatcher {
  const recursive = typeof options === 'object' && options !== null ? !!options.recursive : false;
  const watcher = new FSWatcher(filename, recursive);

  if (typeof options === 'function') {
    watcher.on('change', options);
  } else if (typeof listener === 'function') {
    watcher.on('change', listener);
  }

  activeWatchers.add(watcher);
  return watcher;
}

export function watchFile(filename: string, options?: any, listener?: any): void {
  const cb = typeof options === 'function' ? options : listener;
  const watcher = watch(filename, { recursive: false }, (eventType) => {
    if (cb) cb({ mtime: new Date() }, { mtime: new Date() });
  });
}

export function unwatchFile(filename: string, listener?: any): void {
  for (const w of activeWatchers) {
    if (w.targetPath === filename) {
      w.close();
    }
  }
}

/**
 * Triggered by VirtualFS writes or removals
 */
export function notifyFsChange(changedPath: string, eventType: 'change' | 'rename' = 'change'): void {
  const now = Date.now();
  const lastTime = debounceMap.get(changedPath) || 0;
  if (now - lastTime < 30) return; // 30ms debounce
  debounceMap.set(changedPath, now);

  for (const watcher of activeWatchers) {
    if (watcher.closed) continue;

    const target = watcher.targetPath;
    let matches = false;
    let relName = changedPath;

    if (changedPath === target) {
      matches = true;
      relName = changedPath.split('/').pop() || '';
    } else if (watcher.recursive && changedPath.startsWith(target.endsWith('/') ? target : target + '/')) {
      matches = true;
      relName = changedPath.slice(target.length).replace(/^\//, '');
    }

    if (matches) {
      try {
        watcher.emit('change', eventType, relName);
      } catch (err) {
        console.error('[FSWatcher error]', err);
      }
    }
  }
}

export default {
  FSWatcher,
  watch,
  watchFile,
  unwatchFile,
  notifyFsChange,
};
