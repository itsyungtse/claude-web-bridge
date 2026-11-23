# page-snap

A Chrome extension that copies a screenshot of a page element or a dragged region to the clipboard, ready to paste into Claude Code in VS Code or a terminal.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension` folder in this repo.

## Usage

- Click the extension icon to show a small toolbar at the top of the page. Switch between **element** and **region** mode. Click the icon again or press ✕ to close it.
- **Pick element** (`Alt+Shift+E`): hover to highlight an element, click to copy its screenshot.
- **Drag region** (`Alt+Shift+R`): the current view freezes, then drag a box to copy a screenshot of that area.
- Paste into the Claude input in VS Code with `Cmd+V`.
- For dropdowns, popups and anything that closes when you click outside, open it first, then start selecting with the shortcut.
- Press `Esc` to cancel.
- If a shortcut conflicts with another extension, change it at `chrome://extensions/shortcuts`.
