// 「其他資訊」頁的圖片：存在 Supabase Storage 的 info-images bucket，路徑是 <trip_id>/<亂數檔名>。
// 圖片網址是公開的，所以用不到的圖要真的刪掉（刪頁、把圖從內文拿掉、刪整個行程）。
import { supabase } from "./supabase";

export const IMAGE_BUCKET = "info-images";

/** Shrink a picture before upload (longest side ≤ 1280, JPEG) so phone photos don't eat the storage quota. Transparent areas become white. */
export async function shrink(file: File, max = 1280): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return jpeg && (scale < 1 || jpeg.size < file.size) ? jpeg : file;
  } catch { return file; }
}

const PUBLIC_PREFIX = `/storage/v1/object/public/${IMAGE_BUCKET}/`;
const IMG_RE = /!\[[^\]\n]*\]\((https?:\/\/[^\s)]+)\)/g;

/** Storage paths (inside the bucket) of this trip's own uploaded pictures that a Markdown body shows. */
export function imagePathsIn(md: string, tripId: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(IMG_RE)) {
    const i = m[1].indexOf(PUBLIC_PREFIX);
    if (i < 0) continue;
    const path = decodeURIComponent(m[1].slice(i + PUBLIC_PREFIX.length).split(/[?#]/)[0]);
    // only this trip's folder, and only a plain file name in it
    if (path.startsWith(`${tripId}/`) && !path.includes("..") && path.split("/").length === 2) out.add(path);
  }
  return [...out];
}

/** Best effort: a picture that could not be deleted is not worth blocking the save for. */
export async function removeImages(paths: string[]) {
  if (!supabase || paths.length === 0) return;
  try { await supabase.storage.from(IMAGE_BUCKET).remove(paths); } catch { /* ignore */ }
}

/** Pictures a page no longer shows: in `before` but not in `after`, and not used by any other page of the trip. */
export function droppedImages(before: string, after: string, otherBodies: string[], tripId: string): string[] {
  const keep = new Set([after, ...otherBodies].flatMap((b) => imagePathsIn(b, tripId)));
  return imagePathsIn(before, tripId).filter((p) => !keep.has(p));
}

/** Everything in a trip's folder (before the trip itself is deleted). */
export async function removeTripImages(tripId: string) {
  if (!supabase) return;
  try {
    for (let round = 0; round < 20; round++) {
      const { data, error } = await supabase.storage.from(IMAGE_BUCKET).list(tripId, { limit: 100 });
      if (error || !data?.length) return;
      const { error: delErr } = await supabase.storage.from(IMAGE_BUCKET).remove(data.map((f) => `${tripId}/${f.name}`));
      if (delErr) return;
    }
  } catch { /* ignore */ }
}

/**
 * Text written by the AI and saved as a page: drop pictures that are not our own uploads.
 * A page shows every picture to everyone who opens it, so an outside image URL would let that site see who reads the page.
 */
export function stripForeignImages(md: string): string {
  return md.replace(IMG_RE, (whole, url: string) => (url.includes(PUBLIC_PREFIX) ? whole : ""));
}
