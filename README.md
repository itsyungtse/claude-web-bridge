# Claude Web Bridge

在網頁上點選元素或拖拉框選一塊範圍，然後在瀏覽器裡跟本機的 Claude Code 對話。終端機裡的對話可以在網頁接著聊，反過來也行。

## 啟動

```sh
node server.mjs
```

預設權限模式是 `acceptEdits`：Claude 可以直接改檔，但不能跑終端機指令。想讓它也能跑指令就用：

```sh
PERMISSION_MODE=bypassPermissions node server.mjs
```

### 開機自動啟動（macOS）

```sh
./autostart.sh
```

之後登入電腦就會自動啟動伺服器，當掉也會自動重開，紀錄寫在 `~/Library/Logs/claude-web-bridge.log`。搬動資料夾或想改權限模式時，重跑一次就好（例如 `PERMISSION_MODE=bypassPermissions ./autostart.sh`）。不要了就執行 `./autostart.sh uninstall`。

## 安裝擴充功能

1. Chrome 網址列輸入 `chrome://extensions`
2. 打開右上角「開發人員模式」
3. 按「載入未封裝項目」，選這個資料夾裡的 `extension`

## 使用

- 點工具列上的擴充功能圖示，或按 `Alt+Shift+C`，右下角會打開對話框
- 最上面的下拉選單可以選要接續哪段對話，或在某個專案資料夾開新對話
- 「選元素」：滑鼠移到元素上會出現框線，點下去就附上該元素的 HTML、樣式和截圖
- 「框範圍」：拖拉框出一塊區域，附上那塊的截圖
- 按 Esc 取消選取

## 和終端機對話的關係

- 網頁送出的訊息會寫進同一段對話紀錄
- 終端機已經開著那段對話的話，看不到網頁這邊新增的內容。回到終端機時輸入 `/resume` 再選那段對話，就能接上網頁那邊的進度
- 不要在終端機和網頁兩邊同時對同一段對話送訊息
