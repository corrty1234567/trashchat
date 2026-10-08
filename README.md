# trashchat

`trashchat` 是一個固定身分的即時聊天網站：`10`、`27` 與 `17`。

## 功能

- 身分選擇頁：以 `10`、`27` 或 `17` 進入聊天室
- 自己訊息靠右，對方訊息靠左
- 純文字訊息、圖片訊息、文字加圖片訊息
- 訊息時間顯示
- 單張圖片固定高度，多張圖片以格狀縮圖顯示；預覽保留原始比例
- 點擊圖片開啟暗背景原比例預覽
- 可回覆任一訊息，引用區塊可定位並高亮原訊息
- 只能編輯自己 15 分鐘內送出的訊息
- 編輯後標示「已編輯」
- 只能收回自己的訊息，收回後保留位置並隱藏文字與圖片
- PostgreSQL 資料庫儲存訊息
- Pusher Channels 即時同步，未設定 Pusher 時本機用短輪詢 fallback
- 開啟首頁時自動建立 HttpOnly 工作階段，直接選身分，不需輸入帳號密碼；聊天 API、搜尋、圖片與通話都檢查工作階段
- 即時訊息使用私人加密頻道，圖片加密後儲存於 Blob
- 語音通話訊號會同時走 Pusher 與 PostgreSQL 輪詢備援，避免 websocket event 漏接
- 本次進站未讀位置分隔線與日期分組；進站仍先顯示最新訊息，閱讀舊訊息時不強制跳回
- 通話紀錄保存對象、撥入或撥出、結果與實際連線時長，不錄音；與一小時後會清除的通話訊號分開保存
- 圖片預覽可下載原圖或整組 ZIP；聊天相簿可跨訊息選取最多 30 張、總計 80 MB 打包，支援進度與取消
- 相簿及通話紀錄按需載入，不阻擋聊天室首次載入；相簿與下載不會將聊天訊息標為已讀

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
7. 務必設定至少 16 字元的隨機 `TRASHCHAT_AUTH_PASSWORD`；這是伺服器簽署工作階段用的秘密，不是訪客登入密碼。
   為沿用既有部署而保留變數名稱，訪客不需輸入它；`TRASHCHAT_AUTH_USER` 僅作為可選的簽章命名空間。
   未設定、太短或仍使用範例值時網站會停止提供資料。
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

### 啟用通話紀錄

這次更新新增 `call_records` 資料表。部署前以正式資料庫的 `DATABASE_URL` 執行一次 `npm run db:deploy`，
再推送新版本。這只新增通話紀錄表與索引，不刪除既有訊息、成員或圖片，不需要新增環境變數。
通話紀錄從更新後開始保存；舊版只保存短期連線訊號，無法還原完整歷史。
清理舊通話訊號不會刪除通話紀錄。通話時間由實際 WebRTC 連線開始計算，不包含響鈴時間。
圖片 ZIP 在瀏覽器內以 fflate 建立，不會再上傳一份到 Blob，也不會公開原始圖片網址。

## 舊版安全升級

先將新的網站版本部署至所有使用同一資料庫或 Blob 的環境，停用仍執行舊版程式的公開部署。
只重新部署主網域不會自動修補仍能存取的舊 Vercel deployment 網址。
Vercel 的歷史部署請設為 Deployment Protection 或刪除；不要讓舊版 API 繼續提供正式資料。
建議在 Settings > Deployment Protection 開啟 Vercel Authentication，範圍選 Standard Protection，
保護舊部署網址，正式網域仍直接進入身分選擇頁。

伺服器的 `TRASHCHAT_AUTH_PASSWORD` 應使用不公開的長隨機值，不需提供給聊天成員。
開啟首頁後會自動建立工作階段，再直接選身分；不再出現瀏覽器原生帳密登入視窗。
API 與私人頻道授權仍檢查工作階段。即時頻道由 Pusher SDK 加密；更換簽章秘密並重新部署
會同時更換頻道解密金鑰，舊連線不能繼續解密新訊息，但可重新開啟首頁取得新的工作階段與授權。
更換簽章秘密不影響以固定資料金鑰保存的圖片。

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

安全界線：這是公開入口的共同聊天室，知道網址的人就能開啟首頁、取得工作階段並查看全部訊息。
自動建立的工作階段不是使用者身分驗證，不能保證只有手動操作網站才能取得聊天紀錄。
程式也能模擬瀏覽器開啟首頁後讀取 API，並省略已讀請求；無法阻止複製工作階段、開發者工具或截圖。
Origin/Fetch Metadata 檢查只是跨站防護，不能當成登入驗證。沒有有效工作階段的請求
不能直接讀取 API、解密圖片或取得私人頻道授權，資料回應禁止公開快取。
若要排除知道網址的外人，仍必須另外加入真正的身分驗證或裝置授權，不能同時維持完全公開的入口。

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
