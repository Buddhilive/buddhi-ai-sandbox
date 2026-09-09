import { FsNamespace } from './fs-namespace.js';

export class ModuleResolver {
  constructor(private fs: FsNamespace) {}

  async resolve(specifier: string, fromDir: string = '/workspace'): Promise<string> {
    // 1. Built-in modules
    if (specifier === 'path' || specifier === 'node:path') return 'builtin:path';
    if (specifier === 'fs' || specifier === 'node:fs') return 'builtin:fs';
    if (specifier === 'http' || specifier === 'node:http') return 'builtin:http';
    if (specifier === 'events' || specifier === 'node:events') return 'builtin:events';

    // 2. Relative or absolute path
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const rawPath = specifier.startsWith('/')
        ? specifier
        : `${fromDir}/${specifier}`;
      const segments = rawPath.split('/').filter((s) => s.length > 0 && s !== '.');
      const normalized = '/' + segments.join('/');
      return await this.resolveFileOrDirectory(normalized);
    }

    // 3. Package lookup in /node_modules
    const pkgDir = `/node_modules/${specifier}`;
    return await this.resolvePackageEntry(pkgDir);
  }

  private async resolveFileOrDirectory(pathStr: string): Promise<string> {
    const candidates = [
      pathStr,
      `${pathStr}.js`,
      `${pathStr}.json`,
      `${pathStr}/index.js`,
      `${pathStr}/index.json`,
    ];

    for (const candidate of candidates) {
      try {
        const stat = await this.fs.stat(candidate);
        if (stat.isFile) {
          return candidate;
        }
      } catch (_) {
        // File does not exist, continue
      }
    }

    throw new Error(`Cannot find module '${pathStr}'`);
  }

  private async resolvePackageEntry(pkgDir: string): Promise<string> {
    try {
      const pkgJsonStr = await this.fs.readFile(`${pkgDir}/package.json`, 'utf-8');
      const pkgJson = JSON.parse(pkgJsonStr);

      if (pkgJson.main) {
        const mainPath = `${pkgDir}/${pkgJson.main.replace(/^\.\//, '')}`;
        return await this.resolveFileOrDirectory(mainPath);
      }
    } catch (_) {
      // package.json missing or invalid, fallback to index.js
    }

    return await this.resolveFileOrDirectory(pkgDir);
  }
}
