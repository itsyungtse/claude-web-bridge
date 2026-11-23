const SERVER_URL = 'http://127.0.0.1:4567';

async function sendToPanel(tab, type) {
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  chrome.tabs.sendMessage(tab.id, { type });
}

chrome.action.onClicked.addListener((tab) => sendToPanel(tab, 'toggle-panel'));
chrome.commands.onCommand.addListener((command, tab) => sendToPanel(tab, command));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'capture-tab') {
    chrome.tabs
      .captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((error) => sendResponse({ error: String(error) }));
    return true;
  }
  if (message.type === 'server-get') {
    fetch(SERVER_URL + message.path)
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
        return response.json();
      })
      .then((data) => sendResponse({ data }))
      .catch((error) => sendResponse({ error: `連不到本機伺服器：${error}` }));
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'chat') return;
  const abort = new AbortController();
  port.onDisconnect.addListener(() => abort.abort());

  port.onMessage.addListener(async (payload) => {
    try {
      const response = await fetch(SERVER_URL + '/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abort.signal,
      });
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffered = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += value;
        const lines = buffered.split('\n');
        buffered = lines.pop();
        lines.filter(Boolean).forEach((line) => port.postMessage(JSON.parse(line)));
      }
      port.postMessage({ type: 'closed' });
    } catch (error) {
      if (!abort.signal.aborted) port.postMessage({ type: 'error', text: `連不到本機伺服器：${error}` });
    }
  });
});
