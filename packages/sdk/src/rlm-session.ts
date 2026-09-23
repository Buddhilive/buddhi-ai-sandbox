import {
  LlmQueryFn,
  RlmConfig,
  RlmError,
  RlmResult,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from './types.js';
import { WorkerBridge } from './worker-bridge.js';

export class RlmSession {
  public readonly sessionId: string;
  private bridge: WorkerBridge;
  private config: RlmConfig;
  private initialized = false;
  private isDisposed = false;

  constructor(bridge: WorkerBridge, config?: RlmConfig, sessionId?: string) {
    this.bridge = bridge;
    this.config = config || {};
    this.sessionId =
      sessionId || `rlm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Initializes the session in the worker and WASM runtime.
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    if (this.isDisposed) throw new RlmError('Session has already been disposed', 'ERR_DISPOSED');

    const id = `init_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await this.bridge.request({
      type: 'rlm:init',
      id,
      sessionId: this.sessionId,
      config: this.config,
    });
    this.initialized = true;
  }

  /**
   * Pushes raw document text into the in-WASM context store.
   */
  public async addContext(text: string): Promise<void> {
    if (this.isDisposed) throw new RlmError('Session has already been disposed', 'ERR_DISPOSED');
    if (!this.initialized) {
      await this.init();
    }

    if (!text || text.trim().length === 0) {
      return;
    }

    const id = `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await this.bridge.request({
      type: 'rlm:push_context',
      id,
      sessionId: this.sessionId,
      text,
    });
  }

  /**
   * Executes the RLM orchestration loop for a given query and LLM completion function.
   */
  public async run(query: string, llmFn: LlmQueryFn): Promise<RlmResult> {
    if (this.isDisposed) throw new RlmError('Session has already been disposed', 'ERR_DISPOSED');
    if (!this.initialized) {
      await this.init();
    }

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<RlmResult>((resolve, reject) => {
      let isSettled = false;

      // Unsubscribe callback for bridge messages
      const unsub = this.bridge.onMessage(async (msg: WorkerOutboundMessage) => {
        if (msg.type === 'rlm:llm_query' && msg.sessionId === this.sessionId) {
          try {
            const response = await llmFn(msg.prompt);
            this.bridge.postMessage({
              type: 'rlm:llm_response',
              sessionId: this.sessionId,
              turnId: msg.turnId,
              response: response ?? '',
            } as WorkerInboundMessage);
          } catch (err: any) {
            cleanup();
            reject(
              new RlmError(
                `LLM execution failed: ${err?.message || String(err)}`,
                'ERR_LLM_FAILED'
              )
            );
          }
        } else if (msg.type === 'rlm:response' && msg.id === runId) {
          cleanup();
          if (msg.error) {
            reject(new RlmError(msg.error, 'ERR_RLM_EXECUTION'));
          } else if (msg.result) {
            resolve(msg.result);
          } else {
            reject(new RlmError('Empty RLM result returned', 'ERR_EMPTY_RESULT'));
          }
        }
      });

      const cleanup = () => {
        if (isSettled) return;
        isSettled = true;
        unsub();
      };

      // Dispatch the run command to the worker
      this.bridge.postMessage({
        type: 'rlm:run',
        id: runId,
        sessionId: this.sessionId,
        query,
      } as WorkerInboundMessage);
    });
  }

  /**
   * Requests cancellation of the currently active session turn.
   */
  public async cancel(): Promise<void> {
    this.bridge.postMessage({
      type: 'rlm:cancel',
      sessionId: this.sessionId,
    } as WorkerInboundMessage);
  }

  /**
   * Disposes the session and frees WASM linear memory.
   */
  public async dispose(): Promise<void> {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.bridge.postMessage({
      type: 'rlm:destroy',
      sessionId: this.sessionId,
    } as WorkerInboundMessage);
  }
}
