import { describe, it, expect } from 'vitest';
import { createServer } from '../../src/worker/shims/http.js';
import { Inter, Geist } from '../../src/worker/shims/font-resolver.js';
import { interceptRequire } from '../../src/worker/shims/addon-interceptor.js';

describe('Next.js Routing, Middleware & Assets', () => {
  it('middleware: handles redirect response codes correctly', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/secret') {
        res.writeHead(307, { Location: '/login' });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end('public');
    });

    const channel = new MessageChannel();
    const resPromise = new Promise<{ status: number; location?: string }>((resolve) => {
      let status = 0;
      let location: string | undefined;
      channel.port1.onmessage = (event) => {
        if (event.data.type === 'headers') {
          status = event.data.status;
          location = event.data.headers?.location;
        } else if (event.data.type === 'end') {
          resolve({ status, location });
        }
      };
    });

    server.dispatchRequest({
      method: 'GET',
      path: '/secret',
      headers: {},
      body: null,
      replyPort: channel.port2,
    });

    const result = await resPromise;
    expect(result.status).toBe(307);
    expect(result.location).toBe('/login');
  });

  it('fonts: loads font helper and exposes css variable names', () => {
    const interFont = Inter({ variable: '--font-inter' });
    expect(interFont.variable).toBe('--font-inter');
    expect(interFont.className).toContain('inter');

    const geistFont = Geist();
    expect(geistFont.variable).toBe('--font-geist');
  });

  it('addon-interceptor: intercepts next/font imports synchronously', () => {
    const fontMod = interceptRequire('next/font/google');
    expect(fontMod).not.toBeNull();
    expect(typeof fontMod.Inter).toBe('function');
    const inter = fontMod.Inter();
    expect(inter.variable).toBe('--font-inter');
  });
});
