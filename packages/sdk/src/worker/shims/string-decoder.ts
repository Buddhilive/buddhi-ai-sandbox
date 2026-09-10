/**
 * Node.js string_decoder polyfill
 */

export class StringDecoder {
  private decoder: TextDecoder;
  public encoding: string;

  constructor(encoding: string = 'utf8') {
    this.encoding = encoding;
    this.decoder = new TextDecoder(encoding, { fatal: false });
  }

  public write(buffer: Uint8Array): string {
    return this.decoder.decode(buffer, { stream: true });
  }

  public end(buffer?: Uint8Array): string {
    if (buffer) {
      return this.decoder.decode(buffer, { stream: false });
    }
    return this.decoder.decode();
  }
}

export default { StringDecoder };
