/** Minimal typings for gifenc (ships untyped). Only what export.ts uses. */
declare module "gifenc" {
  export interface GifWriter {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: number[][]; delay?: number; transparent?: boolean },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(): GifWriter;
  export function quantize(rgba: Uint8ClampedArray | Uint8Array, maxColors: number): number[][];
  export function applyPalette(
    rgba: Uint8ClampedArray | Uint8Array,
    palette: number[][],
  ): Uint8Array;
}
