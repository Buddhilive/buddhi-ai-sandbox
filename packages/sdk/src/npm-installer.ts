import { gunzipSync } from 'fflate';
import { FsNamespace } from './fs-namespace.js';

export interface NpmInstallOptions {
  version?: string;
  registryUrl?: string;
  onToolchainNeeded?: (pkgName: string) => void;
}

export function untar(buffer: Uint8Array): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let offset = 0;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);

    // End of archive check: all zeros
    if (header.every((b) => b === 0)) {
      break;
    }

    // Read filename (0..100)
    let nameEnd = 0;
    while (nameEnd < 100 && header[nameEnd] !== 0) {
      nameEnd++;
    }
    const name = new TextDecoder().decode(header.subarray(0, nameEnd)).trim();

    // Read size in octal (124..136)
    let sizeStr = '';
    for (let i = 124; i < 136; i++) {
      const char = String.fromCharCode(header[i]);
      if (char >= '0' && char <= '7') {
        sizeStr += char;
      } else if (header[i] === 0 || char === ' ') {
        if (sizeStr.length > 0) break;
      }
    }
    const size = parseInt(sizeStr || '0', 8);

    offset += 512;
    if (size > 0 && name) {
      files[name] = buffer.slice(offset, offset + size);
    }
    offset += Math.ceil(size / 512) * 512;
  }

  return files;
}

export class NpmInstaller {
  constructor(private fs: FsNamespace) {}

  async install(packageName: string, options: NpmInstallOptions = {}): Promise<void> {
    const registry = options.registryUrl || 'https://registry.npmjs.org';
    const metadataUrl = `${registry}/${encodeURIComponent(packageName)}`;

    // 1. Fetch package metadata
    const metaRes = await fetch(metadataUrl, {
      headers: { Accept: 'application/json' },
    });

    if (!metaRes.ok) {
      throw new Error(`npm ERR! 404 Not Found - ${packageName} is not in the registry`);
    }

    const metadata = await metaRes.json();
    const version = options.version || metadata['dist-tags']?.latest;
    if (!version || !metadata.versions?.[version]) {
      throw new Error(`npm ERR! No matching version found for ${packageName}@${options.version || 'latest'}`);
    }

    const versionData = metadata.versions[version];
    const tarballUrl = versionData.dist?.tarball;
    if (!tarballUrl) {
      throw new Error(`npm ERR! No tarball found for ${packageName}@${version}`);
    }

    // 2. Fetch tarball
    const tarballRes = await fetch(tarballUrl);
    if (!tarballRes.ok) {
      throw new Error(`npm ERR! Failed to download tarball from ${tarballUrl}`);
    }

    const tarballBuffer = new Uint8Array(await tarballRes.arrayBuffer());

    // 3. Decompress gzipped tarball (detect 0x1f, 0x8b gzip magic header)
    const isGzipped = tarballBuffer.length >= 2 && tarballBuffer[0] === 0x1f && tarballBuffer[1] === 0x8b;
    const unzipped = isGzipped ? gunzipSync(tarballBuffer) : tarballBuffer;
    const tarEntries = untar(unzipped);

    // Ensure /node_modules exists
    await this.fs.mkdir('/node_modules', { recursive: true });
    const targetDir = `/node_modules/${packageName}`;
    await this.fs.mkdir(targetDir, { recursive: true });

    let hasBindingGyp = false;

    // 4. Write extracted entries to VirtualFS
    for (const [entryPath, fileData] of Object.entries(tarEntries)) {
      // Tarballs typically prefix files with "package/"
      const relPath = entryPath.startsWith('package/')
        ? entryPath.slice('package/'.length)
        : entryPath;

      if (!relPath || relPath.endsWith('/')) {
        continue;
      }

      if (relPath === 'binding.gyp') {
        hasBindingGyp = true;
      }

      const fullPath = `${targetDir}/${relPath}`;
      const lastSlash = fullPath.lastIndexOf('/');
      if (lastSlash !== -1) {
        const parentDir = fullPath.slice(0, lastSlash);
        await this.fs.mkdir(parentDir, { recursive: true });
      }

      await this.fs.writeFile(fullPath, fileData);
    }

    // 5. Update /package.json
    try {
      let pkgJson: any = { dependencies: {} };
      try {
        const existingRaw = await this.fs.readFile('/package.json', 'utf-8');
        pkgJson = JSON.parse(existingRaw);
      } catch (_) {
        // No existing package.json, initialize fresh
      }
      if (!pkgJson.dependencies) pkgJson.dependencies = {};
      pkgJson.dependencies[packageName] = `^${version}`;
      await this.fs.writeFile('/package.json', JSON.stringify(pkgJson, null, 2));
    } catch (_) {
      // Non-fatal package.json sync error
    }

    // 6. Handle .bin links if present in package.json
    if (versionData.bin) {
      await this.fs.mkdir('/node_modules/.bin', { recursive: true });
      const bins = typeof versionData.bin === 'string'
        ? { [packageName]: versionData.bin }
        : versionData.bin;

      for (const [binName, binTarget] of Object.entries(bins)) {
        try {
          await this.fs.symlink(
            `${targetDir}/${binTarget}`,
            `/node_modules/.bin/${binName}`
          );
        } catch (_) {
          // Continue if symlink fails
        }
      }
    }

    // 7. Check for native toolchain requirement (P4 / US4)
    if (hasBindingGyp && options.onToolchainNeeded) {
      options.onToolchainNeeded(packageName);
    }
  }
}
