// IndexedDB storage (SPEC section 7): settings, orders, measurements, remnants, backup export/import.
// Browser-only at runtime, but importable anywhere: nothing touches indexedDB/window at module top
// level, and the only browser APIs used are Blob, FileReader (with an arrayBuffer fallback), atob/btoa
// and crypto — all available in workers too, so the module can be imported from a worker later.
import { DEFAULT_SETTINGS, mergeSettings } from '../settings.js';

export const DB_NAME = 'sda-measure';
export const DB_VERSION = 1;
export const EXPORT_VERSION = 1;

const SETTINGS_KEY = 'app';
const STORES = ['settings', 'orders', 'measurements', 'remnants'];

let dbPromise = null;

// ---------------------------------------------------------------------------------------------
// Errors

function dbError(message, code = 'DB', cause = null) {
  const e = new Error(message);
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

const IDB_MESSAGES = {
  QuotaExceededError: 'Недостаточно места в хранилище браузера — удалите старые замеры или фото',
  VersionError: 'База данных создана более новой версией приложения',
  InvalidStateError: 'Хранилище браузера недоступно (приватный режим?)',
  UnknownError: 'Внутренняя ошибка хранилища браузера',
  AbortError: 'Операция с базой данных прервана',
  ConstraintError: 'Запись с таким ключом уже существует',
  DataCloneError: 'Данные не удалось сохранить: неподдерживаемый тип значения',
};

function idbError(err, fallback = 'Ошибка базы данных') {
  if (err && err.code && typeof err.code === 'string' && !(err.name in IDB_MESSAGES)) return err;
  const name = err && err.name;
  const e = dbError(IDB_MESSAGES[name] || fallback, 'DB', err || null);
  if (name) e.idbName = name;
  return e;
}

// ---------------------------------------------------------------------------------------------
// Small promise helpers around IDBRequest / IDBTransaction

function request(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(idbError(r.error));
  });
}

function complete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(idbError(tx.error));
    tx.onabort = () => reject(idbError(tx.error, 'Транзакция базы данных прервана'));
  });
}

// ---------------------------------------------------------------------------------------------
// Ids and timestamps

export function uid() {
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && typeof c.randomUUID === 'function') {
    try { return c.randomUUID(); } catch { /* insecure context: fall through */ }
  }
  let rnd = '';
  if (c && typeof c.getRandomValues === 'function') {
    const a = new Uint8Array(8);
    c.getRandomValues(a);
    rnd = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  } else {
    rnd = Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
  }
  return `${Date.now().toString(36)}-${rnd}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function formatRemnantId(n) {
  return `R-${String(Math.max(1, Math.floor(n))).padStart(3, '0')}`;
}

export function parseRemnantId(id) {
  const m = /^R-(\d+)$/i.exec(String(id || '').trim());
  return m ? parseInt(m[1], 10) : null;
}

function byCreatedAtDesc(a, b) {
  const ca = String(a.createdAt || ''); const cb = String(b.createdAt || '');
  if (ca !== cb) return ca < cb ? 1 : -1;
  const ia = String(a.id || ''); const ib = String(b.id || '');
  return ia < ib ? 1 : ia > ib ? -1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Blob <-> data URL (used by exportAll/importAll). Pure enough to run in Node 22 as well.

function isBlob(v) {
  return typeof Blob !== 'undefined' && v instanceof Blob;
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function bytesToBase64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + CHUNK)));
  }
  return btoa(s);
}

function base64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function blobToDataUrl(blob) {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(idbError(fr.error, 'Не удалось прочитать файл'));
      fr.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

export function dataUrlToBlob(dataUrl, typeHint = '') {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  if (!s.startsWith('data:') || comma < 0) throw dbError('Некорректный data URL', 'BAD_INPUT');
  const header = s.slice(5, comma).split(';');
  const payload = s.slice(comma + 1);
  const isBase64 = header.some((p) => p.trim().toLowerCase() === 'base64');
  const type = (header[0] || '').trim() || typeHint || '';
  const bytes = isBase64 ? base64ToBytes(payload) : new TextEncoder().encode(decodeURIComponent(payload));
  return new Blob([bytes], { type });
}

function collectBlobs(value, out) {
  if (isBlob(value)) { out.add(value); return; }
  if (Array.isArray(value)) { for (const v of value) collectBlobs(v, out); return; }
  if (isPlainObject(value)) { for (const k of Object.keys(value)) collectBlobs(value[k], out); }
}

function replaceBlobs(value, map) {
  if (isBlob(value)) return map.get(value);
  if (Array.isArray(value)) return value.map((v) => replaceBlobs(v, map));
  if (isPlainObject(value)) {
    const out = {};
    for (const k of Object.keys(value)) out[k] = replaceBlobs(value[k], map);
    return out;
  }
  return value;
}

// Deep copy of `value` with every Blob replaced by { __blob: true, type, dataUrl }.
export async function serializeBlobs(value) {
  const blobs = new Set();
  collectBlobs(value, blobs);
  const map = new Map();
  for (const b of blobs) {
    map.set(b, { __blob: true, type: b.type || '', size: b.size, dataUrl: await blobToDataUrl(b) });
  }
  return replaceBlobs(value, map);
}

function isBlobPlaceholder(v) {
  return isPlainObject(v) && v.__blob === true && typeof v.dataUrl === 'string';
}

// Deep copy of `value` with every { __blob: true, dataUrl } placeholder turned back into a Blob.
export function restoreBlobs(value) {
  if (isBlobPlaceholder(value)) return dataUrlToBlob(value.dataUrl, value.type || '');
  if (Array.isArray(value)) return value.map(restoreBlobs);
  if (isPlainObject(value)) {
    const out = {};
    for (const k of Object.keys(value)) out[k] = restoreBlobs(value[k]);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Schema

function upgradeSchema(idb) {
  const names = idb.objectStoreNames;
  if (!names.contains('settings')) idb.createObjectStore('settings', { keyPath: 'key' });
  if (!names.contains('orders')) {
    const s = idb.createObjectStore('orders', { keyPath: 'id' });
    s.createIndex('createdAt', 'createdAt', { unique: false });
  }
  if (!names.contains('measurements')) {
    const s = idb.createObjectStore('measurements', { keyPath: 'id' });
    s.createIndex('orderId', 'orderId', { unique: false });
    s.createIndex('createdAt', 'createdAt', { unique: false });
  }
  if (!names.contains('remnants')) {
    const s = idb.createObjectStore('remnants', { keyPath: 'id' });
    s.createIndex('status', 'status', { unique: false });
    s.createIndex('createdAt', 'createdAt', { unique: false });
  }
}

function openRaw() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(dbError('IndexedDB недоступна в этом окружении', 'DB'));
      return;
    }
    let r;
    try { r = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(idbError(e, 'Не удалось открыть базу данных')); return; }
    r.onupgradeneeded = () => { try { upgradeSchema(r.result); } catch (e) { reject(idbError(e, 'Не удалось создать базу данных')); } };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(idbError(r.error, 'Не удалось открыть базу данных'));
    r.onblocked = () => { /* an older connection in another tab; the request completes once it closes */ };
  });
}

// ---------------------------------------------------------------------------------------------
// Record normalisation (fills missing ids/timestamps in place so callers keep a usable object)

function normalizeOrder(o) {
  if (!isPlainObject(o)) throw dbError('Некорректный заказ', 'BAD_INPUT');
  if (!o.id) o.id = uid();
  if (!o.createdAt) o.createdAt = nowIso();
  if (!Array.isArray(o.parts)) o.parts = [];
  if (!o.source) o.source = { type: 'manual', fileName: '' };
  return o;
}

function normalizeMeasurement(m) {
  if (!isPlainObject(m)) throw dbError('Некорректный замер', 'BAD_INPUT');
  if (!m.id) m.id = uid();
  if (!m.createdAt) m.createdAt = nowIso();
  if (m.orderId === undefined) m.orderId = null;
  if (!m.mode) m.mode = 'batch';
  if (!isPlainObject(m.overrides)) m.overrides = {};
  if (m.match === undefined) m.match = null;
  if (m.photo === undefined) m.photo = null;
  return m;
}

function normalizeRemnant(r, idFactory) {
  if (!isPlainObject(r)) throw dbError('Некорректный остаток', 'BAD_INPUT');
  if (!r.id) r.id = idFactory ? idFactory() : uid();
  if (!r.createdAt) r.createdAt = nowIso();
  if (!r.status) r.status = 'available';
  if (r.photo === undefined) r.photo = null;
  if (r.measurementId === undefined) r.measurementId = null;
  if (r.usedFor === undefined) r.usedFor = null;
  if (r.note === undefined) r.note = '';
  return r;
}

// ---------------------------------------------------------------------------------------------
// Db API

function createApi(idb) {
  async function withTx(names, mode, fn) {
    const tx = idb.transaction(names, mode);
    const done = complete(tx);
    done.catch(() => { /* surfaced by the await below */ });
    let result;
    try {
      result = await fn(tx);
    } catch (e) {
      try { tx.abort(); } catch { /* already finished */ }
      throw e;
    }
    await done;
    return result;
  }

  const getAll = (name, indexName = null, query = null) => withTx(name, 'readonly', (tx) => {
    const store = tx.objectStore(name);
    return request((indexName ? store.index(indexName) : store).getAll(query === null ? undefined : query));
  });
  const getOne = (name, key) => withTx(name, 'readonly', (tx) => request(tx.objectStore(name).get(key)));
  const putOne = (name, value) => withTx(name, 'readwrite', (tx) => request(tx.objectStore(name).put(value)));
  const delOne = (name, key) => withTx(name, 'readwrite', (tx) => request(tx.objectStore(name).delete(key)));

  async function getStoredSettings() {
    const rec = await getOne('settings', SETTINGS_KEY);
    return rec && isPlainObject(rec.value) ? rec.value : {};
  }

  async function maxRemnantNumber() {
    const keys = await withTx('remnants', 'readonly', (tx) => request(tx.objectStore('remnants').getAllKeys()));
    let max = 0;
    for (const k of keys) { const n = parseRemnantId(k); if (n !== null && n > max) max = n; }
    return max;
  }

  const api = {
    get raw() { return idb; },

    // --- settings ---
    async getSettings() {
      return mergeSettings(DEFAULT_SETTINGS, await getStoredSettings());
    },
    async saveSettings(patch) {
      const stored = mergeSettings(await getStoredSettings(), patch || {});
      await putOne('settings', { key: SETTINGS_KEY, value: stored });
      return mergeSettings(DEFAULT_SETTINGS, stored);
    },

    // --- orders ---
    async listOrders() {
      const rows = await getAll('orders');
      return rows.sort(byCreatedAtDesc);
    },
    async getOrder(id) {
      if (id === undefined || id === null) return null;
      return (await getOne('orders', id)) || null;
    },
    async putOrder(order) {
      const o = normalizeOrder(order);
      await putOne('orders', o);
      return o.id;
    },
    async deleteOrder(id) {
      await delOne('orders', id);
    },

    // --- measurements ---
    async putMeasurement(m) {
      const rec = normalizeMeasurement(m);
      await putOne('measurements', rec);
      return rec.id;
    },
    async listMeasurements({ orderId, mode, limit } = {}) {
      let rows;
      if (typeof orderId === 'string' && orderId) {
        rows = await getAll('measurements', 'orderId', IDBKeyRange.only(orderId));
      } else {
        rows = await getAll('measurements');
        if (orderId === null) rows = rows.filter((r) => r.orderId === null || r.orderId === undefined);
      }
      if (mode) rows = rows.filter((r) => r.mode === mode);
      rows.sort(byCreatedAtDesc);
      if (Number.isFinite(limit) && limit > 0 && rows.length > limit) rows = rows.slice(0, limit);
      return rows;
    },
    async getMeasurement(id) {
      if (id === undefined || id === null) return null;
      return (await getOne('measurements', id)) || null;
    },
    async deleteMeasurement(id) {
      await delOne('measurements', id);
    },

    // --- remnants ---
    async listRemnants({ status } = {}) {
      const rows = status ? await getAll('remnants', 'status', IDBKeyRange.only(status)) : await getAll('remnants');
      return rows.sort(byCreatedAtDesc);
    },
    async getRemnant(id) {
      if (id === undefined || id === null) return null;
      return (await getOne('remnants', id)) || null;
    },
    async putRemnant(r) {
      let rec = r;
      if (!isPlainObject(rec)) throw dbError('Некорректный остаток', 'BAD_INPUT');
      if (!rec.id) rec.id = await api.nextRemnantId();
      rec = normalizeRemnant(rec);
      await putOne('remnants', rec);
      return rec.id;
    },
    async deleteRemnant(id) {
      await delOne('remnants', id);
    },
    async nextRemnantId() {
      return formatRemnantId((await maxRemnantNumber()) + 1);
    },

    // --- backup ---
    async exportAll() {
      const [settingsRec, orders, measurements, remnants] = await withTx(STORES, 'readonly', (tx) => Promise.all([
        request(tx.objectStore('settings').get(SETTINGS_KEY)),
        request(tx.objectStore('orders').getAll()),
        request(tx.objectStore('measurements').getAll()),
        request(tx.objectStore('remnants').getAll()),
      ]));
      const stored = settingsRec && isPlainObject(settingsRec.value) ? settingsRec.value : {};
      const payload = {
        version: EXPORT_VERSION,
        exportedAt: nowIso(),
        settings: mergeSettings(DEFAULT_SETTINGS, stored),
        orders: orders.sort(byCreatedAtDesc),
        measurements: measurements.sort(byCreatedAtDesc),
        remnants: remnants.sort(byCreatedAtDesc),
      };
      return serializeBlobs(payload);
    },
    async importAll(obj, { merge = true } = {}) {
      if (!isPlainObject(obj)) throw dbError('Файл резервной копии не распознан', 'BAD_INPUT');
      const version = Number(obj.version);
      if (version !== EXPORT_VERSION) {
        throw dbError(`Неподдерживаемая версия файла резервной копии: ${obj.version === undefined ? 'нет' : obj.version} (ожидается ${EXPORT_VERSION})`, 'BAD_INPUT');
      }
      const data = restoreBlobs(obj);
      const orders = (Array.isArray(data.orders) ? data.orders : []).filter(isPlainObject).map(normalizeOrder);
      const measurements = (Array.isArray(data.measurements) ? data.measurements : []).filter(isPlainObject).map(normalizeMeasurement);
      let counter = merge ? await maxRemnantNumber() : 0;
      const remnants = (Array.isArray(data.remnants) ? data.remnants : []).filter(isPlainObject);
      // Pre-assign ids for remnants that lack one so they do not collide with each other.
      const used = new Set(remnants.map((r) => r.id).filter(Boolean));
      for (const r of remnants) {
        if (r.id) continue;
        let id;
        do { counter += 1; id = formatRemnantId(counter); } while (used.has(id));
        used.add(id);
        r.id = id;
      }
      remnants.forEach((r) => normalizeRemnant(r));
      const settingsPatch = isPlainObject(data.settings) ? data.settings : null;

      await withTx(STORES, 'readwrite', (tx) => {
        if (!merge) for (const name of STORES) tx.objectStore(name).clear();
        const sStore = tx.objectStore('settings');
        if (settingsPatch) {
          if (merge) {
            const g = sStore.get(SETTINGS_KEY);
            g.onsuccess = () => {
              const cur = g.result && isPlainObject(g.result.value) ? g.result.value : {};
              sStore.put({ key: SETTINGS_KEY, value: mergeSettings(cur, settingsPatch) });
            };
          } else {
            sStore.put({ key: SETTINGS_KEY, value: mergeSettings({}, settingsPatch) });
          }
        }
        const oStore = tx.objectStore('orders');
        for (const o of orders) oStore.put(o);
        const mStore = tx.objectStore('measurements');
        for (const m of measurements) mStore.put(m);
        const rStore = tx.objectStore('remnants');
        for (const r of remnants) rStore.put(r);
      });
      return { orders: orders.length, measurements: measurements.length, remnants: remnants.length };
    },
    async clearAll() {
      await withTx(STORES, 'readwrite', (tx) => { for (const name of STORES) tx.objectStore(name).clear(); });
    },
    close() {
      try { idb.close(); } catch { /* ignore */ }
      if (dbPromise) dbPromise = null;
    },
  };
  return api;
}

// Singleton: repeated calls share one connection; a failed open can be retried.
export function openDb() {
  if (!dbPromise) {
    dbPromise = openRaw().then((idb) => {
      idb.onversionchange = () => { try { idb.close(); } catch { /* ignore */ } dbPromise = null; };
      idb.onclose = () => { dbPromise = null; };
      return createApi(idb);
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

export async function closeDb() {
  if (!dbPromise) return;
  const p = dbPromise;
  dbPromise = null;
  try { (await p).close(); } catch { /* ignore */ }
}

// Removes the whole database (used by the settings screen "стереть всё" and by tests).
export function deleteDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) { reject(dbError('IndexedDB недоступна в этом окружении', 'DB')); return; }
    closeDb().then(() => {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(idbError(r.error, 'Не удалось удалить базу данных'));
      r.onblocked = () => { /* completes once other tabs close their connections */ };
    });
  });
}
