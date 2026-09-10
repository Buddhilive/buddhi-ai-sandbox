/**
 * Virtual WebSocket server & bridge for Next.js HMR
 */
import { EventEmitter } from './events.js';

export class VirtualWebSocketClient extends EventEmitter {
  public readyState: number = 1; // OPEN
  private channelPort: MessagePort;

  constructor(channelPort: MessagePort) {
    super();
    this.channelPort = channelPort;
    this.channelPort.onmessage = (event) => {
      this.emit('message', event.data);
    };
    this.channelPort.onmessageerror = (err) => {
      this.emit('error', err);
    };
  }

  public send(data: any): void {
    if (this.readyState === 1) {
      this.channelPort.postMessage(data);
    }
  }

  public close(code: number = 1000, reason?: string): void {
    this.readyState = 3; // CLOSED
    this.channelPort.close();
    this.emit('close', code, reason);
  }
}

export class VirtualWebSocketServer extends EventEmitter {
  private clients: Set<VirtualWebSocketClient> = new Set();

  public handleConnection(channelPort: MessagePort): VirtualWebSocketClient {
    const client = new VirtualWebSocketClient(channelPort);
    this.clients.add(client);

    client.on('close', () => {
      this.clients.delete(client);
    });

    this.emit('connection', client);
    return client;
  }

  public broadcast(data: any): void {
    for (const client of this.clients) {
      client.send(data);
    }
  }

  public close(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.emit('close');
  }
}

export const globalHmrServer = new VirtualWebSocketServer();

export default {
  VirtualWebSocketClient,
  VirtualWebSocketServer,
  globalHmrServer,
};
