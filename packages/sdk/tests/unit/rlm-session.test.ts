import { describe, it, expect, vi } from 'vitest';
import { RlmSession } from '../../src/rlm-session.js';
import {
  RlmError,
  RlmResult,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from '../../src/types.js';
import { WorkerBridge } from '../../src/worker-bridge.js';

describe('RlmSession SDK Client', () => {
  it('initializes session and pushes context chunks to worker', async () => {
    const inboundMessages: WorkerInboundMessage[] = [];

    const mockBridge = {
      request: vi.fn(async (msg: WorkerInboundMessage) => {
        inboundMessages.push(msg);
        return { answer: 'ok', iterations: 0, terminated_by: 'ok', cost_estimate_tokens: 0 };
      }),
      postMessage: vi.fn((msg: WorkerInboundMessage) => {
        inboundMessages.push(msg);
      }),
      onMessage: vi.fn(() => () => {}),
    } as unknown as WorkerBridge;

    const session = new RlmSession(mockBridge, { maxDepth: 5 }, 'test_session_1');
    await session.init();
    await session.addContext('Sample academic paper section text.');

    expect(mockBridge.request).toHaveBeenCalledTimes(2);
    expect(inboundMessages[0]).toMatchObject({
      type: 'rlm:init',
      sessionId: 'test_session_1',
      config: { maxDepth: 5 },
    });
    expect(inboundMessages[1]).toMatchObject({
      type: 'rlm:push_context',
      sessionId: 'test_session_1',
      text: 'Sample academic paper section text.',
    });
  });

  it('runs multi-turn query, queries llmFn, and resolves final answer', async () => {
    let capturedHandler: ((msg: WorkerOutboundMessage) => void) | null = null;
    const postedMessages: WorkerInboundMessage[] = [];

    const mockBridge = {
      request: vi.fn(async (msg: WorkerInboundMessage) => {
        postedMessages.push(msg);
        return {};
      }),
      postMessage: vi.fn((msg: WorkerInboundMessage) => {
        postedMessages.push(msg);
      }),
      onMessage: vi.fn((handler: (msg: WorkerOutboundMessage) => void) => {
        capturedHandler = handler;
        return () => {
          capturedHandler = null;
        };
      }),
    } as unknown as WorkerBridge;

    const session = new RlmSession(mockBridge, { maxDepth: 3 }, 'test_session_run');
    await session.init();

    const mockLlm = vi.fn(async (prompt: string) => {
      if (prompt.includes('Explain relativity')) {
        return 'FINAL(Relativity describes gravity as spacetime curvature.)';
      }
      return 'Thinking...';
    });

    const runPromise = session.run('Explain relativity', mockLlm);

    // Verify run message was posted
    expect(postedMessages.some((m) => m.type === 'rlm:run')).toBe(true);
    const runMsg = postedMessages.find((m) => m.type === 'rlm:run') as any;

    // Simulate worker requesting LLM query
    capturedHandler?.({
      type: 'rlm:llm_query',
      sessionId: 'test_session_run',
      turnId: 'turn_1',
      prompt: 'Task Query: Explain relativity',
    });

    // Await timer tick for async LLM callback and response post
    await new Promise((r) => setTimeout(r, 10));

    expect(mockLlm).toHaveBeenCalledWith('Task Query: Explain relativity');
    expect(
      postedMessages.some(
        (m) =>
          m.type === 'rlm:llm_response' &&
          (m as any).response.includes('Relativity describes gravity')
      )
    ).toBe(true);

    // Simulate worker returning final answer
    const mockResult: RlmResult = {
      answer: 'Relativity describes gravity as spacetime curvature.',
      iterations: 1,
      terminated_by: 'FINAL',
      cost_estimate_tokens: 45,
    };

    capturedHandler?.({
      type: 'rlm:response',
      id: runMsg.id,
      result: mockResult,
    });

    const result = await runPromise;
    expect(result.answer).toBe('Relativity describes gravity as spacetime curvature.');
    expect(result.iterations).toBe(1);
    expect(result.terminated_by).toBe('FINAL');
  });

  it('rejects with RlmError when llmFn throws an exception', async () => {
    let capturedHandler: ((msg: WorkerOutboundMessage) => void) | null = null;

    const mockBridge = {
      request: vi.fn(async () => ({})),
      postMessage: vi.fn(),
      onMessage: vi.fn((handler: (msg: WorkerOutboundMessage) => void) => {
        capturedHandler = handler;
        return () => {};
      }),
    } as unknown as WorkerBridge;

    const session = new RlmSession(mockBridge, {}, 'test_err_session');
    await session.init();

    const failingLlm = vi.fn(async () => {
      throw new Error('API Rate limit reached');
    });

    const runPromise = session.run('Test query', failingLlm);

    // Trigger turn
    capturedHandler?.({
      type: 'rlm:llm_query',
      sessionId: 'test_err_session',
      turnId: 'turn_err_1',
      prompt: 'Some prompt',
    });

    await expect(runPromise).rejects.toThrow(RlmError);
    await expect(runPromise).rejects.toThrow('API Rate limit reached');
  });

  it('sends cancel and destroy messages', async () => {
    const postedMessages: WorkerInboundMessage[] = [];

    const mockBridge = {
      request: vi.fn(async () => ({})),
      postMessage: vi.fn((msg: WorkerInboundMessage) => {
        postedMessages.push(msg);
      }),
      onMessage: vi.fn(() => () => {}),
    } as unknown as WorkerBridge;

    const session = new RlmSession(mockBridge, {}, 'test_cancel_session');
    await session.cancel();
    expect(postedMessages.some((m) => m.type === 'rlm:cancel')).toBe(true);

    await session.dispose();
    expect(postedMessages.some((m) => m.type === 'rlm:destroy')).toBe(true);

    // Cannot run on disposed session
    await expect(session.run('test', async () => '')).rejects.toThrow(RlmError);
  });

  it('resolves bridge.request with real WorkerBridge when rlm:response is received', async () => {
    let capturedWorkerListener: ((ev: MessageEvent) => void) | null = null;
    const mockWorker = {
      postMessage: vi.fn((msg: any) => {
        if (msg.type === 'rlm:init') {
          capturedWorkerListener?.({
            data: {
              type: 'rlm:response',
              id: msg.id,
              result: { answer: 'Session initialized', iterations: 0, terminated_by: 'init', cost_estimate_tokens: 0 },
            },
          } as MessageEvent);
        } else if (msg.type === 'rlm:push_context') {
          capturedWorkerListener?.({
            data: {
              type: 'rlm:response',
              id: msg.id,
              result: { answer: 'Pushed 5 chunks', iterations: 0, terminated_by: 'push_context', cost_estimate_tokens: 0 },
            },
          } as MessageEvent);
        }
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      terminate: vi.fn(),
      set onmessage(fn: (ev: MessageEvent) => void) {
        capturedWorkerListener = fn;
      },
      get onmessage() {
        return capturedWorkerListener;
      },
    } as unknown as Worker;

    const realBridge = new WorkerBridge(mockWorker);
    const session = new RlmSession(realBridge, { maxDepth: 5 }, 'real_bridge_session');

    // These both call bridge.request and must resolve cleanly
    await expect(session.init()).resolves.toBeUndefined();
    await expect(session.addContext('Sample text for context ingestion')).resolves.toBeUndefined();
  });
});

