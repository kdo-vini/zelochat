import {
  buildZeloMenuPublicationImagePath,
  getOwnedZeloMenuPublicationImagePath,
  ZELOMENU_PUBLICATION_IMAGE_BUCKET,
} from '../domain/zelomenuPublicationImages';
import { compressImage } from './imageCompress';
import { supabase } from './supabaseClient';

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export async function deleteOwnedZeloMenuPublicationImage(url: string | null | undefined): Promise<void> {
  const objectPath = getOwnedZeloMenuPublicationImagePath(url);
  if (!objectPath) return;

  const { error } = await supabase.storage
    .from(ZELOMENU_PUBLICATION_IMAGE_BUCKET)
    .remove([objectPath]);

  if (error) {
    throw new Error('Não consegui remover a foto anterior do produto.');
  }
}

export async function uploadOwnedZeloMenuPublicationImage(
  userId: string,
  productId: number,
  file: File,
  previousUrl?: string | null,
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Envie uma imagem em PNG, JPG, WEBP ou formato compatível.');
  }

  const compressedFile = await compressImage(file);
  if (compressedFile.size > MAX_UPLOAD_BYTES) {
    throw new Error('Imagem muito grande. Use um arquivo de ate 3 MB.');
  }

  const objectPath = buildZeloMenuPublicationImagePath(userId, productId, compressedFile.name);
  const { error: uploadError } = await supabase.storage
    .from(ZELOMENU_PUBLICATION_IMAGE_BUCKET)
    .upload(objectPath, compressedFile, { upsert: false });

  if (uploadError) {
    throw new Error('Não consegui enviar a foto do produto.');
  }

  const { data } = supabase.storage
    .from(ZELOMENU_PUBLICATION_IMAGE_BUCKET)
    .getPublicUrl(objectPath);

  const previousPath = getOwnedZeloMenuPublicationImagePath(previousUrl);
  if (previousPath && previousPath !== objectPath) {
    const { error: removeError } = await supabase.storage
      .from(ZELOMENU_PUBLICATION_IMAGE_BUCKET)
      .remove([previousPath]);
    if (removeError) {
      console.warn('[ZeloMenu] Failed to remove previous owned publication image:', removeError);
    }
  }

  return data.publicUrl;
}
