import { describe, it, expect, vi } from 'vitest';
import { PdfEngine } from '../../src/pdf-engine.js';
import {
  ExtractedDocument,
  ExtractionProgress,
  PdfExtractionError,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from '../../src/types.js';
import { WorkerBridge } from '../../src/worker-bridge.js';

describe('PdfEngine SDK Client', () => {
  it('rejects empty input buffer with ERR_EMPTY_PDF', async () => {
    const engine = new PdfEngine();
    await expect(engine.extract(new Uint8Array(0))).rejects.toThrow(PdfExtractionError);
  });

  it('sends extract request to worker bridge and streams progress events', async () => {
    let capturedMessage: WorkerInboundMessage | null = null;
    let messageHandler: ((msg: WorkerOutboundMessage) => void) | null = null;

    const mockBridge = {
      postMessage: vi.fn((msg: WorkerInboundMessage) => {
        capturedMessage = msg;
        if (msg.type === 'pdf:extract') {
          // Simulate worker emitting progress
          setTimeout(() => {
            messageHandler?.({
              type: 'pdf:progress',
              id: msg.id,
              progress: {
                stage: 'extracting_pages',
                pageCurrent: 1,
                pageTotal: 5,
                percent: 20,
                message: 'Parsing pages',
              },
            });

            // Simulate worker returning complete result
            const mockDoc: ExtractedDocument = {
              id: msg.id,
              metadata: {
                title: 'Quantum Computing Survey',
                totalPages: 5,
              },
              markdown: '# Quantum Computing Survey\n\nAbstract content here.',
              pages: [
                {
                  pageNumber: 1,
                  width: 612,
                  height: 792,
                  blocks: [
                    {
                      id: 'b1',
                      type: 'heading',
                      text: 'Quantum Computing Survey',
                      level: 1,
                      pageNumber: 1,
                      bbox: { x: 72, y: 700, width: 200, height: 24 },
                    },
                  ],
                  tables: [],
                },
              ],
              toc: [
                {
                  title: 'Quantum Computing Survey',
                  level: 1,
                  pageNumber: 1,
                },
              ],
            };

            messageHandler?.({
              type: 'pdf:result',
              id: msg.id,
              result: mockDoc,
            });
          }, 10);
        }
      }),
      onMessage: vi.fn((handler: (msg: WorkerOutboundMessage) => void) => {
        messageHandler = handler;
        return () => {
          messageHandler = null;
        };
      }),
    } as unknown as WorkerBridge;

    const engine = new PdfEngine(mockBridge);
    const progressList: ExtractionProgress[] = [];

    const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x31]); // %PDF1
    const result = await engine.extract(dummyPdf, {
      documentId: 'custom_doc_123',
      onProgress: (p) => progressList.push(p),
    });

    expect(capturedMessage).toBeDefined();
    expect((capturedMessage as any)?.type).toBe('pdf:extract');
    expect((capturedMessage as any)?.id).toBe('custom_doc_123');

    expect(progressList.length).toBe(1);
    expect(progressList[0].stage).toBe('extracting_pages');
    expect(progressList[0].percent).toBe(20);

    expect(result.id).toBe('custom_doc_123');
    expect(result.metadata.title).toBe('Quantum Computing Survey');
    expect(result.pages[0].blocks[0].type).toBe('heading');
  });

  it('supports cancellation via AbortSignal', async () => {
    let messageHandler: ((msg: WorkerOutboundMessage) => void) | null = null;
    const mockBridge = {
      postMessage: vi.fn(),
      onMessage: vi.fn((handler: (msg: WorkerOutboundMessage) => void) => {
        messageHandler = handler;
        return () => {
          messageHandler = null;
        };
      }),
    } as unknown as WorkerBridge;

    const controller = new AbortController();
    const engine = new PdfEngine(mockBridge);

    const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    // Abort before starting
    controller.abort();
    await expect(
      engine.extract(dummyPdf, { signal: controller.signal })
    ).rejects.toThrow('aborted');
  });

  it('caches extracted document in VirtualFS when cacheInVfs is true', async () => {
    let messageHandler: ((msg: WorkerOutboundMessage) => void) | null = null;
    const writtenFiles = new Map<string, Uint8Array>();

    const mockBridge = {
      postMessage: vi.fn((msg: WorkerInboundMessage) => {
        if (msg.type === 'pdf:extract') {
          setTimeout(() => {
            messageHandler?.({
              type: 'pdf:result',
              id: msg.id,
              result: {
                id: msg.id,
                metadata: { totalPages: 1 },
                markdown: 'Cached test',
                pages: [],
                toc: [],
              },
            });
          }, 10);
        }
      }),
      onMessage: vi.fn((handler: (msg: WorkerOutboundMessage) => void) => {
        messageHandler = handler;
        return () => {};
      }),
    } as unknown as WorkerBridge;

    const mockFs = {
      readFile: vi.fn(async (path: string) => {
        const data = writtenFiles.get(path);
        if (!data) throw new Error('Not found');
        return data;
      }),
      writeFile: vi.fn(async (path: string, data: Uint8Array) => {
        writtenFiles.set(path, data);
      }),
      mkdir: vi.fn(async () => {}),
    } as any;

    const engine = new PdfEngine(mockBridge, mockFs);
    const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    const result = await engine.extract(dummyPdf, {
      documentId: 'paper_007',
      cacheInVfs: true,
    });

    expect(result.id).toBe('paper_007');

    // Wait a tick for async VFS caching promise
    await new Promise((r) => setTimeout(r, 20));

    expect(mockFs.mkdir).toHaveBeenCalledWith('/documents/paper_007', { recursive: true });
    expect(writtenFiles.has('/documents/paper_007/original.pdf')).toBe(true);
    expect(writtenFiles.has('/documents/paper_007/extracted.json')).toBe(true);

    // Second call should hit the cache
    const cachedResult = await engine.extract(dummyPdf, {
      documentId: 'paper_007',
      cacheInVfs: true,
    });
    expect(cachedResult.markdown).toBe('Cached test');
  });
});
