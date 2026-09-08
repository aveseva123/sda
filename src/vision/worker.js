/* eslint-disable no-restricted-globals */
// Classic (non-module) dedicated worker: loads OpenCV.js via importScripts, then the ES-module
// pipeline via dynamic import(). Protocol: see docs/SPEC.md §5.8.
/* global cv, importScripts */

let pipelinePromise = null;
let loadError = null;

function waitForCv(timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = () => {
      if (typeof cv !== 'undefined' && typeof cv.Mat === 'function') {
        // Emscripten module is a thenable; make sure nobody awaits it accidentally.
        try { delete cv.then; } catch (e) { /* ignore */ }
        if (typeof cv.then === 'function') { try { cv.then = undefined; } catch (e) { /* ignore */ } }
        resolve();
        return true;
      }
      if (Date.now() - t0 > timeoutMs) { reject(new Error('OpenCV.js не загрузился за отведённое время')); return true; }
      return false;
    };
    if (typeof cv !== 'undefined' && cv && typeof cv.Mat !== 'function') {
      const prev = cv.onRuntimeInitialized;
      cv.onRuntimeInitialized = () => { if (typeof prev === 'function') { try { prev(); } catch (e) { /* ignore */ } } check(); };
    }
    if (!check()) {
      const iv = setInterval(() => { if (check()) clearInterval(iv); }, 20);
    }
  });
}

function opencvVersion() {
  try {
    const info = cv.getBuildInformation();
    const m = info.match(/OpenCV\s+([\d.]+)/);
    return m ? m[1] : 'unknown';
  } catch (e) { return 'unknown'; }
}

function getPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        importScripts('../../vendor/opencv.js');
      } catch (e) {
        throw new Error('Не удалось загрузить vendor/opencv.js: ' + (e && e.message ? e.message : e));
      }
      await waitForCv();
      const mod = await import('./pipeline.js');
      return mod.createPipeline(cv);
    })();
    pipelinePromise.catch((e) => { loadError = e; });
  }
  return pipelinePromise;
}

function toImageData(image) {
  if (image && typeof image.width === 'number' && image.data && image.data.byteLength !== undefined) {
    // ImageData or a plain {data,width,height}
    return image;
  }
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    if (typeof OffscreenCanvas === 'undefined') throw Object.assign(new Error('OffscreenCanvas недоступен в worker'), { code: 'BAD_INPUT' });
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx2d = canvas.getContext('2d', { willReadFrequently: true });
    ctx2d.drawImage(image, 0, 0);
    const data = ctx2d.getImageData(0, 0, image.width, image.height);
    try { image.close(); } catch (e) { /* ignore */ }
    return data;
  }
  throw Object.assign(new Error('Неподдерживаемый формат изображения'), { code: 'BAD_INPUT' });
}

function errorInfo(e) {
  if (typeof e === 'number' && typeof cv !== 'undefined' && cv.exceptionFromPtr) {
    try { const ex = cv.exceptionFromPtr(e); return { code: 'CV_ERROR', message: 'OpenCV: ' + ex.msg }; } catch (e2) { /* ignore */ }
  }
  return { code: (e && e.code) || 'ERROR', message: (e && e.message) || String(e) };
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const { type, id } = msg;
  try {
    if (type === 'init') {
      await getPipeline();
      self.postMessage({ type: 'ready', opencvVersion: opencvVersion(), offscreen: typeof OffscreenCanvas !== 'undefined' });
      return;
    }
    const pipeline = await getPipeline();
    if (type === 'analyze') {
      const imageData = toImageData(msg.image);
      const onProgress = (stage) => self.postMessage({ type: 'progress', id, stage });
      const result = await pipeline.analyze(imageData, msg.settings, { onProgress });
      self.postMessage({ type: 'result', id, result });
    } else if (type === 'preview') {
      const imageData = toImageData(msg.image);
      const result = await pipeline.preview(imageData, msg.settings);
      self.postMessage({ type: 'preview', id, result });
    } else if (type === 'dispose') {
      try { pipeline.dispose(); } catch (e) { /* ignore */ }
      self.postMessage({ type: 'disposed' });
    } else {
      self.postMessage({ type: 'error', id, error: { code: 'BAD_INPUT', message: 'Неизвестная команда: ' + type } });
    }
  } catch (e) {
    self.postMessage({ type: 'error', id, error: errorInfo(e) });
  }
};
