# trashchat

`trashchat` 是一個固定身分的即時聊天網站：`10`、`27` 與 `17`。

## 功能

- 身分選擇頁：以 `10`、`27` 或 `17` 進入聊天室
- 自己訊息靠右，對方訊息靠左
- 純文字訊息、圖片訊息、文字加圖片訊息
- 訊息時間顯示
- 圖片固定高度並使用 `object-fit: contain`
- 點擊圖片開啟暗背景原比例預覽
- 可回覆任一訊息，引用區塊可定位並高亮原訊息
- 只能編輯自己 15 分鐘內送出的訊息
- 編輯後標示「已編輯」
- 只能收回自己的訊息，收回後保留位置並隱藏文字與圖片
- PostgreSQL 資料庫儲存訊息
- Pusher Channels 即時同步，未設定 Pusher 時本機用短輪詢 fallback
- 網站驗證後才建立 HttpOnly 工作階段，聊天 API、搜尋、圖片與通話都需要驗證
- 即時訊息使用私人加密頻道，圖片加密後儲存於 Blob
- 語音通話訊號會同時走 Pusher 與 PostgreSQL 輪詢備援，避免 websocket event 漏接

## 技術

- Next.js App Router
- TypeScript
- Tailwind CSS
- Prisma
- Neon/PostgreSQL
- Vercel Blob
- Pusher Channels

## 本機開發

```bash
npm install
cp .env.example .env
```

填入 `.env`：

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
TRASHCHAT_AUTH_USER="trashchat"
TRASHCHAT_AUTH_PASSWORD="change-this-password"
TRASHCHAT_DATA_KEY="填入一次產生的64位十六進位金鑰"
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_xxxxxxxxxxxxxxxxx"
PUSHER_APP_ID="0000000"
PUSHER_SECRET="xxxxxxxxxxxxxxxxxxxx"
PUSHER_CLUSTER="ap3"
NEXT_PUBLIC_PUSHER_KEY="xxxxxxxxxxxxxxxxxxxx"
NEXT_PUBLIC_PUSHER_CLUSTER="ap3"
```

初始化資料庫：

```bash
npm run db:deploy
```

如果是本機快速同步 schema，也可用：

```bash
npm run db:push
```

啟動開發伺服器：

```bash
npm run dev
```

開啟 `http://localhost:3000`。

## 部署到 Vercel

1. 將專案推到 GitHub。
2. 建立 Neon PostgreSQL database，取得 `DATABASE_URL`。
3. 在 Vercel 建立 Blob store，取得 `BLOB_READ_WRITE_TOKEN`。
4. 建立 Pusher Channels app，取得 app id、key、secret、cluster。
5. 在 Vercel 匯入 GitHub repo。
6. 到 Vercel Project Settings 加入 `.env.example` 中的環境變數。
7. 務必設定至少 16 字元的隨機 `TRASHCHAT_AUTH_PASSWORD`；未設定、太短或仍使用範例密碼時網站會停止提供資料。
   `TRASHCHAT_DATA_KEY` 請用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 產生一次，
   在本機 `.env` 與 Vercel 設定相同的值並妥善備份，不可任意輪替，否則舊圖片將無法解密。
   未設定這個金鑰時即時頻道不會發送資料，文字訊息改用受保護的輪詢備援。
8. 對 production database 執行 migration：

```bash
npm run db:deploy
```

Vercel build command 使用：

```bash
npm run build
```

不要在 production 使用 `npm run db:push`，production database 應使用 migration。

## 舊版安全升級

先將新的網站版本部署至所有使用同一資料庫或 Blob 的環境，停用仍執行舊版程式的公開部署。
只重新部署主網域不會自動修補仍能存取的舊 Vercel deployment 網址。
Vercel 的歷史部署請設為 Deployment Protection 或刪除；不要讓舊版 API 繼續提供正式資料。
建議在 Settings > Deployment Protection 開啟 Vercel Authentication，範圍選 Standard Protection，
保護舊部署網址，維持正式網域原有的網站驗證方式。

網站密碼應換成只有獲准使用者知道的長隨機密碼。新版本沒有新增聊天畫面或改變選擇身分的操作；
沿用瀏覽器原生的網站密碼驗證，通過後會自動處理 API 與私人頻道授權。
即時頻道由 Pusher SDK 加密；更換網站密碼並重新部署會同時更換頻道解密金鑰，
舊連線不能繼續解密新訊息，且不影響以固定資料金鑰保存的圖片。

既有的公開圖片必須完成一次遷移，光是部署新版並不會撤銷已經流出的 Blob 網址。
使用 Node.js 22.6 以上，在本機 `.env` 填入正式資料庫、Blob token，以及與 Vercel **完全相同**的 `TRASHCHAT_DATA_KEY`：

```bash
npm run security:migrate-images
npm run security:migrate-images -- --apply
```

第一個指令只檢查數量。第二個指令會加密圖片、讀回驗證、更新所有訊息的圖片與縮圖參照，
最後才刪除公開原檔；中斷後可重跑，失敗時保留原檔。請在資料庫備份後執行，不需新增資料表。
工具也會處理早期 `chorchat/` 路徑與最大 8MB 的歷史圖片；新的圖片上傳仍限制為 4MB。
刪除在 Blob CDN 上可能需要約 60 秒傳播，別人已下載的內容或瀏覽器既有快取不能追回。

安全界線：這是共同聊天室，知道網站密碼的人仍有權查看全部訊息。
無法阻止獲准進入網站的人使用開發者工具、複製自己的工作階段、截圖或省略已讀請求。
工作階段不是 DRM；Origin/Fetch Metadata 檢查只是跨站防護，不能當成登入驗證。
未登入者不能直接讀取 API、解密圖片或取得私人頻道授權。資料回應禁止公開快取。

## 資料表

Prisma schema 位於 `prisma/schema.prisma`。

核心資料表為 `messages`：

- `id`
- `sender`：`CHEN`、`ZUO` 或 `SEVENTEEN`
- `text`
- `image_url`
- `image_urls`
- `created_at`
- `updated_at`
- `edited_at`
- `recalled_at`
- `read_at`
- `reply_to_message_id`

語音通話訊號使用 `call_signals`：

- `id`
- `type`
- `call_id`
- `from`
- `to`
- `payload`
- `created_at`

## 行為規則

- 編輯限制由 API server 端檢查，超過 15 分鐘不可編輯。
- 已收回訊息不可再編輯。
- 已收回訊息不再顯示文字與圖片。
- 回覆引用若指向已收回訊息，只顯示「已收回的訊息」。
- 圖片上傳走 `/api/upload`，檔案儲存在 Vercel Blob。
