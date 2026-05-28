// Client-side image compression for chat attachments.
// Resize down to a max dimension and re-encode as JPEG. Saves a lot of
// upload bandwidth (operators on 4G) without visible quality loss for
// WhatsApp-bound photos.
//
// Bails out (returns the original) when:
//  - input is already small enough,
//  - input is a GIF (would lose animation),
//  - the canvas re-encode somehow produced a LARGER file.

const MAX_DIMENSION = 1920;
const QUALITY = 0.85;
const SKIP_BELOW_BYTES = 200 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Falha ao carregar imagem')); };
    img.src = url;
  });
}

function scaleDown(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  if (w >= h) return { width: max, height: Math.round((h * max) / w) };
  return { width: Math.round((w * max) / h), height: max };
}

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.type === 'image/gif') return file;
  if (file.size < SKIP_BELOW_BYTES) return file;

  let img: HTMLImageElement;
  try { img = await loadImage(file); } catch { return file; }

  const { width, height } = scaleDown(img.naturalWidth, img.naturalHeight, MAX_DIMENSION);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );
  if (!blob || blob.size >= file.size) return file;

  const newName = file.name.replace(/\.(png|webp|heic|heif|bmp|tiff?|jpe?g)$/i, '.jpg');
  return new File([blob], newName.endsWith('.jpg') ? newName : `${newName}.jpg`, {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
}
