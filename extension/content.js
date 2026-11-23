if (!window.__claudeWebBridge) {
  window.__claudeWebBridge = true;

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif; font-size: 13px; line-height: 1.4; }
    [hidden] { display: none !important; }
    .toolbar { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
      display: flex; align-items: center; gap: 4px; padding: 4px; border-radius: 999px;
      background: rgba(24,24,27,.92); color: #fafafa; box-shadow: 0 6px 24px rgba(0,0,0,.25); backdrop-filter: blur(8px); }
    .toolbar button { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border: 0; border-radius: 999px;
      background: transparent; color: inherit; cursor: pointer; }
    .toolbar button:hover { background: rgba(255,255,255,.1); }
    .toolbar button.active { background: #d97757; }
    .toolbar button.close { padding: 6px 10px; color: #a1a1aa; }
    .toolbar kbd { padding: 0 5px; border-radius: 4px; background: rgba(255,255,255,.15); font: 11px ui-monospace, monospace; }
    .toolbar .cancel-hint { padding: 0 8px; color: #a1a1aa; font-size: 12px; visibility: hidden; }
    .toolbar.selecting .cancel-hint { visibility: visible; }
    .divider { width: 1px; height: 18px; background: rgba(255,255,255,.15); }
    .highlight { position: fixed; pointer-events: none; z-index: 2147483646; border: 2px solid #d97757; border-radius: 4px;
      background: rgba(217,119,87,.10); transition: all 60ms ease-out; }
    .size-label { position: absolute; left: -2px; bottom: calc(100% + 4px); white-space: nowrap; padding: 2px 6px; border-radius: 4px;
      background: #d97757; color: #fff; font: 11px ui-monospace, monospace; }
    .highlight.near-top .size-label { bottom: auto; top: calc(100% + 4px); }
    .region-layer { position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair; background-size: 100% 100%; }
    .region-layer::after { content: ""; position: absolute; inset: 0; background: rgba(0,0,0,.35); }
    .region-layer.dragging::after { display: none; }
    .region-box { position: fixed; z-index: 2147483646; pointer-events: none; border: 2px solid #d97757; border-radius: 2px;
      box-shadow: 0 0 0 100vmax rgba(0,0,0,.35); }
    .toast { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; display: flex; align-items: center; gap: 12px;
      max-width: 360px; padding: 10px 14px 10px 10px; border-radius: 12px; background: rgba(24,24,27,.95); color: #fafafa;
      box-shadow: 0 10px 32px rgba(0,0,0,.3); animation: toast-in 180ms cubic-bezier(.2,.8,.2,1); }
    .toast img { width: 56px; height: 40px; object-fit: cover; border-radius: 6px; flex-shrink: 0; background: #fff; }
    .toast .title { font-weight: 600; }
    .toast .detail { color: #a1a1aa; font-size: 12px; }
    .toast.error { background: #7f1d1d; }
    .toast.error .detail { color: #fecaca; }
    @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } }
  `;

  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${STYLE}</style>
    <div class="toolbar" hidden>
      <button class="picker">選元素 <kbd>⌥⇧E</kbd></button>
      <button class="region">框範圍 <kbd>⌥⇧R</kbd></button>
      <span class="cancel-hint">Esc 取消</span>
      <span class="divider"></span>
      <button class="close" title="關閉工具列">✕</button>
    </div>
    <div class="highlight" hidden><span class="size-label"></span></div>
    <div class="toast" hidden></div>
  `;
  document.documentElement.append(host);

  const toolbar = root.querySelector('.toolbar');
  const pickerButton = root.querySelector('.picker');
  const regionButton = root.querySelector('.region');
  const toast = root.querySelector('.toast');
  const highlight = root.querySelector('.highlight');
  const highlightLabel = root.querySelector('.size-label');
  let toastTimer = null;
  let toolbarPinned = false;
  let cancelActiveMode = null;

  const askBackground = (message) => chrome.runtime.sendMessage(message);

  function enterMode(activeButton) {
    cancelActiveMode?.();
    pickerButton.classList.toggle('active', activeButton === pickerButton);
    regionButton.classList.toggle('active', activeButton === regionButton);
    toolbar.classList.add('selecting');
    toolbar.hidden = false;
  }

  function leaveMode() {
    cancelActiveMode = null;
    pickerButton.classList.remove('active');
    regionButton.classList.remove('active');
    toolbar.classList.remove('selecting');
    toolbar.hidden = !toolbarPinned;
  }

  function showToast({ title, detail, image, isError = false }) {
    toast.innerHTML = '';
    if (image) toast.append(Object.assign(document.createElement('img'), { src: image }));
    const text = document.createElement('div');
    text.append(Object.assign(document.createElement('div'), { className: 'title', textContent: title }));
    text.append(Object.assign(document.createElement('div'), { className: 'detail', textContent: detail }));
    toast.append(text);
    toast.classList.toggle('error', isError);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), isError ? 5000 : 3000);
  }

  function elementName(element) {
    const id = element.id ? `#${element.id}` : '';
    const firstClass = !id && element.classList[0] ? `.${element.classList[0]}` : '';
    return element.tagName.toLowerCase() + id + firstClass;
  }

  async function captureViewport() {
    const toolbarWasVisible = !toolbar.hidden;
    toast.hidden = true;
    toolbar.hidden = true;
    highlight.hidden = true;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const { dataUrl, error } = await askBackground({ type: 'capture-tab' });
    toolbar.hidden = !toolbarWasVisible;
    if (error) {
      showToast({ title: '截圖失敗', detail: error, isError: true });
      return null;
    }
    return dataUrl;
  }

  async function cropScreenshot(screenshotUrl, rect) {
    const image = new Image();
    image.src = screenshotUrl;
    await image.decode();
    const scale = image.width / innerWidth;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, rect.width * scale);
    canvas.height = Math.max(1, rect.height * scale);
    canvas.getContext('2d').drawImage(image, rect.left * scale, rect.top * scale, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  async function copyScreenshot(screenshot) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': screenshot })]);
      const preview = URL.createObjectURL(screenshot);
      showToast({ title: '截圖已複製', detail: '到 VS Code 的 Claude 輸入框按 ⌘V 貼上', image: preview });
      setTimeout(() => URL.revokeObjectURL(preview), 5000);
    } catch (error) {
      showToast({ title: '複製失敗', detail: String(error), isError: true });
    }
  }

  const POINTER_BUTTON_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'contextmenu'];

  // Swallow button events at window capture so the page never sees the selecting click:
  // otherwise teleported dropdowns and popovers close on "click outside" before they can be picked.
  // Clicks on our own toolbar pass through so modes can be switched mid-selection.
  function interceptPage({ onMove, onPointerDown, onPointerUp, onCancel }) {
    const handleButton = (event) => {
      if (event.composedPath().includes(toolbar)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'pointerdown') onPointerDown?.(event);
      if (event.type === 'pointerup') finish(() => onPointerUp(event));
    };
    const handleKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(onCancel);
    };
    function finish(callback) {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('keydown', handleKey, true);
      // The click that follows pointerup is dispatched in the same task and must be swallowed too.
      setTimeout(() => POINTER_BUTTON_EVENTS.forEach((type) => window.removeEventListener(type, handleButton, true)));
      callback();
    }
    POINTER_BUTTON_EVENTS.forEach((type) => window.addEventListener(type, handleButton, true));
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('keydown', handleKey, true);
    cancelActiveMode = () => finish(onCancel);
  }

  function startElementPicker() {
    enterMode(pickerButton);
    let hovered = null;
    const endPicking = () => {
      highlight.hidden = true;
      leaveMode();
    };
    interceptPage({
      onMove: (event) => {
        if (event.target === host) return (highlight.hidden = true);
        hovered = event.target;
        const rect = hovered.getBoundingClientRect();
        Object.assign(highlight.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        highlightLabel.textContent = `${elementName(hovered)}  ${Math.round(rect.width)}×${Math.round(rect.height)}`;
        highlight.classList.toggle('near-top', rect.top < 28);
        highlight.hidden = false;
      },
      onCancel: endPicking,
      onPointerUp: async () => {
        endPicking();
        if (!hovered) return;
        const rect = hovered.getBoundingClientRect();
        const viewportScreenshot = await captureViewport();
        if (viewportScreenshot) await copyScreenshot(await cropScreenshot(viewportScreenshot, rect));
      },
    });
  }

  // Freeze the page into a screenshot first, so popups that close once the page sees a mouse event
  // (window-capture listeners registered before ours still fire) stay in the selected image.
  async function startRegionSelect() {
    enterMode(regionButton);
    const frozenScreenshot = await captureViewport();
    if (!frozenScreenshot) return leaveMode();
    const layer = Object.assign(document.createElement('div'), { className: 'region-layer' });
    layer.style.backgroundImage = `url(${frozenScreenshot})`;
    const box = Object.assign(document.createElement('div'), { className: 'region-box' });
    const boxLabel = Object.assign(document.createElement('span'), { className: 'size-label' });
    box.append(boxLabel);
    root.append(layer);
    let start = null;
    let rect = null;
    const endSelecting = () => {
      layer.remove();
      box.remove();
      leaveMode();
    };
    interceptPage({
      onPointerDown: (event) => {
        start = { x: event.clientX, y: event.clientY };
        layer.classList.add('dragging');
        root.append(box);
      },
      onMove: (event) => {
        if (!start) return;
        rect = {
          left: Math.min(start.x, event.clientX),
          top: Math.min(start.y, event.clientY),
          width: Math.abs(event.clientX - start.x),
          height: Math.abs(event.clientY - start.y),
        };
        Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        boxLabel.textContent = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
      },
      onCancel: endSelecting,
      onPointerUp: async () => {
        endSelecting();
        if (!rect || rect.width < 4 || rect.height < 4) return;
        await copyScreenshot(await cropScreenshot(frozenScreenshot, rect));
      },
    });
  }

  function toggleToolbar() {
    cancelActiveMode?.();
    toolbarPinned = toolbar.hidden;
    toolbar.hidden = !toolbarPinned;
  }

  pickerButton.onclick = startElementPicker;
  regionButton.onclick = startRegionSelect;
  root.querySelector('.close').onclick = () => {
    cancelActiveMode?.();
    toolbarPinned = false;
    toolbar.hidden = true;
  };

  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) =>
    host.addEventListener(type, (event) => event.stopPropagation()),
  );

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'toggle-toolbar') toggleToolbar();
    if (message.type === 'start-picker') startElementPicker();
    if (message.type === 'start-region') startRegionSelect();
  });
}
