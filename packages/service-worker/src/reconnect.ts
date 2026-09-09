import { globalPortRegistry } from './port-registry.js';

export function setupReconnectionHandshake(): void {
  if (typeof BroadcastChannel === 'undefined') return;

  const channel = new BroadcastChannel('buddhilive-sandbox-sw');

  channel.onmessage = (event) => {
    const { type, port } = event.data;
    if (type === 'port:register' && typeof port === 'number') {
      globalPortRegistry.register(port);
      channel.postMessage({ type: 'port:registered', port });
    } else if (type === 'port:unregister' && typeof port === 'number') {
      globalPortRegistry.unregister(port);
    } else if (type === 'sw:ping') {
      channel.postMessage({
        type: 'sw:pong',
        ports: globalPortRegistry.list(),
      });
    }
  };

  // Announce SW activation
  channel.postMessage({
    type: 'sw:ready',
    ports: globalPortRegistry.list(),
  });
}
