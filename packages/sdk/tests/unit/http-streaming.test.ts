import { describe, it, expect } from 'vitest';
import { createServer } from '../../src/worker/shims/http.js';

describe('HTTP Chunked Streaming for React Server Components (RSC)', () => {
  it('streams multiple chunks incrementally over replyPort', async () => {
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/x-component; charset=utf-8');
      res.writeHead(200);

      res.write('0:{"name":"RSC Title"}\n');
      setTimeout(() => {
        res.write('1:I["$Sreact.suspense"]\n');
        res.end('2:{"data":"resolved"}\n');
      }, 10);
    });

    const receivedChunks: string[] = [];
    const channel = new MessageChannel();

    const streamPromise = new Promise<{ status: number; chunks: string[] }>((resolve) => {
      let status = 0;
      channel.port1.onmessage = (event) => {
        const data = event.data;
        if (data.type === 'headers') {
          status = data.status;
        } else if (data.type === 'chunk') {
          receivedChunks.push(new TextDecoder().decode(data.data));
        } else if (data.type === 'end') {
          resolve({ status, chunks: receivedChunks });
        }
      };
    });

    server.dispatchRequest({
      method: 'GET',
      path: '/rsc-page',
      headers: { accept: 'text/x-component' },
      body: null,
      replyPort: channel.port2,
    });

    const result = await streamPromise;
    expect(result.status).toBe(200);
    expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    expect(result.chunks.join('')).toContain('RSC Title');
    expect(result.chunks.join('')).toContain('resolved');
  });
});
