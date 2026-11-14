export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** An error whose message is written for the person using the site and is safe to show them. */
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Request bodies are small JSON (a chat line, a pasted page, a list of stops): refuse anything bigger before parsing it. */
export async function readJson<T>(req: Request, maxBytes = 400_000): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new HttpError(413, "內容太大了，請分成幾次");
  const raw = await req.text().catch(() => "");
  if (raw.length > maxBytes) throw new HttpError(413, "內容太大了，請分成幾次");
  try { return (raw ? JSON.parse(raw) : {}) as T; } catch { return {} as T; }
}

/** Wrap a handler: CORS preflight, JSON errors. Only HttpError messages reach the caller; anything unexpected is logged and reported generically. */
export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      return await fn(req);
    } catch (e) {
      console.error(e);
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      return json({ error: "伺服器出錯了，稍後再試" }, 500);
    }
  };
}
