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
      let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
      let responseResolved = false;
      let initialStatus = 200;
      let initialStatusText = 'OK';
      const initialHeaders = new Headers({
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      });

      const timeout = setTimeout(() => {
        if (!responseResolved) {
          responseResolved = true;
          resolve(
            new Response(
              `<html><body><h2>504 Gateway Timeout</h2><p>Port ${portNumber} timed out responding.</p></body></html>`,
              { status: 504, headers: { 'Content-Type': 'text/html' } }
            )
          );
        }
      }, 15000);

      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        const data = event.data;

        if (data.type === 'headers') {
          initialStatus = data.status || 200;
          initialStatusText = data.statusText || 'OK';
          if (data.headers) {
            for (const [k, v] of Object.entries(data.headers)) {
              initialHeaders.set(k, String(v));
            }
          }
          return;
        }

        if (data.type === 'chunk') {
          if (!responseResolved) {
            responseResolved = true;
            const stream = new ReadableStream<Uint8Array>({
              start(c) {
                streamController = c;
                c.enqueue(new Uint8Array(data.data));
              },
            });
            resolve(
              new Response(stream, {
                status: initialStatus,
                statusText: initialStatusText,
                headers: initialHeaders,
              })
            );
          } else if (streamController) {
            streamController.enqueue(new Uint8Array(data.data));
          }
          return;
        }

        if (data.type === 'end' || !data.type) {
          if (streamController) {
            if (data.body && data.body.byteLength > 0) {
              streamController.enqueue(new Uint8Array(data.body));
            }
            streamController.close();
          } else if (!responseResolved) {
            responseResolved = true;
            if (data.headers) {
              for (const [k, v] of Object.entries(data.headers)) {
                initialHeaders.set(k, String(v));
              }
            }
            const res = new Response(data.body || null, {
              status: data.status || initialStatus,
              statusText: data.statusText || initialStatusText,
              headers: initialHeaders,
            });
            resolve(res);
          }
        }
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
