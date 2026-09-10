/**
 * Image resizing and optimization processor for next/image using OffscreenCanvas
 */

export interface ImageResizeOptions {
  width: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png';
}

export class ImageProcessor {
  public static isSupported(): boolean {
    return typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
  }

  public async resize(imageBuffer: Uint8Array, options: ImageResizeOptions): Promise<Uint8Array> {
    if (!ImageProcessor.isSupported()) {
      // Pass-through fallback if canvas is not available in current worker
      return imageBuffer;
    }

    try {
      const blob = new Blob([imageBuffer as any]);
      const bitmap = await createImageBitmap(blob);

      const targetWidth = options.width;
      const targetHeight = options.height || Math.round(bitmap.height * (targetWidth / bitmap.width));

      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) return imageBuffer;

      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

      const mimeType = options.format === 'png' ? 'image/png' : 'image/webp';
      const outBlob = await canvas.convertToBlob({ type: mimeType, quality: (options.quality || 75) / 100 });
      const arrayBuffer = await outBlob.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    } catch (err) {
      console.warn('[ImageProcessor] Resize fallback:', err);
      return imageBuffer;
    }
  }
}

export default ImageProcessor;
