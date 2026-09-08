(() => {
  if (window.__recruitmentResumeCaptureInstalled) return;
  window.__recruitmentResumeCaptureInstalled = true;
  const MAX_BYTES = 8 * 1024 * 1024;
  let armedUntil = 0;
  let captured = false;

  const isIframe = window.self !== window.top;
  const originalFetch = window.fetch.bind(window);

  function reportStatus(state) {
    try { window.top.postMessage({ type: 'RECRUITMENT_RESUME_CAPTURE_STATUS', state, ts: Date.now() }, '*'); } catch {}
  }

  function arm(until = Date.now() + 60_000) {
    armedUntil = until;
    captured = false;
  }

  function broadcastArmToIframes() {
    const msg = { type: 'RECRUITMENT_ARM_RESUME_CAPTURE', armedUntil };
    const frames = [...document.querySelectorAll('iframe')];
    reportStatus('顶层：已向 ' + frames.length + ' 个已有 iframe 广播 armed 状态');
    frames.forEach((iframe) => {
      try { iframe.contentWindow?.postMessage(msg, '*'); } catch {}
    });
  }

  if (!isIframe) {
    reportStatus('顶层：page-resume-capture 已加载');
    let iframeObserver = null;
    document.addEventListener('click', (event) => {
      const control = event.composedPath().find((node) => node instanceof HTMLElement && (() => {
        const label = String(node.innerText || node.textContent || node.getAttribute?.('aria-label') || node.title || '').replace(/\s+/g, ' ').trim();
        return /^(?:查看简历|点击预览附件简历|预览附件简历|下载|下载简历|下载附件)$/.test(label);
      })());
      if (!control) return;
      const label = String(control.innerText || control.textContent || control.getAttribute?.('aria-label') || control.title || '').replace(/\s+/g, ' ').trim();
      reportStatus('顶层：检测到点击「' + label + '」，60s 内拦截 PDF 下载');
      arm(Date.now() + 60_000);
      broadcastArmToIframes();
      if (!iframeObserver) {
        iframeObserver = new MutationObserver((mutations) => {
          if (captured || Date.now() > armedUntil) return;
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (!(node instanceof HTMLElement)) continue;
              if (node.tagName === 'IFRAME') {
                reportStatus('顶层：MutationObserver 检测到新 iframe，发送 armed 消息');
                try { node.contentWindow?.postMessage({ type: 'RECRUITMENT_ARM_RESUME_CAPTURE', armedUntil }, '*'); } catch {}
              }
              if (node.querySelectorAll) {
                const innerFrames = [...node.querySelectorAll('iframe')];
                if (innerFrames.length) {
                  reportStatus('顶层：MutationObserver 检测到 ' + innerFrames.length + ' 个嵌套 iframe');
                  innerFrames.forEach((iframe) => {
                    try { iframe.contentWindow?.postMessage({ type: 'RECRUITMENT_ARM_RESUME_CAPTURE', armedUntil }, '*'); } catch {}
                  });
                }
              }
            }
          }
        });
        iframeObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
      if (/下载/.test(label)) {
        reportStatus('顶层：检测到下载按钮，尝试直接捕获');
        window.top.postMessage({ type: 'RECRUITMENT_RESUME_DOWNLOAD_DETECTED' }, '*');
        const link = control.closest?.('a[href]') || event.composedPath().find((node) => node instanceof HTMLAnchorElement && node.href);
        const source = link?.href || control.getAttribute?.('data-url') || control.getAttribute?.('data-src');
        if (source && /^(?:blob:|https?:)/i.test(source)) void captureSource(source);
      }
    }, true);
  } else {
    const iframeSrc = document.location?.href || '';
    const isPdfViewer = /pdf-viewer|preview4boss|download.*resume|resume.*download/i.test(iframeSrc);
    reportStatus('iframe：page-resume-capture 已加载，URL: ' + iframeSrc.slice(0, 120) + (isPdfViewer ? ' [PDF查看器]' : ''));
    if (isPdfViewer) {
      reportStatus('iframe：检测到 PDF 查看器，立即武装（不等 postMessage）');
      arm(Date.now() + 60_000);
      tryExtractPdfFromViewer();
    }
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'RECRUITMENT_ARM_RESUME_CAPTURE') {
        if (!isPdfViewer) {
          reportStatus('iframe：收到 armed 消息，开始尝试捕获 PDF');
          arm(event.data.armedUntil || Date.now() + 60_000);
        }
        tryCaptureIframePdf();
        setTimeout(tryCaptureIframePdf, 600);
        setTimeout(tryCaptureIframePdf, 1800);
      }
    });
    let iframeUrlChecked = '';
    async function tryCaptureIframePdf() {
      if (captured) return;
      if (Date.now() > armedUntil) { reportStatus('iframe：armed 已过期，放弃捕获'); return; }
      const src = document.location?.href || '';
      if (src === iframeUrlChecked) return;
      iframeUrlChecked = src;
      const isBlob = /^blob:/.test(src);
      const isPdfContent = document.contentType === 'application/pdf';
      reportStatus('iframe：检查 URL ' + (isBlob ? '是 blob URL' : isPdfContent ? '是 PDF content' : '不是 blob/PDF: ' + src.slice(0, 80)));
      if (isBlob || isPdfContent) {
        try {
          reportStatus('iframe：开始 fetch ' + (src || '当前 URL').slice(0, 80));
          const response = await originalFetch(src || document.location.href);
          reportStatus('iframe：fetch 完成，status=' + response.status + ', content-type=' + (response.headers.get('content-type') || '?'));
          if (response.ok) {
            const blob = await response.blob();
            reportStatus('iframe：blob 大小=' + blob.size + ' bytes');
            await publishBlob(blob);
          } else {
            reportStatus('iframe：fetch 失败，HTTP ' + response.status);
          }
        } catch (err) {
          reportStatus('iframe：fetch 异常: ' + (err?.message || String(err)).slice(0, 100));
        }
      }
    }
    async function tryExtractPdfFromViewer() {
      try {
        const viewerUrl = new URL(iframeSrc, location.href);
        const pdfPath = viewerUrl.searchParams.get('url') || viewerUrl.searchParams.get('file') || viewerUrl.searchParams.get('src');
        if (!pdfPath) { reportStatus('iframe：PDF 查看器未找到 url/file/src 参数'); return; }
        const pdfUrl = decodeURIComponent(pdfPath);
        reportStatus('iframe：提取到 PDF 路径: ' + pdfUrl.slice(0, 80));
        const fullUrl = pdfUrl.startsWith('http') ? pdfUrl : new URL(pdfUrl, location.origin).href;
        reportStatus('iframe：开始 fetch PDF: ' + fullUrl.slice(0, 100));
        const response = await originalFetch(fullUrl, { credentials: 'include' });
        reportStatus('iframe：PDF fetch 完成，status=' + response.status + ', content-type=' + (response.headers.get('content-type') || '?'));
        if (response.ok) {
          const blob = await response.blob();
          reportStatus('iframe：PDF blob 大小=' + blob.size + ' bytes');
          await publishBlob(blob);
        } else {
          reportStatus('iframe：PDF fetch 失败，HTTP ' + response.status);
        }
      } catch (err) {
        reportStatus('iframe：PDF 查看器提取异常: ' + (err?.message || String(err)).slice(0, 100));
      }
    }
    new MutationObserver(() => {
      if (captured || Date.now() > armedUntil) return;
      tryCaptureIframePdf();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  async function publishBlob(blob) {
    if (captured || Date.now() > armedUntil || !(blob instanceof Blob) || blob.size < 5 || blob.size > MAX_BYTES) {
      reportStatus('publishBlob：跳过（captured=' + captured + ', size=' + (blob?.size || '?') + '）');
      return;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
      reportStatus('publishBlob：PDF 头验证失败，前5字节: ' + String.fromCharCode(...bytes.slice(0, 5)));
      return;
    }
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    captured = true;
    armedUntil = 0;
    reportStatus('publishBlob：PDF 验证通过，大小=' + bytes.length + ' bytes，发送至 content script');
    window.top.postMessage({ type: 'RECRUITMENT_VISIBLE_RESUME_PDF', fileBase64: btoa(binary), fileSize: bytes.length }, '*');
  }

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