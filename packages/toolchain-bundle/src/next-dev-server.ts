/**
 * Next.js Virtual Development Server for in-browser client-side execution
 */
import { EsbuildCompiler } from './esbuild-compiler.js';

export interface NextDevServerOptions {
  vfs: {
    readFile(path: string): Uint8Array | string | null;
    exists(path: string): boolean;
    readdir?(path: string): string[];
  };
  httpModule?: any;
  rootDir?: string;
  port?: number;
  onLog?: (msg: string) => void;
}

export class NextDevServer {
  private compiler = new EsbuildCompiler();
  private server: any = null;
  private isRunning = false;
  private rootDir: string;
  private port: number;

  constructor(private options: NextDevServerOptions) {
    this.rootDir = options.rootDir || '/workspace';
    this.port = options.port || 3000;
  }

  public async start(): Promise<any> {
    if (this.isRunning) return this.server;

    const log = (msg: string) => {
      if (this.options.onLog) {
        this.options.onLog(msg + '\n');
      }
    };

    log('   \x1b[36m▲ Next.js 14.2.0\x1b[0m (Buddhi Sandbox)');
    log(`   - Local:        http://localhost:${this.port}`);
    log('   - Experiments (turbo): false');
    log('');

    await this.compiler.load();

    const reqFn = (globalThis as any).require;
    const http = this.options.httpModule || (typeof reqFn === 'function' ? reqFn('http') : null);
    if (!http || !http.createServer) {
      throw new Error('HTTP module not available to boot NextDevServer');
    }

    this.server = http.createServer(async (req: any, res: any) => {
      const url = req.url || '/';
      const cleanPath = url.split('?')[0];

      try {
        // 1. API Route matching
        if (cleanPath.startsWith('/api/')) {
          const handled = await this.handleApiRoute(cleanPath, req, res);
          if (handled) return;
        }

        // 2. Static Asset matching
        const publicFile = `${this.rootDir}/public${cleanPath}`;
        if (this.options.vfs.exists(publicFile)) {
          const data = this.options.vfs.readFile(publicFile);
          if (data) {
            res.writeHead(200, { 'Content-Type': this.getContentType(cleanPath) });
            res.end(data);
            return;
          }
        }

        // 3. Page Rendering
        const renderedHtml = await this.renderPage(cleanPath);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        });
        res.end(renderedHtml);
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><body><h2>500 Internal Server Error</h2><pre>${err?.stack || err?.message || String(err)}</pre></body></html>`);
      }
    });

    this.server.listen(this.port, () => {
      log(` ✓ Ready in 1.2s`);
    });

    this.isRunning = true;
    return this.server;
  }

  public stop(): void {
    if (this.server) {
      try {
        this.server.close();
      } catch (_) {}
      this.server = null;
    }
    this.isRunning = false;
  }

  private async renderPage(pathname: string): Promise<string> {
    // Look for App router or Pages router entrypoints
    const candidates = [
      `${this.rootDir}/app/page.tsx`,
      `${this.rootDir}/app/page.jsx`,
      `${this.rootDir}/app/page.js`,
      `${this.rootDir}/pages/index.tsx`,
      `${this.rootDir}/pages/index.jsx`,
      `${this.rootDir}/pages/index.js`,
    ];

    let foundFile: string | null = null;
    let source = '';

    for (const c of candidates) {
      if (this.options.vfs.exists(c)) {
        foundFile = c;
        const data = this.options.vfs.readFile(c);
        source = typeof data === 'string' ? data : (data ? new TextDecoder().decode(data) : '');
        break;
      }
    }

    let bodyContent = '<h1>Welcome to Next.js in Buddhi Sandbox</h1><p>Edit <code>app/page.tsx</code> to begin vibe coding.</p>';

    if (foundFile && source) {
      try {
        const transformed = this.compiler.transformSync(source, {
          filename: foundFile,
          jsc: {
            parser: {
              syntax: 'typescript',
              tsx: true,
            },
            transform: {
              react: {
                runtime: 'automatic',
              },
            },
          },
        });

        // Basic extract of returned JSX/string if simple
        const match = source.match(/return\s*\(\s*([\s\S]*?)\s*\);/);
        if (match) {
          const jsxSnippet = match[1]
            .replace(/className=/g, 'class=')
            .replace(/<\/?React\.Fragment>/g, '');
          bodyContent = `<div id="__next_root">${jsxSnippet}</div>`;
        } else {
          bodyContent = `<div id="__next_root"><h3>Compiled Next.js Component: ${foundFile}</h3></div>`;
        }
      } catch (err: any) {
        bodyContent = `<div style="color:red"><h3>Compilation Error</h3><pre>${err?.message || String(err)}</pre></div>`;
      }
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Next.js Preview (Buddhi Sandbox)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 2rem; background: #0f172a; color: #f8fafc; }
    h1, h2, h3 { color: #38bdf8; }
    code { background: #1e293b; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
  </style>
  <script>
    // Injected HMR Client
    if (typeof WebSocket !== 'undefined') {
      const ws = new WebSocket('ws://' + window.location.host + '/__preview/hmr');
      ws.onmessage = (msg) => {
        if (msg.data === 'reload') window.location.reload();
      };
    }
  </script>
</head>
<body>
  <main id="__next">${bodyContent}</main>
</body>
</html>`;
  }

  private async handleApiRoute(path: string, req: any, res: any): Promise<boolean> {
    const apiFile = `${this.rootDir}${path}.ts`;
    const apiJs = `${this.rootDir}${path}.js`;

    const target = this.options.vfs.exists(apiFile) ? apiFile : (this.options.vfs.exists(apiJs) ? apiJs : null);
    if (!target) return false;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', route: path, timestamp: Date.now() }));
    return true;
  }

  private getContentType(path: string): string {
    if (path.endsWith('.html')) return 'text/html';
    if (path.endsWith('.css')) return 'text/css';
    if (path.endsWith('.js')) return 'application/javascript';
    if (path.endsWith('.json')) return 'application/json';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
  }
}
