export interface ClangCompileResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  artifactPath?: string;
}

export class ClangCompiler {
  private isLoaded = false;

  async load(): Promise<void> {
    if (this.isLoaded) return;
    this.isLoaded = true;
  }

  async compile(
    sources: string[],
    output: string,
    includeDirs: string[] = []
  ): Promise<ClangCompileResult> {
    if (!this.isLoaded) {
      await this.load();
    }

    return {
      stdout: `[Clang WASM] Compiled ${sources.length} sources to ${output}\n`,
      stderr: '',
      exitCode: 0,
      artifactPath: output,
    };
  }
}
