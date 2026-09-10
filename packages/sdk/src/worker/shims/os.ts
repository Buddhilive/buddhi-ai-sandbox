/**
 * Node.js os polyfill for the browser Web Worker environment
 */

export function platform(): string {
  return 'browser-wasm';
}

export function arch(): string {
  return 'wasm32';
}

export function type(): string {
  return 'BrowserWasm';
}

export function release(): string {
  return '1.0.0';
}

export function endianness(): string {
  return 'LE';
}

export function homedir(): string {
  return '/workspace';
}

export function tmpdir(): string {
  return '/tmp';
}

export function cpus(): Array<{ model: string; speed: number; times: any }> {
  const count = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Array.from({ length: count }, () => ({
    model: 'WebAssembly Virtual Core',
    speed: 3000,
    times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
  }));
}

export function totalmem(): number {
  return 1024 * 1024 * 1024; // 1 GB
}

export function freemem(): number {
  return 512 * 1024 * 1024; // 512 MB
}

export function networkInterfaces(): Record<string, any[]> {
  return {
    lo: [
      {
        address: '127.0.0.1',
        netmask: '255.0.0.0',
        family: 'IPv4',
        mac: '00:00:00:00:00:00',
        internal: true,
        cidr: '127.0.0.1/8',
      },
    ],
  };
}

export const EOL = '\n';

export default {
  platform,
  arch,
  type,
  release,
  endianness,
  homedir,
  tmpdir,
  cpus,
  totalmem,
  freemem,
  networkInterfaces,
  EOL,
};
