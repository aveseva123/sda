// Loads vendor/opencv.js (UMD, embedded wasm) in Node and resolves once the runtime is initialised.
// NOTE: the Emscripten module object carries a `then` method; resolving a Promise with it would
// recurse forever (thenable assimilation), so `then` is removed before the module is handed out.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let cvPromise = null;

export function stripThenable(cv) {
  if (cv && typeof cv.then === 'function') {
    try { delete cv.then; } catch { /* ignore */ }
    if (typeof cv.then === 'function') { try { cv.then = undefined; } catch { /* ignore */ } }
  }
  return cv;
}

export function loadCv({ timeoutMs = 90000 } = {}) {
  if (!cvPromise) {
    cvPromise = new Promise((resolve, reject) => {
      const cv = require('../../vendor/opencv.js');
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (typeof cv.Mat === 'function') { clearInterval(iv); resolve(stripThenable(cv)); }
        else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error('OpenCV.js init timeout')); }
      }, 20);
    });
  }
  return cvPromise;
}
