import { describe, it, expect } from 'vitest';
import { PortsNamespace } from '../../src/ports-namespace.js';
import { WorkerBridge } from '../../src/worker-bridge.js';

class MockPortWorker {
  public onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage() {}
  terminate() {}
}

class MockServiceWorker {
  public registered: Array<{ port: number; messagePort?: MessagePort }> = [];
  public unregistered: number[] = [];

  postMessage(msg: any, transfer?: any[]) {
    if (msg.type === 'port:register') {
      this.registered.push({ port: msg.port, messagePort: transfer?.[0] });
    } else if (msg.type === 'port:unregister') {
      this.unregistered.push(msg.port);
    }
  }
}

describe('Ports Service Worker Bridge (US2)', () => {
  it('automatically registers port and transfers bridgePort to Service Worker', () => {
    const mockWorker = new MockPortWorker();
    const mockSw = new MockServiceWorker();
    const bridge = new WorkerBridge(mockWorker as any);
    const portsNs = new PortsNamespace(bridge, mockSw);

    const channel = new MessageChannel();
    const bridgePort = channel.port2;

    mockWorker.onmessage?.({
      data: {
        type: 'port:listen',
        port: 3000,
        bridgePort,
      },
    } as any);

    expect(portsNs.getPreviewUrl(3000)).toContain('/__preview/3000/');
    expect(mockSw.registered.length).toBe(1);
    expect(mockSw.registered[0].port).toBe(3000);
    expect(mockSw.registered[0].messagePort).toBe(bridgePort);
  });

  it('unregisters port with Service Worker on port:close', () => {
    const mockWorker = new MockPortWorker();
    const mockSw = new MockServiceWorker();
    const bridge = new WorkerBridge(mockWorker as any);
    const portsNs = new PortsNamespace(bridge, mockSw);

    mockWorker.onmessage?.({
      data: {
        type: 'port:listen',
        port: 4000,
      },
    } as any);

    expect(portsNs.getPreviewUrl(4000)).toBeDefined();

    mockWorker.onmessage?.({
      data: {
        type: 'port:close',
        port: 4000,
      },
    } as any);

    expect(portsNs.getPreviewUrl(4000)).toBeUndefined();
    expect(mockSw.unregistered).toContain(4000);
  });
});
