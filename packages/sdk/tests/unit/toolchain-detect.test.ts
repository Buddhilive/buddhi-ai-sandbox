import { describe, it, expect, vi } from 'vitest';
import { ToolchainBundle } from '@buddhilive/sandbox-toolchain';

describe('Toolchain Detection & Lazy Loading Unit Tests (T051)', () => {
  it('loads ToolchainBundle dynamically and invokes progress callbacks', async () => {
    const progressSpy = vi.fn();
    const toolchain = await ToolchainBundle.load(progressSpy);

    expect(toolchain).toBeDefined();
    expect(progressSpy).toHaveBeenCalled();
  });

  it('executes node-gyp configure and compile steps via ToolchainBundle', async () => {
    const toolchain = await ToolchainBundle.load();
    const result = await toolchain.runNodeGyp('/node_modules/bcrypt');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('node-gyp configure');
    expect(result.stdout).toContain('Clang WASM');
  });
});
