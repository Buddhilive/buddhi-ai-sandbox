import { NodeGypRunner } from './node-gyp-runner.js';
import { PythonRuntime } from './python.js';
import { ClangCompiler } from './clang.js';

export class ToolchainBundle {
  private static instance: ToolchainBundle | null = null;
  private runner = new NodeGypRunner();
  private loaded = false;

  static async load(onProgress?: (loaded: number, total: number) => void): Promise<ToolchainBundle> {
    if (!ToolchainBundle.instance) {
      ToolchainBundle.instance = new ToolchainBundle();
    }

    if (!ToolchainBundle.instance.loaded) {
      // Simulate chunk download progress
      const total = 28 * 1024 * 1024; // ~28MB bundle
      if (onProgress) {
        onProgress(Math.floor(total * 0.3), total);
        onProgress(Math.floor(total * 0.7), total);
        onProgress(total, total);
      }
      ToolchainBundle.instance.loaded = true;
    }

    return ToolchainBundle.instance;
  }

  async runNodeGyp(packageDir: string) {
    return await this.runner.build(packageDir);
  }
}

export { NodeGypRunner, PythonRuntime, ClangCompiler };
