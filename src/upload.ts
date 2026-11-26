// 上傳行程檔案共用的部分：檢查檔案、縮圖、放進 uploads 空間。行程裡的「上傳行程」和首頁「用上傳建立行程」都用這裡。
import { supabase } from "./supabase";
import { shrink } from "./images";
import { t } from "./i18n";

const OK_EXT = ["xlsx", "xls", "csv", "pdf", "txt", "md", "png", "jpg", "jpeg", "webp", "gif"];
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_CHARS = 30000;
export const UPLOAD_ACCEPT = ".xlsx,.xls,.csv,.pdf,.txt,.md,image/*";

/** Why this file cannot be sent (checked before spending mobile data on the upload), or null when it is fine. */
export function fileProblem(f: File): string | null {
  const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
  if (ext === "heic" || ext === "heif" || /heic|heif/i.test(f.type)) return t("iPhone 的 HEIC 照片不支援。請改傳截圖，或在相機設定選「最相容」再拍一次");
  if (f.type.startsWith("image/")) return null; // pictures are converted to JPEG and shrunk below
  if (!OK_EXT.includes(ext)) return t("這種檔案不支援。可以傳 xlsx、csv、PDF、txt，或照片／截圖");
  if (f.size > MAX_UPLOAD_BYTES) return t("檔案太大（上限 8 MB）。PDF 請只留行程那幾頁");
  return null;
}

/** Put the file in the trip's upload folder and return its path (what parse-upload reads). */
export async function storeUpload(tripId: string, familyId: string, file: File): Promise<string> {
  if (!supabase) throw new Error(t("Supabase 還沒設定"));
  // photos: a readable size is plenty for the AI and a fraction of the mobile data (and always a format it accepts)
  const isImage = file.type.startsWith("image/");
  const blob: Blob = isImage ? await shrink(file, 2200) : file;
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error(t("檔案太大（上限 8 MB）。請改傳截圖，或只留行程那幾頁"));
  const ext = isImage ? (blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : blob.type === "image/gif" ? "gif" : "jpg") : file.name.split(".").pop()!.toLowerCase();
  const path = `${tripId}/${familyId}/${Date.now()}-${file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40)}.${ext}`;
  const { error } = await supabase.storage.from("uploads").upload(path, blob, { contentType: blob.type || undefined });
  if (error) throw new Error(/exceeded|too large|size/i.test(error.message) ? t("檔案太大，請改傳截圖或只留行程那幾頁") : error.message);
  return path;
}
