import { useCallback, useEffect, useRef, useState } from "react";
import { isViewer } from "../data";
import type { Proposal, Upload as UploadRow } from "../data";
import { invoke, supabase } from "../supabase";
import { shrink } from "../images";
import { useTrip } from "../trip";
import { openForm } from "../form";
import { DownloadIcon } from "../icons";
import { ProposalCard, STATUS } from "./Proposals";
import { t, lang } from "../i18n";

const OK_EXT = ["xlsx", "xls", "csv", "pdf", "txt", "md", "png", "jpg", "jpeg", "webp", "gif"];
const MAX_BYTES = 8 * 1024 * 1024;
/** Why this file cannot be sent (checked before spending mobile data on the upload), or null when it is fine. */
function fileProblem(f: File): string | null {
  const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
  if (ext === "heic" || ext === "heif" || /heic|heif/i.test(f.type)) return t("iPhone 的 HEIC 照片不支援。請改傳截圖，或在相機設定選「最相容」再拍一次");
  if (f.type.startsWith("image/")) return null; // pictures are converted to JPEG and shrunk below
  if (!OK_EXT.includes(ext)) return t("這種檔案不支援。可以傳 xlsx、csv、PDF、txt，或照片／截圖");
  if (f.size > MAX_BYTES) return t("檔案太大（上限 8 MB）。PDF 請只留行程那幾頁");
  return null;
}

export function UploadView() {
  const { member, current, labelOf } = useTrip();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; proposal: Proposal } | null>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = (f: File | null) => {
    // let the same file be picked again after fixing it (the input does not fire "change" for an unchanged selection)
    if (fileRef.current) fileRef.current.value = "";
    const problem = f ? fileProblem(f) : null;
    setErr(problem); setResult(null);
    setFile(problem ? null : f);
  };

  const loadRows = useCallback(async () => {
    if (!supabase || !current) return;
    const { data, error } = await supabase.from("uploads").select("id, family_id, uploaded_by, kind, path, status, parsed, error, created_at").eq("trip_id", current.id).order("created_at", { ascending: false }).limit(50);
    if (!error) setRows((data ?? []) as UploadRow[]);
  }, [current]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const submit = async () => {
    if (!supabase || !member || !current || busy || (!file && !text.trim())) return;
    if (text.trim().length > 30000) { setErr(t("一次最多貼 30,000 個字，請分成幾次（例如一次兩三天）")); return; }
    setErr(null); setResult(null);
    try {
      let path: string | undefined;
      if (file) {
        setBusy(t("上傳檔案中…"));
        // photos: a readable size is plenty for the AI and a fraction of the mobile data (and always a format it accepts)
        const isImage = file.type.startsWith("image/");
        const blob: Blob = isImage ? await shrink(file, 2200) : file;
        if (blob.size > MAX_BYTES) throw new Error(t("檔案太大（上限 8 MB）。請改傳截圖，或只留行程那幾頁"));
        const ext = isImage ? (blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : blob.type === "image/gif" ? "gif" : "jpg") : file.name.split(".").pop()!.toLowerCase();
        path = `${current.id}/${member.family_id}/${Date.now()}-${file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40)}.${ext}`;
        const { error } = await supabase.storage.from("uploads").upload(path, blob, { contentType: blob.type || undefined });
        if (error) throw new Error(/exceeded|too large|size/i.test(error.message) ? t("檔案太大，請改傳截圖或只留行程那幾頁") : error.message);
      }
      setBusy(t("Trip醬讀取中，大約 20–60 秒…"));
      const res = await invoke<{ id: string; proposal: Proposal }>("parse-upload", { trip_id: current.id, path, text: text.trim() || undefined, lang });
      setResult(res); setFile(null); setText("");
    } catch (e) {
      setErr(e instanceof Error ? t(e.message) : String(e));
    } finally { setBusy(null); }
  };

  // Earlier proposals still waiting for a decision (own ones; admin sees everyone's), minus the one just shown above
  const pending = rows.filter((r) => r.status === "pending" && r.parsed && r.id !== result?.id);
  const history = rows.filter((r) => r.status !== "pending" && r.uploaded_by === member?.user_id);

  if (isViewer(member)) return <section className="dayhead"><h2>{t("上傳行程")}</h2><p className="note">{t("觀察員只能看行程，不能上傳或修改。")}</p></section>;
  return (
    <>
      <section className="dayhead">
        <h2>{t("上傳行程")}</h2>
        <p className="note">{t("傳填好的表單（xlsx）、行程截圖、PDF，或直接貼文字。Claude 整理好後你看一下，按「確認，更新行程」就會更新到網頁上。")}</p>
      </section>

      <div className="panel">
        <h3>{t("上傳")}</h3>
        <div className="uploadform">
          <label className="filepick">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.txt,.md,image/*" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            <span>{file ? file.name : t("選檔案：表單 xlsx、截圖、PDF")}</span>
          </label>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("或直接貼行程文字，例如：12/26 15:00 到機場，17:00 飯店 check-in，18:30 晚餐 ○○…")} maxLength={30000} />
          <div className="actions">
            <button type="button" className="btn primary" onClick={submit} disabled={!!busy || (!file && !text.trim())}>{busy ?? t("送出給 Trip醬整理")}</button>
            <button type="button" className="btn" onClick={() => openForm(current?.name)}><DownloadIcon />{t("下載填寫表單")}</button>
          </div>
          {err && <p className="err">{err}</p>}
          {result && (
            <div className="resultbox">
              <p><b>{t("Trip醬讀出來的內容，看一下沒問題就按確認：")}</b></p>
              <ProposalCard id={result.id} proposal={result.proposal} onDone={loadRows} />
            </div>
          )}
        </div>
      </div>

      {pending.length > 0 && (
        <div className="panel">
          <h3>{t("還沒確認的（{n}）", { n: pending.length })}</h3>
          {pending.map((r) => (
            <ProposalCard key={r.id} id={r.id} proposal={r.parsed!}
              meta={`${labelOf(r.family_id)}・${r.kind === "chat" ? t("從聊天") : t("上傳")}・${new Date(r.created_at).toLocaleString(lang === "en" ? "en-US" : "zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
              onDone={loadRows} />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="panel">
          <h3>{t("之前送過的")}</h3>
          <ul className="ulist">
            {history.map((r) => (
              <li key={r.id}>
                <span className={`status ${r.status}`}>{STATUS[r.status]}</span>
                <span>{r.parsed?.summary || (r.error && t(r.error)) || (r.kind === "chat" ? t("聊天提案") : r.path?.split("/").pop())}</span>
                <span className="muted">{new Date(r.created_at).toLocaleDateString("zh-TW")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
