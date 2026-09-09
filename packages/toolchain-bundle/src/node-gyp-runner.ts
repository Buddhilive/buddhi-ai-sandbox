import { PythonRuntime } from './python.js';
import { ClangCompiler } from './clang.js';

export interface NodeGypResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class NodeGypRunner {
  private python = new PythonRuntime();
  private clang = new ClangCompiler();

  async build(packageDir: string): Promise<NodeGypResult> {
    let stdoutAcc = '';
    let stderrAcc = '';

    // Step 1: Configure
    stdoutAcc += `gyp info it worked if it ends with ok\n`;
    stdoutAcc += `gyp info using node-gyp@10.0.0\n`;
    const pyRes = await this.python.run('node-gyp configure', [packageDir]);
    stdoutAcc += pyRes.stdout;
    if (pyRes.exitCode !== 0) {
      stderrAcc += pyRes.stderr;
      return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: pyRes.exitCode };
    }

    // Step 2: Compile native targets
    const clangRes = await this.clang.compile(
      [`${packageDir}/binding.cc`],
      `${packageDir}/build/Release/addon.node`,
      [`${packageDir}/include`]
    );
    stdoutAcc += clangRes.stdout;
    if (clangRes.exitCode !== 0) {
      stderrAcc += clangRes.stderr;
      return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: clangRes.exitCode };
    }

    stdoutAcc += `gyp info ok\n`;
    return {
      stdout: stdoutAcc,
      stderr: stderrAcc,
      exitCode: 0,
    };
  }
}
