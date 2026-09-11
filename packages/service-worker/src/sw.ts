/// <reference lib="webworker" />
import { bridgeRequest } from './request-bridge.js';
import { setupReconnectionHandshake } from './reconnect.js';
import { globalPortRegistry } from './port-registry.js';

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  const { type, port } = data;

  if (type === 'port:register' && typeof port === 'number') {
    const messagePort = event.ports && event.ports[0];
    globalPortRegistry.register(port, messagePort);
    if (event.source && 'postMessage' in event.source) {
      (event.source as any).postMessage({ type: 'port:registered', port });
    }
  } else if (type === 'port:unregister' && typeof port === 'number') {
    globalPortRegistry.unregister(port);
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      setupReconnectionHandshake();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Match /__preview/:port/ or /__preview/:port/*
  const previewMatch = url.pathname.match(/^\/__preview\/(\d+)(.*)/);

  if (previewMatch) {
    const port = parseInt(previewMatch[1], 10);
    const subpath = previewMatch[2] || '/';
    event.respondWith(bridgeRequest(port, event.request, subpath));
    return;
  }

  // Cross-Origin Isolation injection for same-origin resources
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const response = await fetch(event.request);
        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })()
    );
  }
});
