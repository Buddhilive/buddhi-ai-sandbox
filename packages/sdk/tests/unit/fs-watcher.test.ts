import { describe, it, expect } from 'vitest';
import { watch, notifyFsChange, FSWatcher } from '../../src/worker/shims/fs-watcher.js';

describe('Virtual FSWatcher for Next.js HMR', () => {
  it('detects file changes and notifies listener', async () => {
    let triggered = false;
    let eventName = '';
    let fileName = '';

    const watcher = watch('/workspace/app/page.tsx', (event, filename) => {
      triggered = true;
      eventName = event;
      fileName = filename || '';
    });

    expect(watcher).toBeInstanceOf(FSWatcher);

    notifyFsChange('/workspace/app/page.tsx', 'change');

    expect(triggered).toBe(true);
    expect(eventName).toBe('change');
    expect(fileName).toBe('page.tsx');

    watcher.close();
  });

  it('handles recursive directory watching', () => {
    const events: string[] = [];
    const watcher = watch('/workspace/app', { recursive: true }, (event, filename) => {
      events.push(`${event}:${filename}`);
    });

    notifyFsChange('/workspace/app/components/Header.tsx', 'change');

    expect(events.length).toBe(1);
    expect(events[0]).toBe('change:components/Header.tsx');

    watcher.close();
  });
});
