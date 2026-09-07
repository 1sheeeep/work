(() => {
  if (window.__recruitmentResumeCaptureInstalled) return;
  window.__recruitmentResumeCaptureInstalled = true;
  const MAX_BYTES = 8 * 1024 * 1024;
  let armedUntil = 0;
  let captured = false;

  document.addEventListener('click', (event) => {
    const control = event.composedPath().find((node) => node instanceof HTMLElement && (() => {
      const label = String(node.innerText || node.textContent || node.getAttribute?.('aria-label') || node.title || '').replace(/\s+/g, ' ').trim();
      return /^(?:查看简历|点击预览附件简历|预览附件简历|下载|下载简历|下载附件)$/.test(label);
    })());
    if (!control) return;
    const label = String(control.innerText || control.textContent || control.getAttribute?.('aria-label') || control.title || '').replace(/\s+/g, ' ').trim();
    armedUntil = Date.now() + 60_000;
    captured = false;
    if (/下载/.test(label)) {
      window.top.postMessage({ type: 'RECRUITMENT_RESUME_DOWNLOAD_DETECTED' }, '*');
      const link = control.closest?.('a[href]') || event.composedPath().find((node) => node instanceof HTMLAnchorElement && node.href);
      const source = link?.href || control.getAttribute?.('data-url') || control.getAttribute?.('data-src');
      if (source && /^(?:blob:|https?:)/i.test(source)) void captureSource(source);
    }
  }, true);

  async function publishBlob(blob) {
    if (captured || Date.now() > armedUntil || !(blob instanceof Blob) || blob.size < 5 || blob.size > MAX_BYTES) return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    captured = true;
    armedUntil = 0;
    window.top.postMessage({ type: 'RECRUITMENT_VISIBLE_RESUME_PDF', fileBase64: btoa(binary), fileSize: bytes.length }, '*');
  }

  const originalFetch = window.fetch.bind(window);
  async function captureSource(source) {
    try {
      const response = await originalFetch(source, { credentials: 'include', signal: AbortSignal.timeout(10_000) });
      if (response.ok) await publishBlob(await response.blob());
    } catch { /* 原始下载仍继续，响应拦截器作为兜底。 */ }
  }
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (!captured && Date.now() <= armedUntil) {
      const type = String(response.headers.get('content-type') || '').toLowerCase();
      const length = Number(response.headers.get('content-length') || 0);
      if ((!length || length <= MAX_BYTES) && (type.includes('application/pdf') || type.includes('octet-stream'))) {
        void response.clone().blob().then(publishBlob).catch(() => {});
      }
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (...args) {
    this.__recruitmentCaptureCandidate = Date.now() <= armedUntil;
    return originalOpen.apply(this, args);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__recruitmentCaptureCandidate) this.addEventListener('load', () => {
      if (captured || Date.now() > armedUntil) return;
      const type = String(this.getResponseHeader('content-type') || '').toLowerCase();
      if (!type.includes('application/pdf') && !type.includes('octet-stream')) return;
      if (this.response instanceof Blob) void publishBlob(this.response).catch(() => {});
      else if (this.response instanceof ArrayBuffer) void publishBlob(new Blob([this.response], { type })).catch(() => {});
    }, { once: true });
    return originalSend.apply(this, args);
  };
})();
