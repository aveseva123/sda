// ArUco marker detection (SPEC 5.1). Pure module: OpenCV is passed as `cv`, no DOM.
// Detector: cv.aruco_ArucoDetector with sub-pixel corner refinement; only marker ids that belong to
// the target are returned (ids of other markers are silently dropped, not counted as rejected).
import { DEFAULT_TARGET } from './target.js';
import { polygonArea } from './geometry.js';

// Convert an OpenCV.js exception (a number = pointer to a C++ exception) into an Error with a code.
export function cvError(cv, e, code = 'BAD_INPUT', message = 'Ошибка обработки изображения') {
  if (e instanceof Error) {
    if (!e.code) e.code = code;
    return e;
  }
  let detail = '';
  if (typeof e === 'number' && cv && typeof cv.exceptionFromPtr === 'function') {
    try { detail = cv.exceptionFromPtr(e).msg || ''; } catch { /* ignore */ }
  } else if (e && typeof e === 'object' && e.msg) {
    detail = String(e.msg);
  } else if (e !== undefined && e !== null) {
    detail = String(e);
  }
  const err = new Error(detail ? `${message}: ${detail}` : message);
  err.code = code;
  err.cause = e;
  return err;
}

function isMat(cv, v) {
  return !!v && typeof v === 'object' && typeof v.rows === 'number' && typeof v.cols === 'number' && typeof v.delete === 'function';
}

function isImageDataLike(v) {
  return !!v && typeof v === 'object' && v.data && typeof v.width === 'number' && typeof v.height === 'number';
}

function resolveDictionaryId(cv, dictionary) {
  if (typeof dictionary === 'number') return dictionary;
  if (typeof dictionary === 'string' && typeof cv[dictionary] === 'number') return cv[dictionary];
  return typeof cv.DICT_4X4_50 === 'number' ? cv.DICT_4X4_50 : 0;
}

// ImageData-like { data: RGBA, width, height } -> cv.Mat CV_8UC4 (caller owns the result).
export function imageDataToMat(cv, imageData) {
  if (!isImageDataLike(imageData)) {
    throw Object.assign(new Error('Нет изображения для обработки'), { code: 'BAD_INPUT' });
  }
  const { width, height, data } = imageData;
  if (!(width > 0 && height > 0) || data.length < width * height * 4) {
    throw Object.assign(new Error('Некорректный размер изображения'), { code: 'BAD_INPUT' });
  }
  try {
    return cv.matFromImageData({ data, width, height });
  } catch (e) {
    throw cvError(cv, e, 'BAD_INPUT', 'Не удалось прочитать изображение');
  }
}

// Any 8-bit (or convertible) 1/3/4-channel Mat -> new CV_8UC1 Mat. Never deletes the input.
export function toGray(cv, mat) {
  if (!isMat(cv, mat) || mat.empty()) {
    throw Object.assign(new Error('Пустое изображение'), { code: 'BAD_INPUT' });
  }
  let src = mat;
  let owned = null;
  try {
    if (mat.depth() !== cv.CV_8U) {
      owned = new cv.Mat();
      // Scale floating point [0,1] images; integer types are just saturated.
      const alpha = (mat.depth() === cv.CV_32F || mat.depth() === cv.CV_64F) ? 255 : 1;
      mat.convertTo(owned, cv.CV_8U, alpha, 0);
      src = owned;
    }
    const ch = src.channels();
    const out = new cv.Mat();
    if (ch === 1) src.copyTo(out);
    else if (ch === 3) cv.cvtColor(src, out, cv.COLOR_RGB2GRAY);
    else if (ch === 4) cv.cvtColor(src, out, cv.COLOR_RGBA2GRAY);
    else {
      out.delete();
      throw Object.assign(new Error(`Неподдерживаемое число каналов: ${ch}`), { code: 'BAD_INPUT' });
    }
    return out;
  } catch (e) {
    throw cvError(cv, e, 'BAD_INPUT', 'Не удалось преобразовать изображение');
  } finally {
    if (owned) owned.delete();
  }
}

function squareArea(corners) {
  return polygonArea(corners);
}

/**
 * createDetector(cv, { target, subpixel }) -> { detect(mat), dispose() }
 * detect(mat CV_8UC1|CV_8UC3|CV_8UC4, or ImageData-like) ->
 *   { markers: [{ id, corners: [[x,y]×4] (ArUco order TL,TR,BR,BL as printed) }], rejectedCount }
 * Markers are sorted in the order of target.ids; a duplicate id keeps the larger detection.
 */
export function createDetector(cv, { target = DEFAULT_TARGET, subpixel = true } = {}) {
  if (!cv || typeof cv.aruco_ArucoDetector !== 'function') {
    throw Object.assign(new Error('OpenCV не загружен или собран без ArUco'), { code: 'BAD_INPUT' });
  }
  const wantedIds = Array.isArray(target.ids) && target.ids.length ? target.ids.slice() : DEFAULT_TARGET.ids.slice();
  const wantedIndex = new Map(wantedIds.map((id, i) => [id, i]));
  let dictionary = null;
  let params = null;
  let refineParams = null;
  let detector = null;
  try {
    dictionary = cv.getPredefinedDictionary(resolveDictionaryId(cv, target.dictionary));
    params = new cv.aruco_DetectorParameters();
    const refineMethod = subpixel
      ? (typeof cv.CORNER_REFINE_SUBPIX === 'number' ? cv.CORNER_REFINE_SUBPIX : 1)
      : (typeof cv.CORNER_REFINE_NONE === 'number' ? cv.CORNER_REFINE_NONE : 0);
    params.cornerRefinementMethod = refineMethod;
    // aruco_RefineParameters(minRepDistance, errorCorrectionRate, checkAllOrders) — all 3 args are required.
    refineParams = new cv.aruco_RefineParameters(10, 3.0, true);
    detector = new cv.aruco_ArucoDetector(dictionary, params, refineParams);
  } catch (e) {
    for (const o of [detector, refineParams, params, dictionary]) if (o) { try { o.delete(); } catch { /* ignore */ } }
    throw cvError(cv, e, 'BAD_INPUT', 'Не удалось создать детектор меток');
  }
  let disposed = false;

  function detect(input) {
    if (disposed) throw Object.assign(new Error('Детектор уже освобождён'), { code: 'BAD_INPUT' });
    let ownedInput = null;
    let gray = null;
    let corners = null;
    let ids = null;
    let rejected = null;
    try {
      let mat = input;
      if (!isMat(cv, input)) {
        ownedInput = imageDataToMat(cv, input);
        mat = ownedInput;
      }
      gray = toGray(cv, mat);
      corners = new cv.MatVector();
      ids = new cv.Mat();
      rejected = new cv.MatVector();
      detector.detectMarkers(gray, corners, ids, rejected);
      const rejectedCount = rejected.size();
      const n = corners.size();
      const byId = new Map();
      const idData = ids.empty() ? [] : ids.data32S;
      for (let i = 0; i < n; i++) {
        const id = idData[i];
        if (!wantedIndex.has(id)) continue;
        const c = corners.get(i);
        let pts;
        try {
          const d = c.data32F;
          pts = [[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]];
        } finally {
          c.delete();
        }
        const area = squareArea(pts);
        const prev = byId.get(id);
        if (!prev || area > prev.area) byId.set(id, { id, corners: pts, area });
      }
      const markers = Array.from(byId.values())
        .sort((a, b) => wantedIndex.get(a.id) - wantedIndex.get(b.id))
        .map(({ id, corners: pts }) => ({ id, corners: pts }));
      return { markers, rejectedCount };
    } catch (e) {
      throw cvError(cv, e, 'BAD_INPUT', 'Ошибка поиска меток');
    } finally {
      if (rejected) rejected.delete();
      if (ids) ids.delete();
      if (corners) corners.delete();
      if (gray) gray.delete();
      if (ownedInput) ownedInput.delete();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const o of [detector, refineParams, params, dictionary]) {
      try { o.delete(); } catch { /* ignore */ }
    }
    detector = null; refineParams = null; params = null; dictionary = null;
  }

  return { detect, dispose, get disposed() { return disposed; } };
}
