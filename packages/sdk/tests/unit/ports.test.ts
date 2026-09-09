import { describe, it, expect } from 'vitest';
import { PortsNamespace } from '../../src/ports-namespace.js';
import { WorkerBridge } from '../../src/worker-bridge.js';

class MockPortsWorker {
  public onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage() {}
  terminate() {}
}

describe('PortsNamespace Unit Tests (T029)', () => {
  it('emits listen event and generates preview URL when virtual port opens', () => {
    const mockWorker = new MockPortsWorker();
    const bridge = new WorkerBridge(mockWorker as any);
    const ports = new PortsNamespace(bridge);

    let eventFired = false;
    let receivedPort = 0;
    let receivedUrl = '';

    ports.on('listen', (ev) => {
      eventFired = true;
      receivedPort = ev.port;
      receivedUrl = ev.url;
    });

    // Simulate worker message
    mockWorker.onmessage?.({
      data: {
        type: 'port:listen',
        port: 3000,
      },
    } as any);

    expect(eventFired).toBe(true);
    expect(receivedPort).toBe(3000);
    expect(receivedUrl).toContain('/__preview/3000/');
    expect(ports.getPreviewUrl(3000)).toBe(receivedUrl);
  });

  it('emits close event when virtual port closes', () => {
    const mockWorker = new MockPortsWorker();
    const bridge = new WorkerBridge(mockWorker as any);
    const ports = new PortsNamespace(bridge);

    let closeFired = false;
    ports.on('close', (ev) => {
      closeFired = true;
      expect(ev.port).toBe(8080);
    });

    mockWorker.onmessage?.({
      data: {
        type: 'port:close',
        port: 8080,
      },
    } as any);

    expect(closeFired).toBe(true);
    expect(ports.getPreviewUrl(8080)).toBeUndefined();
  });
});
