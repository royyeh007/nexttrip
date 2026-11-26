import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useTrip } from "../trip";
import { removeTripImages } from "../images";
import { t, tr } from "../i18n";

/** Leaving a trip: explain the consequence and require typing "delete" before the button works. */
export function LeaveDialog({ onClose, trip }: { onClose: () => void; /** from the home page: the trip on the card; inside a trip: the open one */ trip?: { id: string; name: string } }) {
  const { current: open, leaveToPicker, refreshMemberships } = useTrip();
  const current = trip ?? open;
  const [text, setText] = useState("");
  const [alone, setAlone] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!supabase || !current) return;
    // 查不到人數（網路問題）時維持「確認中」，不要當成「還有別人」：只剩自己時退出會刪掉整個行程
    supabase.from("members").select("user_id", { count: "exact", head: true }).eq("trip_id", current.id)
      .then(({ count, error }) => { if (error || count == null) setErr(t("查不到這個行程還有幾個人，可能是網路問題。關掉再開一次試試")); else setAlone(count === 1); });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // 還有別人在：退出之後可以再被邀請回來，按一下確認就好。只剩自己：退出等於刪掉整個行程，要打 delete。
  const ok = alone === false || (alone === true && text.trim().toLowerCase() === "delete");
  const go = async () => {
    if (!supabase || !current || !ok) return;
    setBusy(true); setErr(null);
    // 最後一個人退出＝刪掉整個行程：資訊頁的圖片是公開網址，先清掉
    if (alone) await removeTripImages(current.id);
    const { error } = await supabase.rpc("leave_trip", { p_trip: current.id });
    if (error) { setErr(t(error.message)); setBusy(false); return; }
    await refreshMemberships();
    if (trip) onClose(); else leaveToPicker();
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="leave-title">
        <h3 id="leave-title">{t("退出「{name}」", { name: current?.name })}</h3>
        <p className="note">
          {alone === null ? t("確認中…") : alone
            ? t("你是這個行程裡唯一的人，退出會把整個行程連同所有資料刪掉，無法復原。")
            : t("退出後就看不到這個行程了，之後要再用邀請連結才能回來。你的備註和已經確認的行程會留著。")}
        </p>
        {alone === true && (
          <label><span>{tr("請輸入 <c>delete</c> 確認", { c: (c) => <code>{c}</code> })}</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="delete" autoCapitalize="none" autoCorrect="off" autoFocus onKeyDown={(e) => { if (e.key === "Enter" && ok) go(); }} />
        </label>
        )}
        <div className="actions">
          <button type="button" className="btn danger" onClick={go} disabled={!ok || busy || alone === null}>{busy ? t("處理中…") : alone ? t("確認退出並刪除行程") : t("確認退出")}</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>{t("取消")}</button>
        </div>
        {err && <p className="err">{err}</p>}
      </div>
    </>
  );
}
