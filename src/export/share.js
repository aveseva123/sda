// Save-or-share for exported files (SPEC section 9). Needs the DOM at call time only; nothing runs
// at module top level so the module is importable in Node.

// File names safe for Android/iOS/Windows downloads.
export function sanitizeFileName(name, fallback = 'file') {
  let s = String(name === undefined || name === null ? '' : name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (s.length > 120) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 8 ? s.slice(dot) : '';
    s = s.slice(0, 120 - ext.length) + ext;
  }
  return s || fallback;
}

export function canShareFiles(file) {
  try {
    if (typeof navigator === 'undefined' || !navigator) return false;
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    return !!navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

// Classic <a download> flow; the object URL is revoked after the click has been dispatched.
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { a.remove(); } catch { /* ignore */ }
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }, 2000);
}

/**
 * Share the blob through the OS share sheet when the browser can share files, otherwise trigger a
 * download. Returns 'share' | 'download' | 'cancelled' (user dismissed the share sheet).
 * Share failures other than a user cancel fall back to the download path.
 */
export async function saveOrShare(blob, fileName, { title = null, text = null } = {}) {
  if (!blob) throw Object.assign(new Error('Нет данных для сохранения'), { code: 'BAD_INPUT' });
  const name = sanitizeFileName(fileName, 'export');
  let file = null;
  try {
    if (typeof File !== 'undefined') file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  } catch { file = null; }
  if (file && canShareFiles(file)) {
    try {
      const payload = { files: [file], title: title || name };
      if (text) payload.text = text;
      await navigator.share(payload);
      return 'share';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // NotAllowedError (no user gesture), TypeError etc.: fall back to a download.
    }
  }
  downloadBlob(blob, name);
  return 'download';
}
