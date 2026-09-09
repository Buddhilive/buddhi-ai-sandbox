import {
  WorkerInboundMessage,
  WorkerOutboundMessage,
  SandboxError,
} from './types.js';

const FLAG_EMPTY = 0;
const FLAG_DATA = 1;
const FLAG_CLOSED = 2;

const OFFSET_FLAG = 0;
const OFFSET_WRITE_HEAD = 1;
const OFFSET_READ_HEAD = 2;
const OFFSET_CAPACITY = 3;
const HEADER_BYTE_SIZE = 16;
export const DEFAULT_RING_BUFFER_SIZE = 65536;

export function createRingBuffer(capacity: number = DEFAULT_RING_BUFFER_SIZE): SharedArrayBuffer {
  // 16 bytes header + capacity bytes
  const sab = new SharedArrayBuffer(HEADER_BYTE_SIZE + capacity);
  const int32 = new Int32Array(sab, 0, 4);
  int32[OFFSET_FLAG] = FLAG_EMPTY;
  int32[OFFSET_WRITE_HEAD] = 0;
  int32[OFFSET_READ_HEAD] = 0;
  int32[OFFSET_CAPACITY] = capacity;
  return sab;
}

export function createRingBufferReader(sab: SharedArrayBuffer): ReadableStream<Uint8Array> {
  const int32 = new Int32Array(sab, 0, 4);
  const capacity = int32[OFFSET_CAPACITY];
  const data = new Uint8Array(sab, HEADER_BYTE_SIZE, capacity);

  let isReading = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      function poll() {
        if (isReading) return;
        isReading = true;

        const flag = Atomics.load(int32, OFFSET_FLAG);
        const writeHead = Atomics.load(int32, OFFSET_WRITE_HEAD);
        const readHead = Atomics.load(int32, OFFSET_READ_HEAD);

        if (writeHead !== readHead) {
          const available = writeHead >= readHead
            ? writeHead - readHead
            : capacity - (readHead - writeHead);

          const chunk = new Uint8Array(available);
          let currentRead = readHead;
          for (let i = 0; i < available; i++) {
            chunk[i] = data[currentRead];
            currentRead = (currentRead + 1) % capacity;
          }

          Atomics.store(int32, OFFSET_READ_HEAD, currentRead);
          if (currentRead === Atomics.load(int32, OFFSET_WRITE_HEAD)) {
            if (flag !== FLAG_CLOSED) {
              Atomics.store(int32, OFFSET_FLAG, FLAG_EMPTY);
            }
          }
          controller.enqueue(chunk);
        }

        if (flag === FLAG_CLOSED && Atomics.load(int32, OFFSET_READ_HEAD) === Atomics.load(int32, OFFSET_WRITE_HEAD)) {
          controller.close();
          return;
        }

        isReading = false;
        // Schedule next check
        const atomicsAny = Atomics as any;
        if (typeof atomicsAny.waitAsync === 'function') {
          const res = atomicsAny.waitAsync(int32, OFFSET_FLAG, FLAG_EMPTY);
          if (res && res.async) {
            res.value.then(() => poll());
          } else {
            setTimeout(poll, 1);
          }
        } else {
          setTimeout(poll, 4);
        }
      }

      poll();
    },
  });
}

export function createRingBufferWriter(sab: SharedArrayBuffer): WritableStream<Uint8Array> {
  const int32 = new Int32Array(sab, 0, 4);
  const capacity = int32[OFFSET_CAPACITY];
  const data = new Uint8Array(sab, HEADER_BYTE_SIZE, capacity);

  return new WritableStream<Uint8Array>({
    write(chunk) {
      let offset = 0;
      while (offset < chunk.length) {
        const writeHead = Atomics.load(int32, OFFSET_WRITE_HEAD);
        const readHead = Atomics.load(int32, OFFSET_READ_HEAD);

        const available = writeHead >= readHead
          ? capacity - (writeHead - readHead) - 1
          : readHead - writeHead - 1;

        if (available <= 0) {
          // Buffer full, wait briefly
          continue;
        }

        const toWrite = Math.min(chunk.length - offset, available);
        let currentWrite = writeHead;
        for (let i = 0; i < toWrite; i++) {
          data[currentWrite] = chunk[offset + i];
          currentWrite = (currentWrite + 1) % capacity;
        }

        Atomics.store(int32, OFFSET_WRITE_HEAD, currentWrite);
        Atomics.store(int32, OFFSET_FLAG, FLAG_DATA);
        Atomics.notify(int32, OFFSET_FLAG);
        offset += toWrite;
      }
    },
    close() {
      Atomics.store(int32, OFFSET_FLAG, FLAG_CLOSED);
      Atomics.notify(int32, OFFSET_FLAG);
    },
  });
}

export class WorkerBridge {
  private worker: Worker;
  private pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private messageListeners = new Set<(msg: WorkerOutboundMessage) => void>();

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;
      if (msg.type === 'fs:response') {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new SandboxError(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
      }

      for (const listener of this.messageListeners) {
        listener(msg);
      }
    };
  }

  public postMessage(msg: WorkerInboundMessage, transfer?: Transferable[]) {
    if (transfer) {
      this.worker.postMessage(msg, transfer);
    } else {
      this.worker.postMessage(msg);
    }
  }

  public async request<T = any>(msg: WorkerInboundMessage & { id: string }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(msg.id, { resolve, reject });
      this.worker.postMessage(msg);
    });
  }

  public onMessage(listener: (msg: WorkerOutboundMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  public terminate() {
    this.worker.terminate();
    this.pendingRequests.clear();
    this.messageListeners.clear();
  }
}
