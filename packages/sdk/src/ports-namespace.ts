import { WorkerBridge } from './worker-bridge.js';
import { ListenEvent, WorkerOutboundMessage } from './types.js';

export type PortListener = (event: ListenEvent) => void;

export class PortsNamespace {
  private listeners = new Map<string, Set<PortListener>>();
  private activePorts = new Map<number, string>();

  constructor(private bridge: WorkerBridge) {
    this.bridge.onMessage((msg: WorkerOutboundMessage) => {
      if (msg.type === 'port:listen') {
        const port = msg.port;
        const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
        const url = `${origin}/__preview/${port}/`;
        this.activePorts.set(port, url);

        const list = this.listeners.get('listen');
        if (list) {
          for (const listener of list) {
            listener({ port, url });
          }
        }
      } else if (msg.type === 'port:close') {
        const port = msg.port;
        const url = this.activePorts.get(port) || '';
        this.activePorts.delete(port);

        const list = this.listeners.get('close');
        if (list) {
          for (const listener of list) {
            listener({ port, url });
          }
        }
      }
    });
  }

  on(event: 'listen' | 'close', listener: PortListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: 'listen' | 'close', listener: PortListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  getPreviewUrl(port: number): string | undefined {
    return this.activePorts.get(port);
  }
}
