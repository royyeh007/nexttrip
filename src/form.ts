import { supabase } from "./supabase";
import { t } from "./i18n";

/** The fill-in form lives in the private `assets` bucket; members get a short-lived signed download link. */
export async function openForm(tripName = t("行程")) {
  if (!supabase) return;
  const { data, error } = await supabase.storage.from("assets").createSignedUrl("trip-form.xlsx", 600, { download: t("{name}_填寫表單.xlsx", { name: tripName }) });
  if (error || !data) { alert(t("表單暫時抓不到：{msg}", { msg: t(error?.message ?? "") })); return; }
  location.assign(data.signedUrl);
}
