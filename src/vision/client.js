// Main-thread client for the vision worker (docs/SPEC.md §5.8).

function bitmapToImageData(bitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  try { bitmap.close(); } catch { /* ignore */ }
  return data;
}

export function createVisionClient({ workerUrl = new URL('./worker.js', import.meta.url) } = {}) {
  const worker = new Worker(workerUrl); // classic worker on purpose (importScripts for OpenCV)
  const pending = new Map();
  let seq = 0;
  let offscreen = false;
  let previewPending = null; // { id, resolve }
  let previewWaiters = [];   // resolvers of preview() calls made while one is pending
  let readyResolve; let readyReject;
  const ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
  let isReady = false;
  const listeners = new Set();

  worker.onmessage = (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'ready') {
      offscreen = !!msg.offscreen;
      isReady = true;
      readyResolve({ opencvVersion: msg.opencvVersion, offscreen });
      return;
    }
    if (msg.type === 'progress') {
      const p = pending.get(msg.id);
      if (p && p.onProgress) { try { p.onProgress(msg.stage); } catch { /* ignore */ } }
      for (const l of listeners) { try { l(msg); } catch { /* ignore */ } }
      return;
    }
    if (msg.type === 'preview') {
      if (previewPending && previewPending.id === msg.id) {
        const { resolve } = previewPending;
        previewPending = null;
        resolve(msg.result);
        const waiters = previewWaiters; previewWaiters = [];
        waiters.forEach((w) => w(msg.result));
      }
      return;
    }
    const p = pending.get(msg.id);
    if (!p) {
      if (msg.type === 'error' && previewPending && previewPending.id === msg.id) {
        previewPending.resolve(null);
        previewPending = null;
        const waiters = previewWaiters; previewWaiters = [];
        waiters.forEach((w) => w(null));
      }
      return;
    }
    pending.delete(msg.id);
    if (msg.type === 'result') p.resolve(msg.result);
    else if (msg.type === 'error') p.reject(Object.assign(new Error(msg.error?.message || 'Ошибка обработки'), { code: msg.error?.code || 'ERROR' }));
  };
  worker.onerror = (ev) => {
    const err = new Error('Ошибка worker: ' + (ev.message || 'неизвестно'));
    if (!isReady) readyReject(err);
    for (const [, p] of pending) p.reject(err);
    pending.clear();
    if (previewPending) { previewPending.resolve(null); previewPending = null; }
    console.error('vision worker error', ev);
  };
  worker.postMessage({ type: 'init' });

  function prepareImage(image) {
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
      if (offscreen) return { payload: image, transfer: [image] };
      const data = bitmapToImageData(image);
      return { payload: data, transfer: [data.data.buffer] };
    }
    if (image && image.data && image.data.buffer) {
      // ImageData: copy so the caller keeps its buffer usable
      const copy = new Uint8ClampedArray(image.data);
      return { payload: { data: copy, width: image.width, height: image.height }, transfer: [copy.buffer] };
    }
    throw Object.assign(new Error('Неподдерживаемый формат изображения'), { code: 'BAD_INPUT' });
  }

  return {
    ready,
    get busy() { return pending.size > 0; },
    get isReady() { return isReady; },
    onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async analyze(image, settings, { onProgress = null } = {}) {
      await ready;
      const id = ++seq;
      const { payload, transfer } = prepareImage(image);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress });
        worker.postMessage({ type: 'analyze', id, image: payload, settings }, transfer);
      });
    },
    // Preview drops frames: while one preview is in flight, new calls wait for that result.
    async preview(imageData, settings) {
      if (!isReady) return null;
      if (previewPending) return new Promise((resolve) => previewWaiters.push(resolve));
      const id = ++seq;
      const { payload, transfer } = prepareImage(imageData);
      return new Promise((resolve) => {
        previewPending = { id, resolve };
        worker.postMessage({ type: 'preview', id, image: payload, settings }, transfer);
      });
    },
    terminate() {
      worker.terminate();
      for (const [, p] of pending) p.reject(new Error('Worker остановлен'));
      pending.clear();
    },
  };
}
