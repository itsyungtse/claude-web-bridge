async function sendToPage(tab, type) {
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  chrome.tabs.sendMessage(tab.id, { type });
}

chrome.action.onClicked.addListener((tab) => sendToPage(tab, 'toggle-toolbar'));
chrome.commands.onCommand.addListener((command, tab) => sendToPage(tab, command));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'capture-tab') {
    chrome.tabs
      .captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((error) => sendResponse({ error: String(error) }));
    return true;
  }
});
