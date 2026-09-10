import { NodeGypRunner } from './node-gyp-runner.js';
import { PythonRuntime } from './python.js';
import { ClangCompiler } from './clang.js';
import { EsbuildCompiler } from './esbuild-compiler.js';
import { SqliteRuntime, SqliteDatabase } from './sqlite-runtime.js';
import { ImageProcessor } from './image-processor.js';

export class ToolchainBundle {
  private static instance: ToolchainBundle | null = null;
  private runner = new NodeGypRunner();
  private esbuild = new EsbuildCompiler();
  private imageProcessor = new ImageProcessor();
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

  getEsbuildCompiler(): EsbuildCompiler {
    return this.esbuild;
  }

  getImageProcessor(): ImageProcessor {
    return this.imageProcessor;
  }

  getSqliteRuntime(): typeof SqliteRuntime {
    return SqliteRuntime;
  }
}

export {
  NodeGypRunner,
  PythonRuntime,
  ClangCompiler,
  EsbuildCompiler,
  SqliteRuntime,
  SqliteDatabase,
  ImageProcessor,
};


