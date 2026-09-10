/**
 * Node.js child_process polyfill stubs for virtual sandbox
 */
import { EventEmitter } from './events.js';
import { Readable, Writable } from './stream.js';

export class ChildProcess extends EventEmitter {
  public pid = Math.floor(Math.random() * 10000);
  public stdout = new Readable();
  public stderr = new Readable();
  public stdin = new Writable();
  public exitCode: number | null = 0;

  public kill(signal?: string): boolean {
    this.emit('close', 0);
    this.emit('exit', 0);
    return true;
  }
}

export function spawn(command: string, args?: any[], options?: any): ChildProcess {
  const child = new ChildProcess();
  setTimeout(() => {
    // If command is asking for native build tools or git, simulate non-critical exit
    child.stdout.push(null);
    child.stderr.push(null);
    child.emit('exit', 0);
    child.emit('close', 0);
  }, 10);
  return child;
}

export function exec(command: string, optionsOrCallback?: any, cb?: any) {
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : cb;
  setTimeout(() => {
    if (callback) callback(null, '', '');
  }, 10);
  return new ChildProcess();
}

export function execSync(command: string, options?: any): string {
  // Silent fallback for version checks (e.g. git --version)
  return '';
}

export function fork(modulePath: string, args?: any[], options?: any): ChildProcess {
  return spawn('node', [modulePath, ...(args || [])], options);
}

export default {
  ChildProcess,
  spawn,
  exec,
  execSync,
  fork,
};
