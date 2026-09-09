import { globalPortRegistry } from './port-registry.js';

export async function bridgeRequest(
  portNumber: number,
  request: Request,
  relativePath: string
): Promise<Response> {
  const portEntry = globalPortRegistry.get(portNumber);

  if (!portEntry) {
    return new Response(
      `<html><body><h2>503 Service Unavailable</h2><p>No virtual HTTP server listening on port ${portNumber}.</p></body></html>`,
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        },
      }
    );
  }

  // If a MessagePort exists for forwarding to WASM Worker
  if (portEntry.messagePort) {
    const channel = new MessageChannel();
    const headersMap: Record<string, string> = {};
    request.headers.forEach((v, k) => {
      headersMap[k] = v;
    });

    const bodyBuffer = request.method !== 'GET' && request.method !== 'HEAD'
      ? await request.arrayBuffer()
      : null;

    return new Promise<Response>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(
          new Response(
            `<html><body><h2>504 Gateway Timeout</h2><p>Port ${portNumber} timed out responding.</p></body></html>`,
            { status: 504, headers: { 'Content-Type': 'text/html' } }
          )
        );
      }, 10000);

      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        const { status, statusText, headers, body } = event.data;
        const res = new Response(body, {
          status: status || 200,
          statusText: statusText || 'OK',
          headers: {
            ...headers,
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
          },
        });
        resolve(res);
      };

      portEntry.messagePort!.postMessage(
        {
          type: 'http:request',
          port: portNumber,
          path: relativePath,
          method: request.method,
          headers: headersMap,
          body: bodyBuffer,
          replyPort: channel.port2,
        },
        [channel.port2]
      );
    });
  }

  // Default synthetic response if virtual port is registered without custom handler
  return new Response(
    `<!DOCTYPE html><html><head><title>Preview ${portNumber}</title></head><body><h1>Preview Server on Port ${portNumber}</h1><p>Status: Active</p><p>Path: ${relativePath}</p></body></html>`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    }
  );
}
