# 球球手帳 🎀

在 Mac、iPad、iPhone 都能用的手帳日記。用 Apple Pencil 手寫、貼貼紙、拼貼照片，旅行時把紀念章、收據、票根拍下來收進收藏冊，就不怕紙本弄丟。

日記存在你的裝置上；接上你自己的 Firebase 之後，Mac、iPad、iPhone 會自動同步，而且只有你看得到。

## 功能

**✍️ 手帳頁面**
- 寫字筆：支援 Apple Pencil 壓力感應，越用力線條越粗
- 畫畫筆刷：可以調粗細和濃淡，像水彩一樣
- 螢光筆：濃淡可以調，重疊的地方不會變深
- 橡皮擦：「局部擦」只擦一小塊，「整筆擦」一次擦掉整條線
- 用 Apple Pencil 寫字時，手指只拿來捲動，手掌碰到螢幕也不會畫到
- 貼紙：原創貼紙、表情符號、紙膠帶，也能把自己的照片做成貼紙（可以去掉白底）
- 照片拼貼：拍立得、圓形、郵票、無框四種外框，拍立得下面還能寫小字
- 打字：楷書、圓體、黑體、明體
- 所有東西都能拖曳、旋轉、縮放（iPad 可以用兩指），也能調整上下層
- 可以復原／重做，Mac 上可以按 ⌘Z
- 六種紙張：空白、橫線、方格、點點、牛皮紙、粉紅
- 可以把整頁存成圖片，存到「照片」或分享給朋友

**😴 給懶人的設計**
- 「一句話日記」：選個心情、打一句話、放張照片，App 會自動排成一頁
- 連續寫日記天數 🔥
- 每天換一個寫作提示
- 一年前、一個月前的今天寫了什麼
- 每天提醒：下載行事曆檔，iPhone、iPad、Mac 會一起提醒你

**✈️ 旅行紀錄**
- 每趟旅行有自己的收藏冊：紀念章、收據發票、票根、其他
- 把紀念章蓋在任何白紙上拍下來，App 會自動去掉紙的白底，還能換印章顏色
- 收藏可以直接貼到日記頁上
- 一鍵幫旅行的每一天建立一頁日記
- 月曆上會標出旅行的日子

## 放上 GitHub Pages（免費網址）

1. 到 [github.com](https://github.com) 登入，右上角「+」→「New repository」
2. Repository name 取個名字，例如 `diary`，選 **Public**，按「Create repository」
3. 在新頁面點「uploading an existing file」，把這個資料夾**裡面的所有東西**（`index.html`、`css`、`js`、`icons` 等）拖進去，按「Commit changes」
4. 到 repo 的「Settings」→ 左邊「Pages」→ Branch 選 `main`、資料夾選 `/ (root)` → 按「Save」
5. 等 1–2 分鐘，網址會出現在同一頁，長得像 `https://你的帳號.github.io/diary/`

> 程式碼會公開，但**日記內容不會**：日記只存在你的裝置裡，不在 GitHub 上。

## 裝到 iPhone、iPad、Mac

- **iPhone / iPad**：用 Safari 打開網址 → 點「分享」→「加入主畫面」
- **Mac**：用 Safari 打開網址 → 選單列「檔案」→「加入 Dock」

裝好之後就像一般 App，沒有網路也能寫。

## ☁️ 雲端同步（Firebase，免費）

1. 在 [Firebase 主控台](https://console.firebase.google.com) 建一個專案，開啟「Authentication → 電子郵件/密碼」和「Firestore Database」（位置選 asia-east1）
2. Firestore 的「規則」換成下面這段，按「發布」：
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
3. 「專案設定 → 你的應用程式 → 網頁 </>」註冊一個網頁 App，把 `firebaseConfig` 那段貼進 `js/firebase-config.js`
4. 「Authentication → 設定 → 授權網域」加入 `你的帳號.github.io`
5. 打開 App →「設定」→ 用 Email 註冊。其他裝置用同一組 Email 登入就會同步
6. 註冊完之後，建議到「Authentication → 設定 → 使用者動作」把「啟用建立（註冊）」關掉，這樣別人就不能用你的專案開帳號

**小提醒**
- 沒網路時照樣能寫，連上網會自動上傳
- 兩台裝置在沒網路時各自改了「同一頁」，連上網後以最後改的那台為準
- 照片會壓縮後存進 Firestore，不需要 Firebase Storage，也不用綁信用卡。免費方案有 1GB 空間
- 「設定」裡的「匯出備份檔」還是可以用，建議偶爾備份一次

## 更新程式

改了程式碼之後，把 `sw.js` 最上面的 `VERSION` 改成下一個版本（例如 `qiuqiu-v2`），再上傳到 GitHub。大家下次打開 App 就會拿到新版本。

## 在自己電腦上試跑

這個 App 需要用網頁伺服器打開（直接點兩下 `index.html` 不行）。在資料夾裡打開「終端機」輸入：

```
python3 -m http.server 8000
```

然後用瀏覽器打開 `http://localhost:8000`。

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `index.html` | 所有畫面 |
| `css/style.css` | 外觀 |
| `js/app.js` | 首頁、日記本、旅行、收藏冊、設定 |
| `js/editor.js` | 手帳編輯器（筆刷、貼紙、照片、文字） |
| `js/render.js` | 畫筆跡、紙張、匯出圖片、印章去背 |
| `js/stickers.js` | 內建貼紙、紙膠帶、紙張、寫作提示 |
| `js/db.js` | 資料儲存（IndexedDB） |
| `js/sync.js` | 雲端同步 |
| `js/firebase-config.js` | 你的 Firebase 設定 |
| `js/vendor/firebase.js` | Firebase 程式庫（v12.19.0，已打包好，離線也能用） |
| `sw.js` | 離線功能 |
| `manifest.webmanifest` | 加入主畫面用的設定 |
