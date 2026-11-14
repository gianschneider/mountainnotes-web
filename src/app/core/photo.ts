/** Photo of a note as sent to the server: resized JPEG without EXIF, plus a tiny preview. */
export interface NotePhoto {
  jpeg: string;      // base64 (no data: prefix)
  preview: string;   // data URL, ~24 px wide
}

const MAX_SIDE_PX = 1600;
const PREVIEW_PX = 24;   // so small that the blurred preview reveals nothing but colours

/**
 * Re-encode through a canvas: scales the image down and drops all metadata (EXIF with GPS position,
 * time and device), so only pixels leave the phone (privacy by design).
 */
export async function preparePhoto(src: string): Promise<NotePhoto> {
  const img = await loadImage(src);
  const full = encode(img, MAX_SIDE_PX, 0.8);
  return { jpeg: full.slice(full.indexOf(',') + 1), preview: encode(img, PREVIEW_PX, 0.5) };
}

export function jpegDataUrl(base64: string): string {
  return `data:image/jpeg;base64,${base64}`;
}

function encode(img: HTMLImageElement, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The photo could not be read.'));
    img.src = src;
  });
}
