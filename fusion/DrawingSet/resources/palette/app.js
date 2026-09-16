/* DrawingSet palette: settings form, sheet viewer, bridge to the Python add-in. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { schema: [], settings: {}, sheets: [], current: -1, zoom: 1, pan: { x: 20, y: 20 }, busy: false,
                  warnings: 0, outDir: '' };
  const PX_PER_MM = 3;

  // ---------------------------------------------------------------- bridge
  function send(action, payload) {
    const data = JSON.stringify(payload || {});
    if (window.adsk && typeof window.adsk.fusionSendData === 'function') {
      try {
        const r = window.adsk.fusionSendData(action, data);
        return Promise.resolve(r);
      } catch (e) {
        log('err', 'Ошибка связи с Fusion: ' + e);
        return Promise.reject(e);
      }
    }
    log('warn', 'Нет моста с Fusion (страница открыта вне палитры): ' + action);
    return Promise.resolve('');
  }

  window.fusionJavaScriptHandler = {
    handle: function (action, data) {
      try {
        let payload = {};
        try { payload = data ? JSON.parse(data) : {}; } catch (e) { payload = { raw: data }; }
        switch (action) {
          case 'init': onInit(payload); break;
          case 'status': setStatus(payload.text || '', payload.level || ''); break;
          case 'progress': setProgress(payload.value, payload.message); break;
          case 'log': log(payload.level || 'info', payload.message || ''); break;
          case 'sheets': onSheets(payload); break;
          case 'done': onDone(payload); break;
          case 'error': onError(payload); break;
          case 'folder': if (payload.path) { setField('out_dir', payload.path); } break;
          case 'response': break;
          default: log('warn', 'Неизвестное действие от Fusion: ' + action);
        }
      } catch (e) {
        log('err', 'Ошибка в палитре: ' + (e && e.stack ? e.stack : e));
      }
      return 'OK';
    }
  };

  // ---------------------------------------------------------------- settings form
  function onInit(p) {
    state.schema = p.schema || [];
    state.settings = p.settings || {};
    state.outDir = state.settings.out_dir || '';
    $('version').textContent = p.version ? '· Fusion ' + p.version : '';
    buildForm();
    setStatus(p.status || 'Готово. Откройте модель и нажмите «Сгенерировать».', 'ok');
    $('btn-generate').disabled = false;
    $('btn-folder').disabled = false;
    if (p.caps_text) { log('info', p.caps_text); }
  }

  function buildForm() {
    const tabs = $('tabs'); const form = $('settings');
    tabs.innerHTML = ''; form.innerHTML = '';
    state.schema.forEach((tab, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = tab.title;
      b.className = i === 0 ? 'active' : '';
      b.onclick = () => selectTab(i);
      tabs.appendChild(b);
      const div = document.createElement('div'); div.className = 'tab' + (i === 0 ? ' active' : ''); div.dataset.tab = i;
      tab.fields.forEach((f) => div.appendChild(fieldElement(f)));
      form.appendChild(div);
    });
  }

  function selectTab(i) {
    [...$('tabs').children].forEach((b, k) => b.classList.toggle('active', k === i));
    [...$('settings').children].forEach((d, k) => d.classList.toggle('active', k === i));
  }

  function fieldElement(f) {
    const wrap = document.createElement('div'); wrap.className = 'field';
    const label = document.createElement('label'); label.textContent = f.label; label.htmlFor = 'f_' + f.key;
    const value = state.settings[f.key];
    let input;
    if (f.type === 'bool') {
      input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!value;
    } else if (f.type === 'select') {
      input = document.createElement('select');
      (f.options || []).forEach(([k, text]) => {
        const o = document.createElement('option'); o.value = k; o.textContent = text; o.selected = k === value; input.appendChild(o);
      });
    } else if (f.type === 'float') {
      input = document.createElement('input'); input.type = 'number'; input.value = value;
      if (f.min !== undefined) input.min = f.min; if (f.max !== undefined) input.max = f.max; if (f.step) input.step = f.step;
    } else {
      input = document.createElement('input'); input.type = 'text'; input.value = value == null ? '' : value;
      if (f.key === 'out_dir' || f.key === 'name_regex' || f.key === 'hardware_keywords' || f.key === 'file_mask') { wrap.classList.add('wide'); }
    }
    input.id = 'f_' + f.key; input.dataset.key = f.key; input.dataset.type = f.type;
    if (f.tooltip) { wrap.title = f.tooltip; }
    wrap.appendChild(label);
    if (f.key === 'out_dir') {
      const row = document.createElement('div'); row.className = 'row';
      row.appendChild(input);
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = '…'; btn.title = 'Выбрать папку';
      btn.onclick = () => send('pick_folder', {}).then((r) => { try { const p = JSON.parse(r || '{}'); if (p.path) setField('out_dir', p.path); } catch (e) {} });
      row.appendChild(btn);
      wrap.appendChild(row);
    } else {
      wrap.appendChild(input);
    }
    return wrap;
  }

  function setField(key, value) {
    const el = $('f_' + key); if (!el) return;
    if (el.type === 'checkbox') el.checked = !!value; else el.value = value;
  }

  function collectSettings() {
    const out = Object.assign({}, state.settings);
    document.querySelectorAll('#settings [data-key]').forEach((el) => {
      const key = el.dataset.key; const type = el.dataset.type;
      if (type === 'bool') out[key] = !!el.checked;
      else if (type === 'float') out[key] = parseFloat(el.value) || 0;
      else out[key] = el.value;
    });
    state.settings = out;
    return out;
  }

  // ---------------------------------------------------------------- run
  function setBusy(b) {
    state.busy = b;
    $('btn-generate').disabled = b; $('btn-export').disabled = b || state.sheets.length === 0;
  }
  $('btn-generate').onclick = () => {
    const s = collectSettings();
    setBusy(true); setProgress(0, 'Запуск…'); clearLog();
    send('generate', s);
  };
  $('btn-export').onclick = () => {
    const s = collectSettings();
    setBusy(true); setProgress(0, 'Экспорт…');
    send('export', s);
  };
  $('btn-folder').onclick = () => { collectSettings(); send('open_folder', { path: state.settings.out_dir }); };

  function onSheets(p) {
    state.sheets = p.sheets || [];
    state.warnings = (p.warnings || []).length;
    (p.warnings || []).forEach((w) => log('warn', w));
    renderSheetList();
    if (state.sheets.length) showSheet(0);
    setBusy(false);
    setProgress(1, 'Построено листов: ' + state.sheets.length);
    setStatus('Построено листов: ' + state.sheets.length + '. Нажмите «Экспорт» для записи файлов.', 'ok');
  }
  function onDone(p) {
    setBusy(false); setProgress(1, 'Готово');
    (p.files || []).forEach((f) => log('info', 'Файл: ' + f));
    setStatus('Экспорт завершён: файлов ' + (p.files || []).length + (p.out_dir ? ' → ' + p.out_dir : ''), 'ok');
  }
  function onError(p) {
    setBusy(false); setProgress(0, '');
    log('err', p.message || 'Ошибка'); setStatus(p.message || 'Ошибка', 'err');
  }

  // ---------------------------------------------------------------- sheets & viewer
  function renderSheetList() {
    const ul = $('sheet-list'); ul.innerHTML = '';
    $('sheet-count').textContent = state.sheets.length ? '(' + state.sheets.length + ')' : '';
    state.sheets.forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="kind"></span><span class="title"></span><span class="num"></span>';
      li.querySelector('.kind').textContent = s.kind; li.querySelector('.title').textContent = s.title;
      li.querySelector('.num').textContent = s.number + '/' + s.total;
      li.onclick = () => showSheet(i);
      ul.appendChild(li);
    });
  }
  function showSheet(i) {
    if (i < 0 || i >= state.sheets.length) return;
    state.current = i;
    [...$('sheet-list').children].forEach((li, k) => li.classList.toggle('active', k === i));
    const s = state.sheets[i];
    $('sheet-title').textContent = s.kind + ' · ' + s.title + ' · ' + s.number + '/' + s.total + (s.scale ? ' · М ' + s.scale : '');
    const page = $('page'); page.innerHTML = s.svg;
    const svg = page.querySelector('svg');
    if (svg) {
      const vb = (svg.getAttribute('viewBox') || '0 0 420 297').split(/\s+/).map(Number);
      svg.setAttribute('width', vb[2] * PX_PER_MM); svg.setAttribute('height', vb[3] * PX_PER_MM);
    }
    fit();
  }
  $('btn-prev').onclick = () => showSheet(state.current - 1);
  $('btn-next').onclick = () => showSheet(state.current + 1);
  $('btn-fit').onclick = fit;
  document.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.key === 'ArrowLeft') showSheet(state.current - 1);
    if (e.key === 'ArrowRight') showSheet(state.current + 1);
  });

  function applyTransform() {
    $('page').style.transform = 'translate(' + state.pan.x + 'px,' + state.pan.y + 'px) scale(' + state.zoom + ')';
    $('zoom-label').textContent = Math.round(state.zoom * 100) + '%';
  }
  function fit() {
    const svg = $('page').querySelector('svg'); const c = $('canvas');
    if (!svg) return;
    const w = parseFloat(svg.getAttribute('width')); const h = parseFloat(svg.getAttribute('height'));
    const z = Math.min((c.clientWidth - 40) / w, (c.clientHeight - 40) / h);
    state.zoom = Math.max(0.05, z);
    state.pan = { x: (c.clientWidth - w * state.zoom) / 2, y: (c.clientHeight - h * state.zoom) / 2 };
    applyTransform();
  }
  const canvas = $('canvas');
  let drag = null;
  canvas.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, px: state.pan.x, py: state.pan.y }; canvas.classList.add('dragging'); });
  window.addEventListener('mousemove', (e) => { if (!drag) return; state.pan = { x: drag.px + e.clientX - drag.x, y: drag.py + e.clientY - drag.y }; applyTransform(); });
  window.addEventListener('mouseup', () => { drag = null; canvas.classList.remove('dragging'); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nz = Math.min(20, Math.max(0.05, state.zoom * factor));
    state.pan = { x: mx - (mx - state.pan.x) * (nz / state.zoom), y: my - (my - state.pan.y) * (nz / state.zoom) };
    state.zoom = nz; applyTransform();
  }, { passive: false });
  window.addEventListener('resize', () => { if (state.current >= 0) fit(); });

  // ---------------------------------------------------------------- status & log
  function setStatus(text, level) { const el = $('status'); el.textContent = text; el.className = 'status ' + (level || ''); }
  function setProgress(value, message) {
    if (typeof value === 'number') $('progress-bar').style.width = Math.round(Math.max(0, Math.min(1, value)) * 100) + '%';
    if (message) setStatus(message, '');
  }
  function log(level, message) {
    const pre = $('log'); const line = document.createElement('div');
    line.className = level === 'warn' ? 'warn' : (level === 'err' || level === 'error') ? 'err' : '';
    line.textContent = message; pre.appendChild(line); pre.scrollTop = pre.scrollHeight;
    if (line.className === 'warn') { state.warnings += 1; $('warn-count').textContent = '· предупреждений: ' + state.warnings; }
  }
  function clearLog() { $('log').innerHTML = ''; state.warnings = 0; $('warn-count').textContent = ''; }

  // hello
  send('ready', {});
})();
