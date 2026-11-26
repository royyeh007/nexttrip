// 使用教學的唯一來源：網頁的「使用教學」頁和聊天機器人的「網站怎麼用」都從這裡來，改一處兩邊同步。
// 純資料、沒有任何執行環境相依，前端（Vite）和 Edge Function（Deno）都直接 import。
// 文字裡的 [[目標|按鈕文字]] 在網頁上會變成真的可以按的按鈕（目標＝頁面代號或動作），給聊天機器人時會變成「按鈕文字」。
export type GuideRole = "admin" | "member" | "viewer";
export interface GuideItem { text: string; roles?: GuideRole[] }
export interface GuideSection { id: string; icon: string; title: string; lead?: string; roles?: GuideRole[]; items: GuideItem[] }
export interface GuideAction { target: string; label: string }
/** The languages the guide is written in. Every function below takes it last and defaults to Chinese. */
export type GuideLang = "zh" | "en";

export const ROLE_NAMES: Record<GuideRole, string> = { admin: "管理員", member: "成員", viewer: "觀察員" };
export const ROLE_SUMMARY: Record<GuideRole, string> = {
  admin: "可以看、改所有家的行程，管理團員、邀請、家庭和行程設定。",
  member: "可以看每一家的行程；能改自己家的日子和大家一起的日子，能用 Trip醬。",
  viewer: "只能看行程、待辦、聯絡資料和航班狀態，不能修改，也沒有聊天機器人。",
};
/** The handful of things each role will press most often, shown at the top of the guide. */
export const QUICK_START: Record<GuideRole, GuideAction[]> = {
  admin: [{ target: "admin", label: "⚙ 管理這個行程" }, { target: "upload", label: "↑ 上傳行程" }, { target: "chat", label: "🧳 Trip醬" }, { target: "overview", label: "☷ 總覽" }],
  member: [{ target: "overview", label: "☷ 總覽" }, { target: "upload", label: "↑ 上傳行程" }, { target: "chat", label: "🧳 Trip醬" }, { target: "todo", label: "✓ 待辦・聯絡" }],
  viewer: [{ target: "overview", label: "☷ 總覽" }, { target: "todo", label: "✓ 待辦・聯絡" }],
};

/** English counterpart of ROLE_NAMES. */
export const ROLE_NAMES_EN: Record<GuideRole, string> = { admin: "Admin", member: "Member", viewer: "Viewer" };
/** English counterpart of ROLE_SUMMARY. */
export const ROLE_SUMMARY_EN: Record<GuideRole, string> = {
  admin: "Can see and change every family's itinerary, and manage people, invitations, families and trip settings.",
  member: "Can see every family's itinerary; can change their own family's days and the days everyone shares, and can use Trip-chan.",
  viewer: "Can only look at the itinerary, to-dos, contacts and flight status. Can't change anything, and has no chat assistant.",
};
/** English counterpart of QUICK_START (same targets, translated labels). */
export const QUICK_START_EN: Record<GuideRole, GuideAction[]> = {
  admin: [{ target: "admin", label: "⚙ Manage this trip" }, { target: "upload", label: "↑ Upload" }, { target: "chat", label: "🧳 Trip-chan" }, { target: "overview", label: "☷ Overview" }],
  member: [{ target: "overview", label: "☷ Overview" }, { target: "upload", label: "↑ Upload" }, { target: "chat", label: "🧳 Trip-chan" }, { target: "todo", label: "✓ To-dos & contacts" }],
  viewer: [{ target: "overview", label: "☷ Overview" }, { target: "todo", label: "✓ To-dos & contacts" }],
};
/** Role names in the given language. */
export const roleNames = (lang: GuideLang = "zh") => (lang === "en" ? ROLE_NAMES_EN : ROLE_NAMES);
/** One-line description of each role in the given language. */
export const roleSummary = (lang: GuideLang = "zh") => (lang === "en" ? ROLE_SUMMARY_EN : ROLE_SUMMARY);
/** Quick-start buttons for each role in the given language. */
export const quickStart = (lang: GuideLang = "zh") => (lang === "en" ? QUICK_START_EN : QUICK_START);

const editors: GuideRole[] = ["admin", "member"];

export const GUIDE: GuideSection[] = [
  { id: "enter", icon: "→", title: "登入與選行程", lead: "一個帳號可以在好幾個行程裡。", items: [
    { text: "用 Google 登入。第一次來需要家人傳的邀請連結或邀請碼；加入過的人直接登入。" },
    { text: "登入後會直接進上次打開的行程。要換行程：按右上角 [[menu|👤 你的名字]] → [[switch|切換行程]]。" },
    { text: "在選擇行程的頁面可以「建立新行程」（已經在某個行程裡當成員或管理員的人才能建，觀察員不行），或貼邀請碼加入別人的行程。建立行程的人就是那個行程的管理員。" },
    { text: "建立新行程有三種方式：「自己填」名稱、城市和日期；「上傳行程」傳現成的檔案、截圖、PDF 或貼文字，讀出來後補上缺的基本資料；「請 AI 排」選好目的地、天數、要推薦什麼，複製產生的文字貼給自己平常用的 AI，再把回答整段貼回來。" },
    { text: "[[menu|👤 你的名字]] 裡還有：改我的名字、退出這個行程（要輸入 delete 確認；最後一個人退出會把整個行程刪掉）、登出。" },
  ] },
  { id: "view", icon: "☷", title: "看行程", items: [
    { text: "頁首「看哪一家」可以切換看每一家的行程；「只看 ○○家／看所有家」把每一家同一天並排。" },
    { text: "日期列可以左右滑，今天會特別標示；每個日期上有天氣（出發前 16 天內是預報，更早是往年平均）。" },
    { text: "[[overview|☷ 總覽]] 把每一天的地點一頁列出來，可切成「只看吃、住、已訂」，也能列印或存成 PDF。" },
    { text: "點任何地點會打開詳細資訊：在 Google 地圖開啟、從上一站過來的路線、訂位資訊、訂位碼一鍵複製、電話、推薦、提醒、備註。" },
    { text: "「開啟今天的 Google 地圖路線」會把整天的地點串成一條路線。" },
    { text: "旅行當天打開，行程上會有一條紅色「現在」的線，過去的地點變淡；旁邊有開關，還沒出發也可以按「預覽」先看效果。" },
    { text: "有航班的那天，航班卡片當天會顯示準點狀態、登機門、櫃台或行李轉盤。" },
    { text: "[[info|ⓘ 其他資訊]] 是大家一起整理的補充資料（例如入境、退稅、伴手禮、租車、藥妝和超商必買）；成員和管理員都可以寫。商品旁的小圖點一下會放大，按 × 或點旁邊關掉。" },
    { text: "地點旁的信用卡標籤是依你勾的信用卡算出來的「這一站刷哪張最划算」，在 [[cards|💳 信用卡]] 設定。" },
    { text: "別人改了行程，你的畫面最多 5 分鐘內會自動更新；切回網頁時也會立刻檢查。" },
    { text: "沒有訊號也看得到：手機會留著上次載入的行程，沒網路時照樣打開（上面會有一條提示，這時只能看、不能改）。訊號不好、更新失敗時畫面不會消失，按提示上的「再試一次」就好。登出會把手機上存的行程清掉。" },
  ] },
  { id: "edit", icon: "✎", title: "改行程", lead: "可以改自己家的日子和「大家一起」的日子；別家自己的版本只能看。管理員全部都能改。", roles: editors, items: [
    { text: "[[upload|↑ 上傳行程]]：傳填好的表單（那頁可以下載）、行程截圖、PDF，或直接貼文字，Trip醬整理成行程後你看一下，按「確認，更新行程」才會上線。" },
    { text: "[[chat|🧳 Trip醬]]：直接說想改什麼（例如「12/30 我們家想住別間飯店，其他照舊」），它會整理成提案，一樣要按確認才生效。" },
    { text: "自己輸入：每一天的頁面有「＋ 加一站」，填時間和名稱就會照時間排進去；空白的一天也可以從這裡開始。" },
    { text: "小改動不用麻煩 Trip醬：點開地點，有「編輯」（時間、名稱、訂位狀態、地址、電話、推薦、怎麼去）、「＋ 之後加一站」、「刪除這一站」。改了時間會自動重新排序。" },
    { text: "每個地點最下面可以加備註，大家都看得到；自己的備註可以刪。" },
    { text: "一站可以「連到另一個行程」（編輯地點時選），例如台灣行程的「出發前往日本」連到日本跨年行程。兩個行程都有加入的人點開那站就能看到那天的內容並一鍵跳過去；沒加入的人只看得到名稱。" },
    { text: "日期列最後的 [[addday|＋ 加一天]] 可以幫自己家加日期（行程前後兩週內）；自己加的日子可以刪掉。" },
    { text: "這一天和誰一起：點每一天日期旁邊的版本標籤（「大家一起的版本」「某某家自己的版本」）。可以選大家一起、只有我們家，或點幾家的名字變成那幾家共用同一份。共用之後任何一家改了這幾家都會變，住宿可以各填各的。" },
    { text: "要共用的那一家如果那天已經排好自己的行程：會問用哪一份當共用的。一般成員不能用自己那一份蓋掉別家的，只能改用對方那一份，或請管理員處理。" },
    { text: "每一天頁面右邊的「⋯」→「優化順序」：勾選可以調動的地點（有訂位、用餐、車站機場預設不動），按計算會依距離找出移動最短的順序，看過再「套用」。它只算距離，不知道營業時間，所以當參考。" },
  ] },
  { id: "info", icon: "ⓘ", title: "其他資訊", lead: "入境、退稅、伴手禮、租車、要帶的東西……想到什麼就加一頁，大家都看得到。", roles: editors, items: [
    { text: "[[info|ⓘ 其他資訊]] →「＋ 新增一頁」：打標題和內容就好，直接打字會照段落顯示。想要格式可以用「# 小標」「- 項目」「1. 步驟」「| 表格 |」「[文字](網址)」，按「預覽」先看效果。" },
    { text: "「加圖片」或直接把圖片貼進內容，會變成文字旁的小縮圖（商品照、截圖都可以），大家點了就能放大比對。圖最長邊會自動縮到 1280，一張最多 5 MB。" },
    { text: "從網站或 LINE 複製來的一大段文字，貼進去按「幫我整理」：AI 會整理成條列或表格，不會上網查、也不會加原文沒有的內容。每個行程每天最多 10 次，用完就自己手寫。" },
    { text: "[[chat|🧳 Trip醬]] 查到的答案（例如退稅流程、怎麼去）下面有「存到其他資訊」，按一下就變成一頁，不用再問一次。" },
    { text: "每一頁大家都能「編輯」或「刪除」；最後改的人和時間會顯示在頁面上。刪掉一頁或把圖從內容拿掉，那些圖也會一起刪除。" },
    { text: "寫到一半不小心離開（點了別的日期、重新整理）：回到「其他資訊」會問你要不要「繼續編輯」那份草稿。如果你編輯的時候別人也改了同一頁，儲存時會告訴你，不會蓋掉對方的內容；可以把你的版本「另存成新的一頁」。「幫我整理」之後不滿意，可以按「還原成整理前的內容」。" },
  ] },
  { id: "cards", icon: "💳", title: "信用卡：每一站刷哪張", lead: "勾你有的卡，每一站旁邊就會標出刷哪張最划算（回饋最多、手續費最少）。", items: [
    { text: "[[cards|💳 信用卡]] → 打卡名或銀行加入你有的卡（美國、英國、台灣的卡都有，例：Sapphire、Amex Gold、Barclaycard、CUBE）。卡片庫沒有的可以新增一張，按「幫我查這張卡」讓 AI 上網查手續費和回饋，看過再儲存。" },
    { text: "開關「每一站顯示推薦的卡」開著時，行程上每個地點旁有信用卡標籤（卡名＋淨回饋 %），點開地點的「刷哪張卡」會說為什麼、有什麼條件，還有其次的卡。淨回饋 ＝ 回饋 − 海外交易手續費，發卡國和目的地相同時不算手續費。" },
    { text: "臨時要買東西：按左下角「捷徑」，一張小卡列出吃飯、買東西、飯店、交通、門票各刷哪張、淨回饋多少；店家不收 AmEx 時會寫改用哪張。" },
    { text: "日本行程的藥妝優惠券：首頁的「藥妝優惠券」（左下角「捷徑」和 [[info|ⓘ 其他資訊]] 的「藥妝店優惠券」頁也有）。按「找附近的藥妝」會用手機定位列出走路到得了、有優惠券的店，按「出示券」直接全螢幕顯示條碼給店員掃；不定位也可以從「全部優惠券」點店名。券要在結帳前連同護照出示。唐吉訶德只收官方網頁條碼，會另開網頁。位置只在手機上用，不會存。" },
    { text: "卡片庫是大家共用的：優惠變了誰看到就按「改資料」更新，誰改的會記下來。有黃色三角形的是優惠標示已到期，要跟銀行確認。" },
  ] },
  { id: "people", icon: "👪", title: "家人和誰會去", items: [
    { text: "帳號按鈕 → 帳號・家人・好友 → 我的家人：把會一起旅行的家人加進來，大人、小孩都可以，不需要有帳號。小孩填年齡，或填生日（年齡會自動跟著長）。備註可以寫飲食禁忌。這份名單每個行程共用。" },
    { text: "家裡另一位大人也有帳號的話：先互加好友，再在他的名字旁邊按「連結帳號」，之後他也能改這份名單。" },
    { text: "[[people|👪 這趟誰會去]]：勾選你們家這趟有誰去。上面會算出全部幾個人、幾大幾小、小孩幾歲，訂位買票照這個數字。" },
    { text: "沒有帳號的同行者（例如長輩）：管理員可以在「這趟誰會去」幫任何一家代填；成員可以幫自己家代填。" },
    { text: "各家那一天行程不同、但有一站要一起（例如一起吃午餐）：點開那個地點，在「和誰一起」點別家的名字，這一站就會出現在他們那一天的行程裡。之後時間、訂位、備註、誰參加，任何一家改了每一家都同步；前後的交通各家自己排。卡片上會標「和某某家」。" },
    { text: "共同的地點不去了：在自己家的行程按「刪除這一站」只會從自己家拿掉；要每一家都取消，用「和誰一起」裡的「整個取消」。" },
    { text: "分頭行動（例如小孩去一個地方、大人去另一個）：點開其中一站 →「＋ 之後加一站」→「和這一站的關係」選「同時進行」。可以直接選「小孩去這一站、大人留在原本那一站」，或之後在「誰參加」自己分。兩站會框在一起標「分頭行動」，並檢查有沒有人沒排到或兩邊都有。" },
    { text: "點開任何一個地點有「誰參加」：預設全員，點名字可以拿掉或加回來，會顯示這一站幾大幾小，可以一鍵複製給餐廳。" },
  ] },
  { id: "todo", icon: "✓", title: "待辦與聯絡資料", items: [
    { text: "[[todo|✓ 待辦・聯絡]] 分自己家和大家一起；「看所有家」可以並排看每一家的清單。" },
    { text: "可以新增、修改、勾選待辦，新增時選「給誰看」。", roles: editors },
    { text: "聯絡資料會自動列出行程裡出現的電話和 email（有「行程」標籤），也可以自己再加。" },
    { text: "觀察員只能看待辦和聯絡資料，不能新增或勾選。", roles: ["viewer"] },
  ] },
  { id: "chat", icon: "🧳", title: "Trip醬（AI 助理）", roles: editors, items: [
    { text: "右下角 [[chat|🧳 Trip醬]]。它看得到這個行程每一家的行程、待辦、聯絡資料，可以問細節（幾點、訂位碼、怎麼去），也可以改行程。" },
    { text: "貼店家或影片連結，它會上網查地址、營業時間、推薦，並建議排在哪一天。" },
    { text: "它只處理跟這個行程和網站有關的事，看不到其他行程，也不能改網站程式；改行程一定要你按「確認」。" },
    { text: "問到「其他資訊」裡的主題（退稅、入境……）時，它會先去讀那一頁再回答；有用的回答可以按「存到其他資訊」留下來。" },
    { text: "送出問題後切去別的 App 沒關係，回覆會留在對話裡；「清除對話」只清自己在這個行程的紀錄。" },
  ] },
  { id: "admin", icon: "⚙", title: "管理這個行程", lead: "只有管理員看得到這一頁。", roles: ["admin"], items: [
    { text: "[[admin|⚙ 管理]] → 團員：改每個人的家庭和角色（管理員／成員／觀察員），或移除。每個行程至少要有一位管理員。" },
    { text: "[[admin|⚙ 管理]] → 行程設定 → 行程圖案：挑一個代表這趟旅行的圖案（行李箱、富士山、郵輪、珍奶……），會出現在行程名稱旁邊和「我的行程」的卡片上。" },
    { text: "邀請好友：[[admin|⚙ 管理]] → 邀請好友，直接點好友的名字邀請，不用傳連結。對方打開網站會在「我的行程」那一頁看到邀請，可以選加入或不加入；他選了不加入你會看到，可以再邀一次或清掉。要先互為好友（帳號按鈕 → 帳號・好友）。" },
    { text: "邀請連結：選角色、可先指定對方是哪一家、設定可用次數和幾天後失效（預設 30 天），把連結傳給對方即可；不用的連結可以刪除。管理員邀請預設只能用 1 次、7 天內有效，因為拿到的人可以改所有行程、刪掉整個行程。清單上有黃色三角形的是舊的邀請（短碼或沒有期限），建議刪掉重發。" },
    { text: "家庭：新增、改名；還有成員、自己的日子、自己的待辦或聯絡資料的家不能刪。" },
    { text: "行程設定：名稱、日期、地點、當地時區（影響「現在」的線和航班日期）。延長日期會自動補上空白的日子。" },
    { text: "刪除整個行程要輸入行程名稱確認，所有人的資料都會消失，無法復原。" },
    { text: "想讓某人只能看：邀請時選「觀察員」，或在團員清單把他改成觀察員。" },
  ] },
  { id: "viewer", icon: "👁", title: "觀察員能做什麼", roles: ["viewer"], items: [
    { text: "你是觀察員：可以看每一家的行程、[[overview|☷ 總覽]]、地點詳細資訊、[[todo|✓ 待辦・聯絡]]、天氣和航班狀態。" },
    { text: "不能改行程、加日子、加備註、上傳，也沒有聊天機器人。需要改東西請告訴行程裡的成員或管理員。" },
    { text: "想變成成員，請管理員在「管理 → 團員」把你的角色改掉。" },
  ] },
  { id: "faq", icon: "?", title: "常見問題", items: [
    { text: "地圖開到錯的地方？點開那個地點 →「編輯」→ 把「Google 地圖搜尋字」改成店名加地址。", roles: editors },
    { text: "Google 登入出錯或邀請連結失效：跟邀請你的人或管理員要一個新的連結；邀請有次數上限，也會過期。" },
    { text: "Trip醬、上傳整理、幫我整理、幫我查卡說「今天已經用了 N 次」：每個功能每人每天、每個行程每天都有次數上限（避免一下子花太多錢），隔天就恢復。", roles: editors },
    { text: "沒看到別人剛改的內容：切到別的分頁再切回來，或等最多 5 分鐘會自動更新。" },
    { text: "想在手機上像 App 一樣用：用瀏覽器的「加入主畫面」，主畫面會多一個「行程」圖示。開過一次之後，沒有網路也打得開。" },
  ] },
];

/** English counterpart of GUIDE: same sections, ids, icons, roles and button targets, in the same order. Change both together. */
export const GUIDE_EN: GuideSection[] = [
  { id: "enter", icon: "→", title: "Signing in and choosing a trip", lead: "One account can be in several trips.", items: [
    { text: "Sign in with Google. The first time, you need an invite link or invite code from a family member; if you've joined before, just sign in." },
    { text: "After signing in you go straight to the trip you last opened. To change trips: press [[menu|👤 your name]] at the top right → [[switch|Switch trip]]." },
    { text: "On the trip picker you can “Create a new trip” (only if you're already a Member or Admin of some trip; Viewers can't), or paste an invite code to join someone else's trip. Whoever creates a trip is its Admin." },
    { text: "[[menu|👤 your name]] also has: change my name, leave this trip (type delete to confirm; when the last person leaves, the whole trip is deleted), and sign out." },
  ] },
  { id: "view", icon: "☷", title: "Viewing the itinerary", items: [
    { text: "“Which family” in the header switches between each family's itinerary; “Only this family / All families” puts every family's version of the same day side by side." },
    { text: "The date bar scrolls left and right, and today is highlighted. Each date shows the weather (a forecast within 16 days of departure, the average from past years before that)." },
    { text: "[[overview|☷ Overview]] lists every day's stops on one page. You can narrow it to food, lodging or booked stops only, and print it or save it as a PDF." },
    { text: "Tap any stop to open its details: open in Google Maps, the route from the previous stop, booking details, one-tap copy of the booking code, phone, recommendations, reminders and notes." },
    { text: "“Open today's Google Maps route” strings the whole day's stops into one route." },
    { text: "Open it on a travel day and the itinerary shows a red “now” line, with past stops faded. There's a switch next to it, and before the trip you can press “Preview” to see how it looks." },
    { text: "On a day with a flight, the flight card shows on-time status, gate, check-in counter or baggage carousel that day." },
    { text: "[[info|ⓘ Info]] is extra material everyone puts together (for example immigration, tax refunds, souvenirs, car rental, drugstore and convenience-store must-buys); Members and Admins can all write in it. Tap a small picture next to an item to enlarge it, and press × or tap beside it to close." },
    { text: "The card tag next to a stop is the best card to pay with at that stop, worked out from the cards you ticked. Set them up in [[cards|💳 Cards]]." },
    { text: "When someone else changes the itinerary, your screen updates by itself within 5 minutes at most; it also checks right away when you switch back to the page." },
    { text: "It works without signal: your phone keeps the itinerary it last loaded and still opens it offline (a notice appears at the top, and you can only look, not change). When the signal is poor and an update fails, the screen stays as it is; just press “Try again” on the notice. Signing out clears the itinerary stored on the phone." },
  ] },
  { id: "edit", icon: "✎", title: "Changing the itinerary", lead: "You can change your own family's days and the days everyone shares; another family's own version is view-only. Admins can change everything.", roles: editors, items: [
    { text: "[[upload|↑ Upload]]: send the filled-in form (you can download it on that page), a screenshot of an itinerary, a PDF, or just paste text. Trip-chan turns it into an itinerary for you to check, and it only goes live when you press “Confirm and update the itinerary”." },
    { text: "[[chat|🧳 Trip-chan]]: just say what you want to change (for example “On 12/30 our family wants a different hotel, everything else the same”). It prepares a proposal, which also takes effect only after you confirm." },
    { text: "Type it in yourself: each day's page has “+ Add a stop”. Enter a time and a name and it's slotted in by time; an empty day can start from here too." },
    { text: "Small changes don't need Trip-chan: open a stop and you'll find “Edit” (time, name, booking status, address, phone, recommendations, how to get there), “+ Add a stop after this” and “Delete this stop”. Changing the time re-sorts the day automatically." },
    { text: "You can add notes at the bottom of every stop, and everyone can see them; you can delete your own notes." },
    { text: "A stop can “link to another trip” (chosen when editing the stop), for example “Leave for Japan” in a Taiwan trip linking to the Japan New Year trip. People who are in both trips can open that stop to see that day's plan and jump over in one tap; people who aren't only see the name." },
    { text: "[[addday|+ Add a day]] at the end of the date bar adds a date for your own family (within two weeks before or after the trip); you can delete days you added." },
    { text: "Who you spend a day with: tap the version tag next to each day's date (“Everyone's version”, “So-and-so family's own version”). Choose everyone together, just our family, or tap a few families' names so those families share one copy. Once shared, a change by any of those families changes it for all of them; each family can still enter its own lodging." },
    { text: "If a family you want to share with already has its own itinerary for that day, you're asked which copy to use as the shared one. A regular Member can't overwrite another family's copy with their own: use the other family's copy instead, or ask an Admin to sort it out." },
    { text: "“⋯” on the right of each day's page → “Optimize order”: tick the stops that may be moved (booked stops, meals, stations and airports stay put by default), press calculate, and it finds the order with the least travel by distance. Check it, then “Apply”. It only looks at distance and doesn't know opening hours, so treat it as a suggestion." },
  ] },
  { id: "info", icon: "ⓘ", title: "Info", lead: "Immigration, tax refunds, souvenirs, car rental, what to pack… add a page whenever something comes to mind, and everyone can see it.", roles: editors, items: [
    { text: "[[info|ⓘ Info]] → “+ New page”: just type a title and the content, and plain typing is shown paragraph by paragraph. For formatting you can use “# Heading”, “- Item”, “1. Step”, “| Table |” and “[text](link)”; press “Preview” to see the result first." },
    { text: "“Add picture”, or paste a picture straight into the content, and it becomes a small thumbnail beside the text (product photos, screenshots, anything) that everyone can tap to enlarge and compare. The longest side is shrunk to 1280 automatically, and each picture can be up to 5 MB." },
    { text: "For a big block of text copied from a website or LINE, paste it in and press “Tidy up for me”: the AI turns it into a list or a table, without looking anything up online or adding anything that wasn't in the original. Each trip gets up to 10 a day; after that, write it by hand." },
    { text: "Answers [[chat|🧳 Trip-chan]] finds (for example the tax refund steps, or how to get somewhere) have “Save to Info” underneath. One press turns the answer into a page, so nobody has to ask again." },
    { text: "Anyone can “Edit” or “Delete” any page; the page shows who changed it last and when. Deleting a page, or taking a picture out of the content, deletes those pictures too." },
    { text: "If you leave by accident halfway through writing (tapped another date, refreshed the page): when you return to Info it asks whether to “Keep editing” that draft. If someone else changed the same page while you were editing, you're told when you save and their content isn't overwritten; you can “Save as a new page” to keep your version. If you don't like the result of “Tidy up for me”, press “Restore the content from before tidying”." },
  ] },
  { id: "cards", icon: "💳", title: "Cards: which one to use at each stop", lead: "Tick the cards you have, and each stop is marked with the best card to use there (most rewards, lowest fees).", items: [
    { text: "[[cards|💳 Cards]] → type a card name or bank to add the cards you have (US, UK and Taiwan cards are included, e.g. Sapphire, Amex Gold, Barclaycard, CUBE). If a card isn't in the library you can add it: press “Look up this card for me” to have the AI look up its fees and rewards online, then check them before saving." },
    { text: "While the switch “Show the recommended card at each stop” is on, every stop in the itinerary has a card tag (card name + net reward %). “Which card to use” inside a stop explains why, what conditions apply, and the next-best cards. Net reward = reward − foreign transaction fee; no fee is counted when the card's country and the destination are the same." },
    { text: "Buying something on the spot: press “Shortcuts” at the bottom left. A small card lists which card to use for meals, shopping, hotels, transport and tickets, with the net reward for each; where a shop doesn't take AmEx, it says which card to use instead." },
    { text: "Drugstore coupons for Japan trips: “Drugstore coupons” on the home page (also in “Shortcuts” at the bottom left and on the “Drugstore coupons” page in [[info|ⓘ Info]]). “Find drugstores nearby” uses your phone's location to list shops within walking distance that have a coupon; press “Show coupon” to put the barcode full-screen for the cashier to scan. Without location you can still tap a shop's name under “All coupons”. Show the coupon together with your passport before paying. Don Quijote only accepts the barcode on its official web page, so that opens separately. Your location is only used on the phone and isn't stored." },
    { text: "The card library is shared by everyone: when an offer changes, whoever notices can press “Edit details” to update it, and who changed it is recorded. A yellow triangle means the listed offer has passed its end date; check with the bank." },
  ] },
  { id: "people", icon: "👪", title: "Family and who's going", items: [
    { text: "Account button → Account, family & friends → My family: add the family members who travel with you, adults and children alike; they don't need an account. For children, enter an age or a birthday (the age then keeps up by itself). Use the note for dietary restrictions. This list is shared across all your trips." },
    { text: "If another adult in your family also has an account: add each other as friends first, then press “Link account” next to their name. After that they can change this list too." },
    { text: "[[people|👪 Who's going]]: tick who from your family is coming on this trip. The top shows the total headcount, how many adults and children, and the children's ages; use these numbers for bookings and tickets." },
    { text: "Travelers without an account (for example grandparents): an Admin can fill them in for any family under “Who's going”; a Member can do it for their own family." },
    { text: "When families have different plans for a day but share one stop (for example lunch together): open that stop and tap another family's name under “With whom”, and the stop appears in their itinerary for that day. From then on the time, booking, notes and who's joining stay in sync for every family, whoever changes them; each family arranges its own transport before and after. The card is marked “with the So-and-so family”." },
    { text: "Not going to a shared stop after all: “Delete this stop” in your own family's itinerary only removes it for your family. To cancel it for every family, use “Cancel for everyone” under “With whom”." },
    { text: "Split up (for example the kids go one place and the adults another): open one of the stops → “+ Add a stop after this” → under “Relation to this stop” choose “At the same time”. You can pick “Kids go to this stop, adults stay at the original one” directly, or divide people yourself later under “Who's joining”. The two stops are boxed together and marked “Split up”, and it checks that nobody is left out or placed in both." },
    { text: "Every stop has “Who's joining”: everyone by default; tap a name to take someone out or put them back. It shows how many adults and children are at this stop, and you can copy that in one tap for the restaurant." },
  ] },
  { id: "todo", icon: "✓", title: "To-dos and contacts", items: [
    { text: "[[todo|✓ To-dos & contacts]] is split into your own family's and everyone's; “All families” shows each family's list side by side." },
    { text: "You can add, change and tick off to-dos; when adding one, choose who can see it.", roles: editors },
    { text: "Contacts automatically lists the phone numbers and emails that appear in the itinerary (tagged “Itinerary”), and you can add more yourself." },
    { text: "Viewers can only look at to-dos and contacts; they can't add or tick anything.", roles: ["viewer"] },
  ] },
  { id: "chat", icon: "🧳", title: "Trip-chan (AI assistant)", roles: editors, items: [
    { text: "[[chat|🧳 Trip-chan]] is at the bottom right. It can see every family's itinerary, to-dos and contacts in this trip, so you can ask for details (what time, the booking code, how to get there) or have it change the itinerary." },
    { text: "Paste a link to a shop or a video and it looks up the address, opening hours and recommendations online, and suggests which day to fit it into." },
    { text: "It only deals with this trip and this site: it can't see other trips and can't change the site's code. Any change to the itinerary needs you to press “Confirm”." },
    { text: "When you ask about a topic covered in Info (tax refunds, immigration…), it reads that page first and then answers; press “Save to Info” to keep a useful answer." },
    { text: "It's fine to switch to another app after sending a question; the reply stays in the conversation. “Clear conversation” only clears your own history in this trip." },
  ] },
  { id: "admin", icon: "⚙", title: "Managing this trip", lead: "Only Admins can see this page.", roles: ["admin"], items: [
    { text: "[[admin|⚙ Manage]] → People: change each person's family and role (Admin / Member / Viewer), or remove them. Every trip needs at least one Admin." },
    { text: "[[admin|⚙ Manage]] → Trip settings → Trip icon: pick a picture that stands for this trip (suitcase, Mt. Fuji, cruise ship, bubble tea…). It appears next to the trip name and on the card under “My trips”." },
    { text: "Inviting friends: [[admin|⚙ Manage]] → Invite friends, then tap a friend's name to invite them; no link needed. When they open the site they see the invitation on the “My trips” page and can accept or decline. If they decline you'll see it, and can invite them again or clear it. You need to be friends first (account button → Account & friends)." },
    { text: "Invite links: choose a role, optionally set which family the person belongs to, and set how many times the link can be used and after how many days it expires (30 by default), then send them the link; delete links you no longer need. Admin invitations by default work only once and for 7 days, because whoever gets one can change every itinerary and delete the whole trip. Those marked in the list are old invitations (a short code or no expiry); it's best to delete them and send new ones." },
    { text: "Families: add or rename. A family that still has members, its own days, or its own to-dos or contacts can't be deleted." },
    { text: "Trip settings: name, dates, place and local time zone (which affects the “now” line and flight dates). Extending the dates adds the empty days automatically." },
    { text: "Deleting the whole trip requires typing the trip name to confirm. Everyone's data is gone and can't be recovered." },
    { text: "To let someone only look: choose “Viewer” when inviting, or change them to Viewer in the people list." },
  ] },
  { id: "viewer", icon: "👁", title: "What Viewers can do", roles: ["viewer"], items: [
    { text: "You're a Viewer: you can see every family's itinerary, [[overview|☷ Overview]], stop details, [[todo|✓ To-dos & contacts]], the weather and flight status." },
    { text: "You can't change the itinerary, add days, add notes or upload, and there's no chat assistant. If something needs changing, tell a Member or Admin of the trip." },
    { text: "To become a Member, ask an Admin to change your role under “Manage → People”." },
  ] },
  { id: "faq", icon: "?", title: "Common questions", items: [
    { text: "The map opens the wrong place? Open that stop → “Edit” → change “Google Maps search text” to the shop name plus its address.", roles: editors },
    { text: "Google sign-in fails or the invite link no longer works: ask whoever invited you, or an Admin, for a new link; invitations have a use limit and also expire." },
    { text: "Trip-chan, upload, “Tidy up for me” or the card lookup says “already used N times today”: each feature has a daily limit per person and per trip (so it doesn't cost too much at once). It resets the next day.", roles: editors },
    { text: "Can't see what someone just changed: switch to another tab and back, or wait up to 5 minutes for it to update by itself." },
    { text: "To use it like an app on your phone: use your browser's “Add to Home Screen”, and a trip icon appears on your home screen. Once you've opened it one time, it opens without a connection too." },
  ] },
];
/** The whole guide in the given language. */
export const guide = (lang: GuideLang = "zh") => (lang === "en" ? GUIDE_EN : GUIDE);

/** The sections and items this role should see, in the given language (Chinese when omitted). */
export function guideFor(role: GuideRole, lang: GuideLang = "zh"): GuideSection[] {
  return guide(lang)
    .filter((s) => !s.roles || s.roles.includes(role))
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || i.roles.includes(role)) }))
    .filter((s) => s.items.length > 0);
}

export const ACTION_RE = /\[\[([a-z-]+)\|([^\]]+)\]\]/g;
/** `[[target|label]]` → 「label」 (“label” in English) for plain-text uses (the chatbot). */
export const plain = (text: string, lang: GuideLang = "zh") => text.replace(ACTION_RE, lang === "en" ? "“$2”" : "「$2」");

/** Plain text for the chatbot's system prompt: everything, with role tags so it can answer for whoever is asking. */
export function guideText(lang: GuideLang = "zh"): string {
  const en = lang === "en";
  const tag = (roles?: GuideRole[]) => (!roles || roles.length === 3 ? "" : en ? ` (${roles.map((r) => ROLE_NAMES_EN[r]).join(", ")} only)` : `（${roles.map((r) => ROLE_NAMES[r]).join("、")}才有）`);
  return guide(lang).map((s) => `${s.title}${tag(s.roles)}${en ? ": " : "："}${s.lead ? plain(s.lead, lang) : ""}\n${s.items.map((i) => `- ${plain(i.text, lang)}${tag(i.roles)}`).join("\n")}`).join("\n");
}
