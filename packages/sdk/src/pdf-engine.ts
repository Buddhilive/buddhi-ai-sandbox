import {
  ExtractedDocument,
  ExtractionOptions,
  PdfExtractionError,
  WorkerOutboundMessage,
} from './types.js';
import { WorkerBridge } from './worker-bridge.js';
import { FsNamespace } from './fs-namespace.js';

export class PdfEngine {
  private bridge?: WorkerBridge;
  private fs?: FsNamespace;
  private standaloneWorker?: Worker;

  constructor(bridge?: WorkerBridge, fs?: FsNamespace) {
    this.bridge = bridge;
    this.fs = fs;
  }

  /**
   * Extract structured content and markdown from PDF bytes.
   */
  public async extract(
    source: Uint8Array | ArrayBuffer,
    options?: ExtractionOptions
  ): Promise<ExtractedDocument> {
    const data = source instanceof Uint8Array ? source : new Uint8Array(source);

    if (data.length === 0) {
      throw new PdfExtractionError('PDF data buffer is empty', 'ERR_EMPTY_PDF');
    }

    const id =
      options?.documentId ||
      `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Check if caching in VFS is requested and already exists
    if (options?.cacheInVfs && this.fs) {
      const cachedPath = `/documents/${id}/extracted.json`;
      try {
        const cachedBytes = await this.fs.readFile(cachedPath);
        const text = new TextDecoder().decode(cachedBytes);
        return JSON.parse(text) as ExtractedDocument;
      } catch {
        // Cache miss, proceed with extraction
      }
    }

    const bridge = await this.getBridge();

    return new Promise<ExtractedDocument>((resolve, reject) => {
      let cleanedUp = false;

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        unsub();
        if (options?.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        bridge.postMessage({ type: 'pdf:abort', id });
        cleanup();
        reject(
          new PdfExtractionError(
            'PDF extraction was aborted by caller',
            'ERR_ABORTED'
          )
        );
      };

      if (options?.signal) {
        if (options.signal.aborted) {
          return reject(
            new PdfExtractionError(
              'PDF extraction was aborted by caller',
              'ERR_ABORTED'
            )
          );
        }
        options.signal.addEventListener('abort', onAbort);
      }

      const unsub = bridge.onMessage((msg: WorkerOutboundMessage) => {
        if (msg.type === 'pdf:progress' && msg.id === id) {
          options?.onProgress?.(msg.progress);
        } else if (msg.type === 'pdf:result' && msg.id === id) {
          cleanup();
          // Cache in VFS if enabled
          if (options?.cacheInVfs && this.fs) {
            const docDir = `/documents/${id}`;
            this.fs
              .mkdir(docDir, { recursive: true })
              .then(() => {
                const jsonBytes = new TextEncoder().encode(
                  JSON.stringify(msg.result, null, 2)
                );
                return Promise.all([
                  this.fs!.writeFile(`${docDir}/original.pdf`, data),
                  this.fs!.writeFile(`${docDir}/extracted.json`, jsonBytes),
                ]);
              })
              .catch((err) => {
                console.warn(
                  '[PdfEngine] Failed to cache document in VirtualFS:',
                  err
                );
              });
          }
          resolve(msg.result);
        } else if (msg.type === 'pdf:error' && msg.id === id) {
          cleanup();
          reject(new PdfExtractionError(msg.error, msg.code));
        }
      });

      bridge.postMessage({
        type: 'pdf:extract',
        id,
        data,
        options: {
          extractTables: options?.extractTables ?? true,
          extractImages: options?.extractImages ?? false,
          documentId: id,
        },
      });
    });
  }

  private async getBridge(): Promise<WorkerBridge> {
    if (this.bridge) return this.bridge;

    // Standalone worker mode
    if (!this.standaloneWorker) {
      const workerUrl = new URL('./worker/sandbox.worker.js', import.meta.url);
      this.standaloneWorker = new Worker(workerUrl, { type: 'module' });
      this.bridge = new WorkerBridge(this.standaloneWorker);
    }
    return this.bridge!;
  }
}
