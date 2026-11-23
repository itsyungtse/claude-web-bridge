if (!window.__claudeWebBridge) {
  window.__claudeWebBridge = true;

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "PingFang TC", sans-serif; font-size: 13px; }
    .panel { position: fixed; right: 16px; bottom: 16px; width: 400px; height: 560px; z-index: 2147483647;
      display: flex; flex-direction: column; background: #fff; color: #1f1f1f; border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,.25); overflow: hidden; }
    .panel[hidden] { display: none; }
    header { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid #eee; align-items: center; }
    select { flex: 1; min-width: 0; padding: 4px; }
    button { padding: 4px 8px; border: 1px solid #ccc; border-radius: 6px; background: #fafafa; cursor: pointer; }
    button.primary { background: #d97757; color: #fff; border-color: #d97757; }
    button:disabled { opacity: .5; cursor: default; }
    .messages { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
    .message { white-space: pre-wrap; word-break: break-word; padding: 8px 10px; border-radius: 8px; line-height: 1.5; }
    .message.user { background: #f3ede9; align-self: flex-end; max-width: 85%; }
    .message.assistant { background: #f7f7f7; }
    .message.tool { color: #777; font-size: 12px; padding: 2px 10px; font-family: ui-monospace, monospace; }
    .message.error { background: #fdecec; color: #a00; }
    .toolbar { display: flex; gap: 6px; padding: 6px 8px; border-top: 1px solid #eee; align-items: center; }
    .attachment { display: flex; gap: 6px; align-items: center; flex: 1; min-width: 0; color: #555; }
    .attachment img { height: 32px; border: 1px solid #ddd; border-radius: 4px; }
    .attachment span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .composer { display: flex; gap: 6px; padding: 8px; }
    textarea { flex: 1; resize: none; height: 60px; padding: 6px; border: 1px solid #ccc; border-radius: 6px; }
    .highlight { position: fixed; pointer-events: none; z-index: 2147483646; border: 2px solid #d97757;
      background: rgba(217,119,87,.12); }
    .region-layer { position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair; background: rgba(0,0,0,.08); }
    .region-box { position: fixed; border: 2px dashed #d97757; background: rgba(217,119,87,.12); pointer-events: none; }
  `;

  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${STYLE}</style>
    <div class="panel" hidden>
      <header>
        <select class="sessions"></select>
        <button class="refresh" title="重新整理對話清單">↻</button>
        <button class="close">✕</button>
      </header>
      <div class="messages"></div>
      <div class="toolbar">
        <button class="pick">選元素</button>
        <button class="region">框範圍</button>
        <div class="attachment"></div>
      </div>
      <div class="composer">
        <textarea placeholder="Enter 送出，Shift+Enter 換行"></textarea>
        <button class="send primary">送出</button>
      </div>
    </div>
    <div class="highlight" hidden></div>
  `;
  document.documentElement.append(host);

  const $ = (selector) => root.querySelector(selector);
  const panel = $('.panel');
  const sessionSelect = $('.sessions');
  const messageList = $('.messages');
  const attachmentView = $('.attachment');
  const textarea = $('textarea');
  const sendButton = $('.send');
  const highlight = $('.highlight');

  let currentTarget = null;
  let attachment = null;
  let chatPort = null;

  const askBackground = (message) => chrome.runtime.sendMessage(message);

  function appendMessage(role, text) {
    const element = document.createElement('div');
    element.className = `message ${role}`;
    element.textContent = text;
    messageList.append(element);
    messageList.scrollTop = messageList.scrollHeight;
    return element;
  }

  function projectName(cwd) {
    return cwd?.split('/').filter(Boolean).at(-1) ?? '~';
  }

  async function loadSessions() {
    const { data: sessions, error } = await askBackground({ type: 'server-get', path: '/sessions' });
    if (error) return appendMessage('error', error);
    const stored = await chrome.storage.local.get('target');
    const remembered = stored.target ? JSON.stringify(stored.target) : null;

    const projectFolders = [...new Set(sessions.map((session) => session.cwd).filter(Boolean))];
    const sessionOptions = sessions.map((session) => {
      const value = JSON.stringify({ sessionId: session.sessionId, cwd: session.cwd });
      const time = new Date(session.updatedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<option value="${escapeHtml(value)}">[${projectName(session.cwd)}] ${escapeHtml(session.title)} · ${time}</option>`;
    });
    const newOptions = projectFolders.map((cwd) => `<option value="${escapeHtml(JSON.stringify({ sessionId: null, cwd }))}">＋ 在 ${projectName(cwd)} 開新對話</option>`);
    sessionSelect.innerHTML = `<optgroup label="接續對話">${sessionOptions.join('')}</optgroup><optgroup label="新對話">${newOptions.join('')}</optgroup>`;

    if (remembered && [...sessionSelect.options].some((option) => option.value === remembered)) {
      sessionSelect.value = remembered;
    }
    await selectTarget(JSON.parse(sessionSelect.value));
  }

  async function selectTarget(target) {
    currentTarget = target;
    await chrome.storage.local.set({ target });
    messageList.innerHTML = '';
    if (!target.sessionId) return appendMessage('tool', `新對話，資料夾：${target.cwd}`);
    const { data: history, error } = await askBackground({ type: 'server-get', path: `/sessions/${target.sessionId}/messages` });
    if (error) return appendMessage('error', error);
    appendMessage('tool', `資料夾：${target.cwd}（只顯示最近的文字訊息）`);
    history.forEach((message) => appendMessage(message.role, message.text));
  }

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  }

  function cssSelectorFor(element) {
    const parts = [];
    for (let node = element; node && node.nodeType === 1 && parts.length < 6; node = node.parentElement) {
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const sameTagSiblings = [...(node.parentElement?.children ?? [])].filter((sibling) => sibling.tagName === node.tagName);
      const position = sameTagSiblings.length > 1 ? `:nth-of-type(${sameTagSiblings.indexOf(node) + 1})` : '';
      parts.unshift(node.tagName.toLowerCase() + position);
    }
    return parts.join(' > ');
  }

  function describeElement(element) {
    const style = getComputedStyle(element);
    const keyStyles = ['display', 'width', 'height', 'color', 'background-color', 'font-size', 'font-family', 'padding', 'margin', 'border']
      .map((property) => `${property}: ${style.getPropertyValue(property)}`)
      .join('; ');
    return [
      `page: ${location.href}`,
      `selector: ${cssSelectorFor(element)}`,
      `text: ${element.innerText?.trim().slice(0, 500) ?? ''}`,
      `computed style: ${keyStyles}`,
      `outerHTML:\n${element.outerHTML.slice(0, 4000)}`,
    ].join('\n');
  }

  async function screenshotOf(rect) {
    const panelWasVisible = !panel.hidden;
    panel.hidden = true;
    highlight.hidden = true;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const { dataUrl, error } = await askBackground({ type: 'capture-tab' });
    panel.hidden = !panelWasVisible;
    if (error) {
      appendMessage('error', `截圖失敗：${error}`);
      return null;
    }
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const scale = image.width / innerWidth;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, rect.width * scale);
    canvas.height = Math.max(1, rect.height * scale);
    canvas.getContext('2d').drawImage(image, rect.left * scale, rect.top * scale, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  function setAttachment(label, context, screenshot) {
    attachment = { context, screenshot };
    attachmentView.innerHTML = '';
    if (screenshot) attachmentView.append(Object.assign(document.createElement('img'), { src: screenshot }));
    attachmentView.append(Object.assign(document.createElement('span'), { textContent: label }));
    const clear = Object.assign(document.createElement('button'), { textContent: '移除' });
    clear.onclick = () => {
      attachment = null;
      attachmentView.innerHTML = '';
    };
    attachmentView.append(clear);
    textarea.focus();
  }

  function startElementPicker() {
    panel.hidden = true;
    let hovered = null;
    const onMove = (event) => {
      if (event.target === host) return;
      hovered = event.target;
      const rect = hovered.getBoundingClientRect();
      Object.assign(highlight.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      highlight.hidden = false;
    };
    const stop = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      highlight.hidden = true;
      panel.hidden = false;
    };
    const onClick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      stop();
      if (!hovered) return;
      const rect = hovered.getBoundingClientRect();
      const screenshot = await screenshotOf(rect);
      setAttachment(`元素：${cssSelectorFor(hovered)}`, describeElement(hovered), screenshot);
    };
    const onKey = (event) => event.key === 'Escape' && stop();
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function startRegionSelect() {
    panel.hidden = true;
    const layer = Object.assign(document.createElement('div'), { className: 'region-layer' });
    const box = Object.assign(document.createElement('div'), { className: 'region-box' });
    root.append(layer);
    let start = null;
    let rect = null;
    const finish = () => {
      layer.remove();
      box.remove();
      document.removeEventListener('keydown', onKey, true);
      panel.hidden = false;
    };
    const onKey = (event) => event.key === 'Escape' && finish();
    document.addEventListener('keydown', onKey, true);
    layer.onmousedown = (event) => {
      start = { x: event.clientX, y: event.clientY };
      root.append(box);
    };
    layer.onmousemove = (event) => {
      if (!start) return;
      rect = {
        left: Math.min(start.x, event.clientX),
        top: Math.min(start.y, event.clientY),
        width: Math.abs(event.clientX - start.x),
        height: Math.abs(event.clientY - start.y),
      };
      Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    };
    layer.onmouseup = async () => {
      finish();
      if (!rect || rect.width < 4 || rect.height < 4) return;
      const screenshot = await screenshotOf(rect);
      const context = `page: ${location.href}\nselected region (viewport px): x=${rect.left}, y=${rect.top}, ${rect.width}×${rect.height}`;
      setAttachment(`範圍 ${rect.width}×${rect.height}`, context, screenshot);
    };
  }

  function setStreaming(streaming) {
    sendButton.textContent = streaming ? '停止' : '送出';
    sessionSelect.disabled = streaming;
  }

  function stopStreaming() {
    chatPort?.disconnect();
    chatPort = null;
    setStreaming(false);
  }

  function send() {
    const text = textarea.value.trim();
    if (!text || !currentTarget) return;
    appendMessage('user', attachment ? `${text}\n📎 ${attachmentView.querySelector('span').textContent}` : text);
    const payload = { ...currentTarget, text, context: attachment?.context, screenshot: attachment?.screenshot };
    textarea.value = '';
    attachment = null;
    attachmentView.innerHTML = '';

    let replyElement = null;
    chatPort = chrome.runtime.connect({ name: 'chat' });
    setStreaming(true);
    chatPort.onMessage.addListener((event) => {
      if (event.type === 'text') {
        replyElement ??= appendMessage('assistant', '');
        replyElement.textContent += event.text;
        messageList.scrollTop = messageList.scrollHeight;
      } else if (event.type === 'tool') {
        appendMessage('tool', `⚙ ${event.text}`);
        replyElement = null;
      } else if (event.type === 'done') {
        if (event.isError) appendMessage('error', event.result ?? '執行失敗');
        if (!currentTarget.sessionId) {
          currentTarget = { sessionId: event.sessionId, cwd: currentTarget.cwd };
          chrome.storage.local.set({ target: currentTarget });
        }
      } else if (event.type === 'error') {
        appendMessage('error', event.text);
      } else if (event.type === 'closed') {
        stopStreaming();
      }
    });
    chatPort.postMessage(payload);
  }

  sendButton.onclick = () => (chatPort ? stopStreaming() : send());
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!chatPort) send();
    }
  });
  sessionSelect.onchange = () => selectTarget(JSON.parse(sessionSelect.value));
  $('.refresh').onclick = loadSessions;
  $('.close').onclick = () => (panel.hidden = true);
  $('.pick').onclick = startElementPicker;
  $('.region').onclick = startRegionSelect;

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'toggle-panel') return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !sessionSelect.options.length) loadSessions();
    if (!panel.hidden) textarea.focus();
  });
}
