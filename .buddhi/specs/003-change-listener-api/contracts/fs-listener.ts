/**
 * Contract interfaces for Sandbox File Change Listener API
 */

export type FileChangeType = 'create' | 'update' | 'delete';

export interface FileChangeEvent {
  path: string;
  type: FileChangeType;
}

export type FileChangeListener = (event: FileChangeEvent) => void;

export interface IFsNamespaceEvents {
  /**
   * Subscribe to file system change events.
   * @param event The event name to listen to (currently 'change').
   * @param listener Callback invoked when a file or directory is created, updated, or deleted.
   * @returns Cleanup function to unsubscribe the listener.
   */
  on(event: 'change', listener: FileChangeListener): () => void;

  /**
   * Unsubscribe a previously registered file system change listener.
   * @param event The event name ('change').
   * @param listener The listener callback to remove.
   */
  off(event: 'change', listener: FileChangeListener): void;
}
