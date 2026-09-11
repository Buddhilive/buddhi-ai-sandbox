import { describe, it, expect } from 'vitest';
import { NextRuntime, NextDevServer } from '@buddhilive/sandbox-toolchain';
import httpShim from '../../src/worker/shims/http.js';

describe('Next.js Virtual Toolchain Dev Server (US3)', () => {
  it('installs Next.js and React shims into VFS', () => {
    const fsMap = new Map<string, string>();
    const vfs = {
      writeFile: (p: string, d: string | Uint8Array) => {
        fsMap.set(p, typeof d === 'string' ? d : new TextDecoder().decode(d));
      },
      mkdir: () => {},
      exists: (p: string) => fsMap.has(p),
    };

    NextRuntime.installNextShims(vfs, '/workspace');

    expect(fsMap.has('/workspace/node_modules/next/package.json')).toBe(true);
    expect(fsMap.has('/workspace/node_modules/react/package.json')).toBe(true);
    expect(fsMap.has('/workspace/node_modules/react-dom/package.json')).toBe(true);

    const nextPkg = JSON.parse(fsMap.get('/workspace/node_modules/next/package.json')!);
    expect(nextPkg.name).toBe('next');
    expect(nextPkg.version).toBe('14.2.0');
  });

  it('boots NextDevServer and serves rendered HTML for app/page.tsx', async () => {
    const files: Record<string, string> = {
      '/workspace/app/page.tsx': `
        export default function Page() {
          return (
            <div className="container">
              <h1>Buddhi AI Next.js App</h1>
              <p>Vibe coding in full browser sandbox!</p>
            </div>
          );
        }
      `,
    };

    const vfs = {
      readFile: (p: string) => files[p] || null,
      exists: (p: string) => p in files,
    };

    const logs: string[] = [];
    const devServer = new NextDevServer({
      vfs,
      httpModule: httpShim,
      rootDir: '/workspace',
      port: 3000,
      onLog: (l) => logs.push(l),
    });

    const server = await devServer.start();
    expect(server).toBeDefined();
    expect(logs.some((l) => l.includes('Next.js 14.2.0'))).toBe(true);

    // Dispatch a simulated HTTP request
    const channel = new MessageChannel();
    const responsePromise = new Promise<{ status: number; body: string }>((resolve) => {
      let status = 200;
      let body = '';
      const decoder = new TextDecoder();

      channel.port1.onmessage = (e) => {
        const data = e.data;
        if (data.type === 'headers') {
          status = data.status;
        } else if (data.type === 'chunk') {
          body += decoder.decode(data.data);
        } else if (data.type === 'end') {
          if (data.body) body += decoder.decode(data.body);
          resolve({ status, body });
        }
      };
    });

    server.dispatchRequest({
      method: 'GET',
      path: '/',
      headers: {},
      body: null,
      replyPort: channel.port2,
    });

    const res = await responsePromise;
    expect(res.status).toBe(200);
    expect(res.body).toContain('Buddhi AI Next.js App');
    expect(res.body).toContain('Vibe coding in full browser sandbox!');
    expect(res.body).toContain('/__preview/hmr');

    devServer.stop();
  });
});
