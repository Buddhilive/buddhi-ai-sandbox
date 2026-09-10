/**
 * Shims for next/font/google and next/font/local
 */

export function createFontShim(fontFamily: string) {
  return function(options?: any) {
    const variable = options?.variable || `--font-${fontFamily.toLowerCase()}`;
    return {
      className: `__className_${fontFamily.toLowerCase()}`,
      variable,
      style: {
        fontFamily: options?.fallback ? `${fontFamily}, ${options.fallback.join(', ')}` : fontFamily,
      },
    };
  };
}

export const Inter = createFontShim('Inter');
export const Roboto = createFontShim('Roboto');
export const Geist = createFontShim('Geist');
export const GeistMono = createFontShim('GeistMono');

export default {
  createFontShim,
  Inter,
  Roboto,
  Geist,
  GeistMono,
};
