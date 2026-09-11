import { WorkerBridge } from './worker-bridge.js';
import { ListenEvent, WorkerOutboundMessage } from './types.js';

export type PortListener = (event: ListenEvent) => void;

export class PortsNamespace {
  private listeners = new Map<string, Set<PortListener>>();
  private activePorts = new Map<number, string>();

  constructor(
    private bridge: WorkerBridge,
    private swTarget?: { postMessage: (msg: any, transfer?: any[]) => void }
  ) {
    this.bridge.onMessage((msg: WorkerOutboundMessage) => {
      if (msg.type === 'port:listen') {
        const port = msg.port;
        const bridgePort = msg.bridgePort || msg.messagePort;
        const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
        const url = `${origin}/__preview/${port}/`;
        this.activePorts.set(port, url);

        // Auto-register with Service Worker
        if (this.swTarget) {
          this.swTarget.postMessage(
            { type: 'port:register', port },
            bridgePort ? [bridgePort] : undefined
          );
        } else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
          if (navigator.serviceWorker.controller) {
            (navigator.serviceWorker.controller as any).postMessage(
              { type: 'port:register', port },
              bridgePort ? [bridgePort] : undefined
            );
          } else if (navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then((reg) => {
              const sw = reg.active || reg.waiting || navigator.serviceWorker.controller;
              (sw as any)?.postMessage(
                { type: 'port:register', port },
                bridgePort ? [bridgePort] : undefined
              );
            }).catch(() => {});
          }
        }

        // Notify BroadcastChannel as fallback
        if (typeof BroadcastChannel !== 'undefined') {
          try {
            const ch = new BroadcastChannel('buddhilive-sandbox-sw');
            ch.postMessage({ type: 'port:register', port });
            ch.close();
          } catch (_) {}
        }

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

        // Auto-unregister with Service Worker
        if (this.swTarget) {
          this.swTarget.postMessage({ type: 'port:unregister', port });
        } else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'port:unregister', port });
          } else if (navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then((reg) => {
              const sw = reg.active || reg.waiting || navigator.serviceWorker.controller;
              sw?.postMessage({ type: 'port:unregister', port });
            }).catch(() => {});
          }
        }

        if (typeof BroadcastChannel !== 'undefined') {
          try {
            const ch = new BroadcastChannel('buddhilive-sandbox-sw');
            ch.postMessage({ type: 'port:unregister', port });
            ch.close();
          } catch (_) {}
        }

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
