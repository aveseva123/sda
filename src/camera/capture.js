// Camera access for the shop floor: main (1x) back camera, full-resolution photo capture with fallbacks.

const EXCLUDE_RE = /ultra|wide|tele|macro|0[.,]5|front|depth|широк|фронт|селфи|selfie|virtual|obs/i;
const BACK_RE = /back|rear|environment|задн|основн|main/i;

export async function listBackCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label || '' }));
  const back = cams.filter((c) => BACK_RE.test(c.label));
  return back.length ? back : cams;
}

// Prefer the main back camera: exclude ultra-wide/tele/front by label; on Android Chrome
// ("camera2 0, facing back") the lowest index is normally the main module.
export function pickMainCamera(cameras) {
  if (!cameras || cameras.length === 0) return null;
  const withLabels = cameras.filter((c) => c.label);
  if (withLabels.length === 0) return cameras[0];
  const back = withLabels.filter((c) => BACK_RE.test(c.label));
  const pool = back.length ? back : withLabels;
  const clean = pool.filter((c) => !EXCLUDE_RE.test(c.label));
  const candidates = clean.length ? clean : pool;
  const indexOf = (label) => { const m = label.match(/camera2?\s*(\d+)/i) || label.match(/\b(\d+)\b/); return m ? Number(m[1]) : 999; };
  return candidates.slice().sort((a, b) => indexOf(a.label) - indexOf(b.label))[0];
}

function waitEvent(el, name, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(false); } }, timeoutMs);
    el.addEventListener(name, () => { if (!done) { done = true; clearTimeout(t); resolve(true); } }, { once: true });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function bitmapFromFile(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older engines: decode through <img> (EXIF orientation is applied by the browser for display in modern engines).
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await (img.decode ? img.decode() : waitEvent(img, 'load', 15000));
      return await createImageBitmap(img);
    } finally { URL.revokeObjectURL(url); }
  }
}

export async function startCamera(videoEl, { deviceId = null, previewWidth = 1920, previewHeight = 1080 } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('Камера недоступна в этом браузере'), { code: 'NO_CAMERA' });
  const video = {
    width: { ideal: previewWidth }, height: { ideal: previewHeight },
  };
  if (deviceId) video.deviceId = { exact: deviceId }; else video.facingMode = { ideal: 'environment' };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (e) {
    if (deviceId) stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    else throw Object.assign(new Error(e && e.name === 'NotAllowedError' ? 'Нет доступа к камере — разрешите доступ в настройках браузера' : 'Не удалось открыть камеру: ' + (e.message || e.name)), { code: 'NO_CAMERA', cause: e });
  }
  const track = stream.getVideoTracks()[0];
  let cameras = [];
  let isMainCameraGuess = true;
  let deviceLabel = track.label || '';
  try {
    cameras = await listBackCameras();
    const main = pickMainCamera(cameras);
    if (!deviceId && main && cameras.length > 1 && track.getSettings) {
      const cur = track.getSettings().deviceId;
      if (cur && main.deviceId && cur !== main.deviceId) {
        // Switch to the main camera
        stream.getTracks().forEach((t) => t.stop());
        return startCamera(videoEl, { deviceId: main.deviceId, previewWidth, previewHeight });
      }
    }
    isMainCameraGuess = !EXCLUDE_RE.test(deviceLabel);
  } catch { /* enumerate may fail; keep what we have */ }

  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', '');
  videoEl.muted = true;
  videoEl.autoplay = true;
  try { await videoEl.play(); } catch { /* autoplay policies: user gesture already happened */ }
  if (!videoEl.videoWidth) await waitEvent(videoEl, 'loadedmetadata', 4000);

  const capabilities = (track.getCapabilities && track.getCapabilities()) || {};
  const settings = (track.getSettings && track.getSettings()) || {};
  try {
    if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    }
  } catch { /* best effort */ }

  const grabCanvas = document.createElement('canvas');
  const grabCtx = grabCanvas.getContext('2d', { willReadFrequently: true });

  function grabFrame(maxSidePx = 640) {
    const vw = videoEl.videoWidth; const vh = videoEl.videoHeight;
    if (!vw || !vh) return null;
    const s = Math.min(1, maxSidePx / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * s)); const hgt = Math.max(1, Math.round(vh * s));
    if (grabCanvas.width !== w || grabCanvas.height !== hgt) { grabCanvas.width = w; grabCanvas.height = hgt; }
    grabCtx.drawImage(videoEl, 0, 0, w, hgt);
    return grabCtx.getImageData(0, 0, w, hgt);
  }

  async function captureViaImageCapture() {
    const ic = new ImageCapture(track);
    let opts;
    try {
      const pc = await ic.getPhotoCapabilities();
      if (pc && pc.imageWidth && pc.imageHeight) opts = { imageWidth: pc.imageWidth.max, imageHeight: pc.imageHeight.max };
    } catch { /* ignore */ }
    let blob;
    try { blob = opts ? await ic.takePhoto(opts) : await ic.takePhoto(); } catch (e) { blob = await ic.takePhoto(); }
    return { bitmap: await bitmapFromFile(blob), method: 'takePhoto', blob };
  }

  async function captureViaConstraints() {
    const before = { w: videoEl.videoWidth, h: videoEl.videoHeight };
    let switched = false;
    try {
      await track.applyConstraints({ width: { ideal: 4096 }, height: { ideal: 3072 } });
      const t0 = Date.now();
      while (Date.now() - t0 < 1200 && videoEl.videoWidth === before.w) await sleep(50);
      switched = videoEl.videoWidth !== before.w;
      await sleep(150); // let exposure settle
    } catch { /* keep preview resolution */ }
    const c = document.createElement('canvas');
    c.width = videoEl.videoWidth; c.height = videoEl.videoHeight;
    c.getContext('2d').drawImage(videoEl, 0, 0);
    const bitmap = await createImageBitmap(c);
    if (switched) { try { await track.applyConstraints({ width: { ideal: previewWidth }, height: { ideal: previewHeight } }); } catch { /* ignore */ } }
    return { bitmap, method: switched ? 'applyConstraints' : 'videoFrame', blob: null };
  }

  return {
    stream, track, capabilities, settings, cameras, deviceLabel, isMainCameraGuess,
    get videoWidth() { return videoEl.videoWidth; },
    get videoHeight() { return videoEl.videoHeight; },
    hasImageCapture: typeof ImageCapture !== 'undefined',
    hasTorch: Array.isArray(capabilities.torch) ? capabilities.torch.includes(true) : !!capabilities.torch,
    async capturePhoto() {
      if (typeof ImageCapture !== 'undefined') {
        try { return await captureViaImageCapture(); } catch (e) { console.warn('ImageCapture failed, falling back', e); }
      }
      return captureViaConstraints();
    },
    grabFrame,
    async setTorch(on) {
      try { await track.applyConstraints({ advanced: [{ torch: !!on }] }); return true; } catch { return false; }
    },
    async switchCamera(newDeviceId) {
      stream.getTracks().forEach((t) => t.stop());
      return startCamera(videoEl, { deviceId: newDeviceId, previewWidth, previewHeight });
    },
    stop() {
      try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
      try { videoEl.srcObject = null; } catch { /* ignore */ }
    },
  };
}
