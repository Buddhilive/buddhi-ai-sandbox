export interface RegisteredPort {
  port: number;
  messagePort?: MessagePort;
  lastActive: number;
}

export class PortRegistry {
  private ports = new Map<number, RegisteredPort>();

  register(port: number, messagePort?: MessagePort): void {
    this.ports.set(port, {
      port,
      messagePort,
      lastActive: Date.now(),
    });
  }

  unregister(port: number): void {
    this.ports.delete(port);
  }

  has(port: number): boolean {
    return this.ports.has(port);
  }

  get(port: number): RegisteredPort | undefined {
    return this.ports.get(port);
  }

  list(): number[] {
    return Array.from(this.ports.keys());
  }
}

export const globalPortRegistry = new PortRegistry();
