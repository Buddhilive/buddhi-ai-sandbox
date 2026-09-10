/**
 * Contracts for Toolchain Bundle Dynamic Compiler Loaders in packages/toolchain-bundle
 */

export interface SwcTransformOptions {
  filename?: string;
  sourceMaps?: boolean | 'inline';
  jsc?: {
    parser?: {
      syntax?: 'ecmascript' | 'typescript';
      tsx?: boolean;
      jsx?: boolean;
      dynamicImport?: boolean;
    };
    transform?: {
      react?: {
        runtime?: 'automatic' | 'classic';
        development?: boolean;
        refresh?: boolean;
      };
    };
    target?: string;
  };
}

export interface SwcTransformResult {
  code: string;
  map?: string;
}

export interface EsbuildCompilerContract {
  isLoaded: boolean;
  load(): Promise<void>;
  transform(source: string, options: SwcTransformOptions): Promise<SwcTransformResult>;
  transformSync(source: string, options: SwcTransformOptions): SwcTransformResult;
}

export interface SqliteRuntimeContract {
  isLoaded: boolean;
  load(): Promise<void>;
  open(dbPath: string): Promise<any>;
}
