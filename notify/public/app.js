/* Admin panel for the YCLIENTS notification service. Vanilla JS, talks to /admin/* with a Bearer token. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let TOKEN = localStorage.getItem('adminToken') || '';
let TZ = 'Europe/Moscow';
let CURRENT = 'overview';

const STATUS_RU = { queued: ['в очереди', 'info'], sent: ['отправлено', 'info'], delivered: ['доставлено', 'ok'], read: ['прочитано', 'ok'], failed: ['не доставлено', 'bad'], pending: ['запланировано', 'info'], done: ['выполнено', 'ok'], skipped: ['пропущено', 'warn'], cancelled: ['отменено', 'warn'] };
const CH_RU = { telegram: 'Telegram', whatsapp: 'WhatsApp', sms: 'SMS', log: 'Лог' };
const ATT = { '-1': ['не пришёл', 'bad'], 0: ['ожидание', ''], 1: ['пришёл', 'ok'], 2: ['подтвердил', 'ok'] };

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401) { showLogin(data?.error || 'Нужен токен'); throw new Error(data?.error || 'Неверный токен'); }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}
const get = (u) => api('GET', u); const post = (u, b) => api('POST', u, b ?? {}); const put = (u, b) => api('PUT', u, b); const del = (u) => api('DELETE', u);

function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.style.background = bad ? 'var(--bad)' : ''; t.style.color = bad ? '#fff' : ''; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3500); }
function modal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

const fmtDT = (ts) => ts ? new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) : '—';
const fmtT = (ts) => ts ? new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) : '—';
const fmtDay = (ts) => new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(ts));
const dayKey = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
const chip = (status) => { const [t, c] = STATUS_RU[status] || [status, '']; return `<span class="chip ${c}">${esc(t)}</span>`; };
const chCh = (c) => c ? `<span class="chip">${esc(CH_RU[c] || c)}</span>` : '';

// ---- auth / nav ---------------------------------------------------------------------------------
function showLogin(err = '') { $('#login').classList.remove('hidden'); $$('.tab').forEach((t) => t.classList.add('hidden')); $('#loginError').textContent = err; }
$('#loginForm').addEventListener('submit', async (e) => { e.preventDefault(); TOKEN = $('#tokenInput').value.trim(); localStorage.setItem('adminToken', TOKEN); try { await get('/admin/overview'); $('#login').classList.add('hidden'); show(CURRENT); } catch (err) { $('#loginError').textContent = err.message; } });
$('#logout').addEventListener('click', () => { localStorage.removeItem('adminToken'); TOKEN = ''; showLogin(); });
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.tab); });
function show(tab) { CURRENT = tab; location.hash = tab; $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab)); $$('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${tab}`)); $('#login').classList.add('hidden'); RENDER[tab]?.().catch((e) => toast(e.message, true)); }

// ---- overview -----------------------------------------------------------------------------------
async function renderOverview() {
  const o = await get('/admin/overview');
  TZ = o.company?.timezone_name || TZ;
  $('#companyTitle').textContent = o.company ? `· ${o.company.title}` : '';
  const n = (arr, s) => arr.filter((x) => x.status === s).reduce((a, x) => a + x.n, 0);
  const st = o.stats;
  const sync = o.sync ? (o.sync.error ? `<span class="chip bad">ошибка: ${esc(o.sync.error)}</span>` : `<span class="chip ok">${fmtDT(o.sync.at)} · записей ${o.sync.fetched}</span>`) : '<span class="chip warn">ещё не было</span>';
  $('#tab-overview').innerHTML = `
    <div class="grid">
      <div class="stat"><span class="muted">YCLIENTS</span><b>${o.yclients.authorized ? '✓' : '—'}</b>${o.yclients.authorized ? `${esc(o.company?.title || '')} <span class="muted">#${o.yclients.companyId}</span>` : '<a href="#settings" onclick="show(\'settings\')">настроить</a>'}</div>
      <div class="stat"><span class="muted">Синхронизация</span><b style="font-size:16px;margin-top:8px">${sync}</b><button class="small ghost" id="syncNow" ${o.yclients.authorized ? '' : 'disabled'}>Обновить сейчас</button></div>
      <div class="stat"><span class="muted">За 24 часа отправлено</span><b>${n(st.byStatus, 'sent') + n(st.byStatus, 'delivered') + n(st.byStatus, 'read')}</b>не доставлено: ${n(st.byStatus, 'failed')}, в очереди: ${n(st.byStatus, 'queued')}</div>
      <div class="stat"><span class="muted">Задачи</span><b>${n(st.jobs, 'pending')}</b>запланировано · выполнено ${n(st.jobs, 'done')} · пропущено ${n(st.jobs, 'skipped')}</div>
    </div>
    <div class="card"><h3>Каналы и каскад</h3>
      <p>Порядок попыток: ${o.cascade.map((c) => `<span class="chip ${o.channels[c]?.active ? 'ok' : 'bad'}">${esc(CH_RU[c] || c)}</span>`).join(' → ')}</p>
      <table><tbody>${Object.entries(o.channels).map(([k, c]) => `<tr><td><b>${esc(c.title)}</b></td><td>${c.active ? '<span class="chip ok">подключён</span>' : '<span class="chip">выключен</span>'}</td><td class="help">${esc(c.hint)}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="card"><h3>Быстрая отправка (тест)</h3>
      <form class="inline" id="quickSend"><input name="phone" placeholder="+7 916 123-45-67" required><input name="text" placeholder="Текст сообщения" required><select name="ch"><option value="">каскад</option>${Object.keys(o.channels).map((c) => `<option value="${c}">${esc(CH_RU[c] || c)}</option>`).join('')}</select><button>Отправить</button></form>
    </div>
    <div class="card"><h3>Адреса вебхуков</h3>
      <table><tbody>
        <tr><td>Telegram</td><td><code>${esc(o.webhooks.telegram)}</code> <span class="help">ставится автоматически, если задан PUBLIC_URL; иначе бот работает через long polling</span></td></tr>
        <tr><td>WhatsApp</td><td><code>${esc(o.webhooks.whatsapp)}</code> <span class="help">укажите в приложении Meta (поля messages); verify-токен — в настройках канала</span></td></tr>
        <tr><td>YCLIENTS</td><td><code>${esc(o.webhooks.yclients)}</code> <span class="help">необязательно: приём событий по записям из маркетплейса YCLIENTS; основной способ — опрос API</span></td></tr>
      </tbody></table>
    </div>`;
  $('#syncNow')?.addEventListener('click', async (e) => { e.target.disabled = true; try { const r = await post('/admin/yclients/sync'); toast(`Записей: ${r.fetched}, изменилось: ${r.changed}; задач создано ${r.plan.created}`); renderOverview(); } catch (err) { toast(err.message, true); e.target.disabled = false; } });
  $('#quickSend').addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target); try { const m = await post('/admin/send', { phone: f.get('phone'), text: f.get('text'), channels: f.get('ch') ? [f.get('ch')] : undefined }); toast(`Сообщение #${m.id}: ${STATUS_RU[m.status]?.[0] || m.status}${m.currentChannel ? ' через ' + CH_RU[m.currentChannel] : ''}${m.error ? ' — ' + m.error : ''}`, m.status === 'failed'); } catch (err) { toast(err.message, true); } });
}

// ---- schedule -----------------------------------------------------------------------------------
let schedRange = 7;
async function renderSchedule() {
  const now = Date.now();
  const from = new Date(now - 24 * 3600e3).toISOString(); const to = new Date(now + schedRange * 24 * 3600e3).toISOString();
  const s = await get(`/admin/schedule?from=${from}&to=${to}&deleted=${$('#showDeleted')?.checked ? 1 : 0}`);
  TZ = s.tz || TZ;
  const groups = {};
  for (const r of s.records) (groups[dayKey(r.startTs)] ||= []).push(r);
  const days = Object.keys(groups).sort();
  $('#tab-schedule').innerHTML = `
    <div class="card"><div class="row">
      <h2 style="margin:0">Расписание и клиенты</h2>
      <select id="schedRange">${[1, 3, 7, 14].map((d) => `<option value="${d}" ${d === schedRange ? 'selected' : ''}>${d === 1 ? 'сегодня' : d + ' дней'}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" id="showDeleted"> показывать отменённые</label>
      <span class="muted">${s.records.length} записей · данные из YCLIENTS, обновляются автоматически</span>
    </div></div>
    ${days.length ? days.map((d) => `<div class="day">${esc(fmtDay(groups[d][0].startTs))}</div>
      <div class="card" style="padding:0"><table><thead><tr><th>Время</th><th>Клиент</th><th class="keep">Телефон</th><th>Услуги</th><th>Мастер</th><th>Статус</th><th>Уведомления</th></tr></thead><tbody>
      ${groups[d].map((r) => `<tr class="${r.deleted ? 'deleted' : ''}" data-id="${r.id}">
        <td>${fmtT(r.startTs)}–${fmtT(r.endTs)}</td>
        <td>${esc(r.client.name || '—')}${r.client.telegram ? ' <span class="chip ok" title="Telegram подключён">TG</span>' : ''}${r.client.unsubscribed ? ' <span class="chip bad">отписан</span>' : ''}</td>
        <td class="keep">${r.client.phone ? `<a href="tel:+${r.client.phone}">${esc(r.client.phoneFormatted)}</a>` : '<span class="muted">нет</span>'}</td>
        <td>${esc(r.services.map((x) => x.title).join(', '))}</td><td>${esc(r.staff.name || '')}</td>
        <td>${r.deleted ? '<span class="chip bad">отменена</span>' : `<span class="chip ${ATT[r.attendance]?.[1] || ''}">${esc(ATT[r.attendance]?.[0] || r.attendance)}</span>`}${r.online ? ' <span class="chip">онлайн</span>' : ''}</td>
        <td>${r.jobs.map((j) => `<span class="chip ${STATUS_RU[j.status]?.[1] || ''}" title="${esc(j.ruleName)} · ${fmtDT(j.dueAt)}${j.note ? ' · ' + j.note : ''}">${esc(j.ruleName)}: ${esc(STATUS_RU[j.status]?.[0] || j.status)}</span>`).join('')}${r.messages.map((m) => `<span class="chip ${STATUS_RU[m.status]?.[1] || ''}">${esc(CH_RU[m.channel] || m.channel || '…')} ${esc(STATUS_RU[m.status]?.[0] || m.status)}</span>`).join('')}
          <button class="small ghost" data-open="${r.id}">…</button></td>
      </tr>`).join('')}</tbody></table></div>`).join('') : '<div class="card muted">Записей нет. Проверьте настройки YCLIENTS и нажмите «Обновить сейчас» на вкладке «Обзор».</div>'}`;
  $('#schedRange').addEventListener('change', (e) => { schedRange = Number(e.target.value); renderSchedule(); });
  $('#showDeleted').addEventListener('change', renderSchedule);
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => openRecord(Number(b.dataset.open))));
}

async function openRecord(id) {
  const d = await get(`/admin/records/${id}`);
  const r = d.record;
  modal(`<h3>Запись #${r.id} · ${fmtDT(r.startTs)}</h3>
    <p><b>${esc(r.client.name || '—')}</b> · ${esc(r.client.phoneFormatted)}<br>${esc(r.services.map((x) => x.title).join(', '))} · ${esc(r.staff.name || '')}<br>Статус: ${esc(ATT[r.attendance]?.[0] || r.attendance)}${r.comment ? `<br>Комментарий: ${esc(r.comment)}` : ''}</p>
    <h4>Запланированные уведомления</h4>
    <table><tbody>${d.jobs.map((j) => `<tr><td>${esc(j.rule_name)}</td><td>${fmtDT(j.due_at)}</td><td>${chip(j.status)} ${esc(j.note || '')}</td><td>${j.status === 'pending' ? `<button class="small" data-run="${j.id}">Отправить сейчас</button> <button class="small ghost" data-cancel="${j.id}">Отменить</button>` : ''}</td></tr>`).join('') || '<tr><td class="muted">нет</td></tr>'}</tbody></table>
    <h4>Сообщения</h4>
    <table><tbody>${d.messages.map((m) => `<tr><td>${fmtDT(m.createdAt)}</td><td>${chCh(m.currentChannel)} ${chip(m.status)}</td><td class="text-cell">${esc(m.text)}</td><td>${m.error ? `<span class="chip bad" title="${esc(m.error)}">ошибка</span>` : ''}</td></tr>`).join('') || '<tr><td class="muted">нет</td></tr>'}</tbody></table>
    <form class="inline" id="recSend" style="margin-top:12px"><input name="text" placeholder="Написать клиенту вручную…" required><button>Отправить</button></form>
    <p style="text-align:right"><button class="ghost" onclick="closeModal()">Закрыть</button></p>`);
  $$('[data-run]').forEach((b) => b.addEventListener('click', async () => { try { await post(`/admin/jobs/${b.dataset.run}/run`); toast('Отправлено'); openRecord(id); renderSchedule(); } catch (e) { toast(e.message, true); } }));
  $$('[data-cancel]').forEach((b) => b.addEventListener('click', async () => { await post(`/admin/jobs/${b.dataset.cancel}/cancel`); openRecord(id); renderSchedule(); }));
  $('#recSend').addEventListener('submit', async (e) => { e.preventDefault(); try { await post('/admin/send', { phone: r.client.phone, text: new FormData(e.target).get('text') }); toast('Отправлено'); openRecord(id); } catch (err) { toast(err.message, true); } });
}

// ---- messages -----------------------------------------------------------------------------------
async function renderMessages() {
  const status = $('#msgStatus')?.value || ''; const phone = $('#msgPhone')?.value || '';
  const [list, inbound] = await Promise.all([get(`/admin/messages?limit=200${status ? '&status=' + status : ''}${phone ? '&phone=' + encodeURIComponent(phone) : ''}`), get('/admin/inbound?limit=50')]);
  $('#tab-messages').innerHTML = `
    <div class="card"><div class="row"><h2 style="margin:0">Исходящие</h2>
      <select id="msgStatus"><option value="">все статусы</option>${Object.keys(STATUS_RU).slice(0, 5).map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${STATUS_RU[s][0]}</option>`).join('')}</select>
      <input id="msgPhone" placeholder="телефон" value="${esc(phone)}" style="width:160px"><button class="ghost small" id="msgFilter">Фильтр</button></div></div>
    <div class="card" style="padding:0"><table><thead><tr><th>Когда</th><th class="keep">Кому</th><th>Текст</th><th>Канал</th><th>Статус</th><th>Источник</th><th></th></tr></thead><tbody>
      ${list.map((m) => `<tr><td>${fmtDT(m.createdAt)}</td><td class="keep">${esc(m.phoneFormatted)}</td><td class="text-cell">${esc(m.text)}</td>
        <td>${m.channels.map((c, i) => `<span class="chip ${i < m.channelIndex ? 'bad' : i === m.channelIndex && m.status !== 'queued' ? 'ok' : ''}">${esc(CH_RU[c] || c)}</span>`).join('')}</td>
        <td>${chip(m.status)}${m.error ? `<div class="help">${esc(m.error)}</div>` : ''}</td><td>${esc({ rule: 'правило', api: 'API', manual: 'вручную' }[m.source] || m.source)}</td>
        <td>${m.status === 'failed' ? `<button class="small ghost" data-retry="${m.id}">Повторить</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Сообщений нет</td></tr>'}</tbody></table></div>
    <div class="card"><h2>Входящие ответы клиентов</h2><table><thead><tr><th>Когда</th><th>Канал</th><th class="keep">От кого</th><th>Текст</th><th>Действие</th></tr></thead><tbody>
      ${inbound.map((i) => `<tr><td>${fmtDT(i.created_at)}</td><td>${chCh(i.channel)}</td><td class="keep">${i.phone ? '+' + esc(i.phone) : esc(i.chat_id || '')}</td><td class="text-cell">${esc(i.text || '')}</td><td>${esc({ confirm: '✅ подтвердил', cancel: '❌ отмена/перенос', stop: 'отписка', link: 'привязал Telegram', text: 'сообщение', resubscribe: 'подписался' }[i.action] || i.action || '')}${i.record_id ? ` <span class="chip">#${i.record_id}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Пока нет</td></tr>'}</tbody></table></div>`;
  $('#msgFilter').addEventListener('click', renderMessages);
  $$('[data-retry]').forEach((b) => b.addEventListener('click', async () => { try { await post(`/admin/messages/${b.dataset.retry}/retry`); renderMessages(); } catch (e) { toast(e.message, true); } }));
}

// ---- rules --------------------------------------------------------------------------------------
async function renderRules() {
  const d = await get('/admin/rules');
  const offsetHuman = (r) => { const m = Math.abs(r.offsetMin); const v = m % 1440 === 0 && m ? `${m / 1440} дн.` : m % 60 === 0 ? `${m / 60} ч` : `${m} мин`; return ({ before_visit: `за ${v} до визита`, on_create: `через ${v} после записи`, after_visit: `через ${v} после визита`, return_visit: `через ${v} после визита` })[r.type]; };
  $('#tab-rules').innerHTML = `
    <div class="card"><div class="row"><h2 style="margin:0">Правила рассылки</h2><button id="newRule">+ Новое правило</button></div>
      <p class="help">Правила автоматически создают задачи для каждой записи из YCLIENTS. Время рассчитывается в часовом поясе салона; «тихие часы» переносят отправку на утро.</p></div>
    <div class="card" style="padding:0"><table><thead><tr><th></th><th>Название</th><th>Когда</th><th>Текст</th><th>Каналы</th><th></th></tr></thead><tbody>
      ${d.rules.map((r) => `<tr><td><span class="chip ${r.enabled ? 'ok' : ''}">${r.enabled ? 'вкл' : 'выкл'}</span></td><td><b>${esc(r.name)}</b><div class="help">${esc(d.types[r.type]?.title || r.type)}</div></td><td>${esc(offsetHuman(r))}${r.options?.confirm ? '<div class="chip info">кнопки подтверждения</div>' : ''}</td><td class="text-cell help">${esc(r.template.slice(0, 160))}${r.template.length > 160 ? '…' : ''}</td><td>${(r.channels || ['каскад']).map((c) => `<span class="chip">${esc(CH_RU[c] || c)}</span>`).join('')}</td><td><button class="small ghost" data-edit="${r.id}">Изменить</button></td></tr>`).join('')}</tbody></table></div>`;
  $('#newRule').addEventListener('click', () => editRule(null, d));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => editRule(d.rules.find((r) => r.id === Number(b.dataset.edit)), d)));
}

function editRule(rule, d) {
  const r = rule || { name: '', type: 'before_visit', enabled: true, offsetMin: 1440, template: '', channels: null, options: {} };
  const unit = r.offsetMin % 1440 === 0 && r.offsetMin ? 1440 : r.offsetMin % 60 === 0 && r.offsetMin ? 60 : 1;
  modal(`<h3>${rule ? 'Правило: ' + esc(r.name) : 'Новое правило'}</h3>
    <label>Название</label><input id="rName" value="${esc(r.name)}">
    <label>Тип</label><select id="rType">${Object.entries(d.types).map(([k, t]) => `<option value="${k}" ${k === r.type ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select>
    <label>Смещение</label><div class="row"><input id="rOff" type="number" min="0" value="${r.offsetMin / unit}" style="width:110px"><select id="rUnit" style="width:120px"><option value="1" ${unit === 1 ? 'selected' : ''}>минут</option><option value="60" ${unit === 60 ? 'selected' : ''}>часов</option><option value="1440" ${unit === 1440 ? 'selected' : ''}>дней</option></select><span class="help" id="rOffHint"></span></div>
    <label>Текст сообщения</label><textarea id="rTpl">${esc(r.template)}</textarea>
    <div class="vars">${d.variables.map(([v, h]) => `<code title="${esc(h)}" data-var="${v}">{{${v}}}</code>`).join('')}</div>
    <div class="row" style="margin-top:8px"><button class="small ghost" id="rPreview">Предпросмотр</button><span class="help">по ближайшей записи</span></div><pre id="rPreviewOut" class="hidden"></pre>
    <label>Каналы (пусто — общий каскад)</label><div class="row">${['telegram', 'whatsapp', 'sms', 'log'].map((c) => `<label class="check"><input type="checkbox" data-ch="${c}" ${r.channels?.includes(c) ? 'checked' : ''}> ${CH_RU[c]}</label>`).join('')}</div>
    <div id="rOpts">
      <label class="check"><input type="checkbox" id="oConfirm" ${r.options?.confirm ? 'checked' : ''}> Добавить кнопки «Подтверждаю / Отменить» (Telegram, WhatsApp); текстом клиент может ответить «1» / «2»</label>
      <label class="check"><input type="checkbox" id="oSkipConfirmed" ${r.options?.skipIfConfirmed ? 'checked' : ''}> Не отправлять, если клиент уже подтвердил визит</label>
      <label class="check"><input type="checkbox" id="oOnline" ${r.options?.onlineOnly ? 'checked' : ''}> Только для онлайн-записей</label>
      <label>ID мастеров через запятую (пусто — все)</label><input id="oStaff" value="${esc((r.options?.staffIds || []).join(', '))}">
      <label>ID услуг через запятую (пусто — все)</label><input id="oServices" value="${esc((r.options?.serviceIds || []).join(', '))}">
    </div>
    <label class="check" style="margin-top:12px"><input type="checkbox" id="rEnabled" ${r.enabled ? 'checked' : ''}> Правило включено</label>
    <p class="error" id="rErr"></p>
    <div class="row" style="justify-content:space-between"><div>${rule ? '<button class="danger small" id="rDel">Удалить</button>' : ''}</div><div class="row"><button class="ghost" onclick="closeModal()">Отмена</button><button id="rSave">Сохранить</button></div></div>`);
  const hint = () => { $('#rOffHint').textContent = d.types[$('#rType').value]?.offsetLabel || ''; };
  hint(); $('#rType').addEventListener('change', hint);
  $$('[data-var]').forEach((c) => c.addEventListener('click', () => { const ta = $('#rTpl'); const s = ta.selectionStart; ta.setRangeText(c.textContent, s, ta.selectionEnd, 'end'); ta.focus(); }));
  $('#rPreview').addEventListener('click', async () => { const o = await post('/admin/rules/preview', { template: $('#rTpl').value }); $('#rPreviewOut').textContent = o.text; $('#rPreviewOut').classList.remove('hidden'); });
  const collect = () => {
    const ids = (s) => s.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
    const chans = $$('[data-ch]:checked').map((c) => c.dataset.ch);
    return { name: $('#rName').value.trim(), type: $('#rType').value, enabled: $('#rEnabled').checked, offsetMin: Number($('#rOff').value) * Number($('#rUnit').value), template: $('#rTpl').value, channels: chans.length ? chans : null,
      options: { ...(r.options || {}), confirm: $('#oConfirm').checked, skipIfConfirmed: $('#oSkipConfirmed').checked, onlineOnly: $('#oOnline').checked, staffIds: ids($('#oStaff').value), serviceIds: ids($('#oServices').value) }, sort: r.sort ?? 0 };
  };
  $('#rSave').addEventListener('click', async () => { try { const body = collect(); if (rule) await put(`/admin/rules/${rule.id}`, body); else await post('/admin/rules', body); closeModal(); renderRules(); toast('Сохранено'); } catch (e) { $('#rErr').textContent = e.message; } });
  $('#rDel')?.addEventListener('click', async () => { if (!confirm('Удалить правило и отменить его запланированные задачи?')) return; await del(`/admin/rules/${rule.id}`); closeModal(); renderRules(); });
}

// ---- contacts -----------------------------------------------------------------------------------
async function renderContacts() {
  const q = $('#cq')?.value || '';
  const list = await get(`/admin/contacts?q=${encodeURIComponent(q)}`);
  $('#tab-contacts').innerHTML = `
    <div class="card"><form class="inline" id="cform"><h2 style="margin:0">Контакты</h2><input id="cq" placeholder="поиск по имени или телефону" value="${esc(q)}"><button class="ghost">Найти</button></form>
      <p class="help">Контакты собираются из записей YCLIENTS автоматически. «TG» — клиент подключил Telegram-бота и будет получать сообщения там; иначе каскад перейдёт к WhatsApp/SMS.</p></div>
    <div class="card" style="padding:0"><table><thead><tr><th>Телефон</th><th>Имя</th><th>Telegram</th><th>Статус</th><th></th></tr></thead><tbody>
      ${list.map((c) => `<tr><td>+${esc(c.phone)}</td><td>${esc(c.name || '')}</td><td>${c.telegram_chat_id ? `<span class="chip ok">TG${c.telegram_username ? ' @' + esc(c.telegram_username) : ''}</span>` : '<span class="muted">—</span>'}</td><td>${c.unsubscribed ? '<span class="chip bad">отписан</span>' : '<span class="chip ok">получает</span>'}</td><td><button class="small ghost" data-unsub="${c.phone}" data-val="${c.unsubscribed ? 0 : 1}">${c.unsubscribed ? 'Включить' : 'Отписать'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Контактов нет</td></tr>'}</tbody></table></div>`;
  $('#cform').addEventListener('submit', (e) => { e.preventDefault(); renderContacts(); });
  $$('[data-unsub]').forEach((b) => b.addEventListener('click', async () => { await put(`/admin/contacts/${b.dataset.unsub}`, { unsubscribed: b.dataset.val === '1' }); renderContacts(); }));
}

// ---- settings -----------------------------------------------------------------------------------
async function renderSettings() {
  const s = await get('/admin/settings');
  const y = s.yclients, c = s.channels, g = s.general;
  $('#tab-settings').innerHTML = `
    <div class="card"><h2>YCLIENTS</h2>
      <p class="help">1) Partner token выдаётся после регистрации разработчика в <a href="https://yclients.ru/appstore/developers" target="_blank" rel="noopener">маркетплейсе YCLIENTS</a>. 2) Войдите логином и паролем пользователя YCLIENTS с доступом к журналу записи — сервис получит user token. 3) Выберите филиал.</p>
      <label>Partner token</label><input id="yPartner" value="${esc(y.partnerToken)}" placeholder="из «Настройки аккаунта» разработчика">
      <label>ID филиала (company_id)</label><div class="row"><input id="yCompany" value="${esc(y.companyId || '')}" style="width:160px"><button class="ghost small" id="yCompanies">Выбрать из моих филиалов</button><span id="yCompanyList"></span></div>
      <div class="row" style="margin-top:10px"><button id="ySave">Сохранить</button></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <form class="inline" id="yAuth"><input name="login" placeholder="логин (телефон или e-mail)" value="${esc(y.login || '')}"><input name="password" type="password" placeholder="пароль"><button>Войти и получить user token</button></form>
      <p class="help">Текущий user token: ${y.userToken ? `<span class="chip ok">получен${y.userName ? ' · ' + esc(y.userName) : ''}</span>` : '<span class="chip warn">нет</span>'} · Если включена двухфакторная авторизация — вставьте токен вручную: <input id="yUser" value="${esc(y.userToken)}" style="width:260px;display:inline-block"></p>
    </div>

    <div class="card"><h2>Каналы</h2>
      <h3>Telegram-бот</h3>
      <label class="check"><input type="checkbox" id="tgOn" ${c.telegram?.enabled ? 'checked' : ''}> Включён</label>
      <label>Токен бота (от @BotFather)</label><input id="tgToken" value="${esc(c.telegram?.botToken || '')}">
      <p class="help">Клиенту нужно один раз открыть бота и нажать «Поделиться номером» — после этого напоминания идут в Telegram бесплатно. Ссылку на бота удобно добавить в подтверждение записи.</p>
      <h3>WhatsApp Cloud API</h3>
      <label class="check"><input type="checkbox" id="waOn" ${c.whatsapp?.enabled ? 'checked' : ''}> Включён</label>
      <div class="grid"><div><label>Phone number ID</label><input id="waPhoneId" value="${esc(c.whatsapp?.phoneNumberId || '')}"></div><div><label>Access token</label><input id="waToken" value="${esc(c.whatsapp?.accessToken || '')}"></div>
        <div><label>Verify token (для вебхука)</label><input id="waVerify" value="${esc(c.whatsapp?.verifyToken || '')}"></div><div><label>App secret (подпись вебхука, необязательно)</label><input id="waSecret" value="${esc(c.whatsapp?.appSecret || '')}"></div>
        <div><label>Имя утверждённого шаблона (вне 24 ч)</label><input id="waTpl" value="${esc(c.whatsapp?.templateName || '')}" placeholder="например, notification_text"></div><div><label>Язык шаблона</label><input id="waLang" value="${esc(c.whatsapp?.templateLang || 'ru')}"></div></div>
      <h3>SMS</h3>
      <label class="check"><input type="checkbox" id="smsOn" ${c.sms?.enabled ? 'checked' : ''}> Включён</label>
      <div class="grid"><div><label>Провайдер</label><select id="smsProv">${['smsc', 'smsru', 'custom'].map((p) => `<option value="${p}" ${c.sms?.provider === p ? 'selected' : ''}>${{ smsc: 'smsc.ru', smsru: 'sms.ru', custom: 'свой HTTP-шлюз' }[p]}</option>`).join('')}</select></div>
        <div><label>Логин</label><input id="smsLogin" value="${esc(c.sms?.login || '')}"></div><div><label>Пароль / api_id</label><input id="smsPass" value="${esc(c.sms?.password || '')}"></div><div><label>Имя отправителя</label><input id="smsSender" value="${esc(c.sms?.sender || '')}"></div>
        <div><label>URL шлюза (custom; {phone}, {text}, {sender})</label><input id="smsUrl" value="${esc(c.sms?.url || '')}"></div><div><label>Регулярка успешного ответа (custom)</label><input id="smsOk" value="${esc(c.sms?.successPattern || '')}"></div></div>
      <label class="check"><input type="checkbox" id="smsTranslit" ${c.sms?.transliterate ? 'checked' : ''}> Транслитерировать SMS (дешевле)</label>
      <h3>Лог (тестовый канал)</h3><label class="check"><input type="checkbox" id="logOn" ${c.log?.enabled !== false ? 'checked' : ''}> Включён — сообщения только пишутся в журнал</label>
      <div class="row" style="margin-top:12px"><button id="chSave">Сохранить каналы</button></div>
    </div>

    <div class="card"><h2>Общие</h2>
      <label>Каскад (порядок каналов через запятую)</label><input id="gCascade" value="${esc(g.cascade.join(', '))}">
      <div class="grid"><div><label>Ждать подтверждения доставки (сек) перед переходом к следующему каналу</label><input id="gFallback" type="number" value="${g.fallbackSec}"></div>
        <div><label>Тихие часы: с</label><input id="gQFrom" type="number" min="0" max="23" value="${g.quietHours?.from ?? ''}"></div><div><label>до</label><input id="gQTo" type="number" min="0" max="23" value="${g.quietHours?.to ?? ''}"></div>
        <div><label>Telegram chat id администратора (для ответов клиентов)</label><input id="gAdminChat" value="${esc(g.adminTelegramChatId || '')}"></div></div>
      <h3 style="margin-top:14px">Автоответы клиентам</h3>
      <div class="grid">${[['confirmed', 'после подтверждения'], ['cancelled', 'после запроса отмены'], ['stop', 'после отписки'], ['noRecord', 'если запись не найдена'], ['start', 'на /start в Telegram'], ['linked', 'после привязки номера']].map(([k, t]) => `<div><label>${t}</label><input data-reply="${k}" value="${esc(g.replies?.[k] || '')}" placeholder="по умолчанию"></div>`).join('')}</div>
      <div class="row" style="margin-top:12px"><button id="gSave">Сохранить</button></div>
    </div>`;
  $('#ySave').addEventListener('click', async () => { try { await put('/admin/settings', { yclients: { partnerToken: $('#yPartner').value.trim(), companyId: Number($('#yCompany').value) || 0, userToken: $('#yUser').value.trim() } }); toast('Сохранено'); renderSettings(); } catch (e) { toast(e.message, true); } });
  $('#yAuth').addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await put('/admin/settings', { yclients: { partnerToken: $('#yPartner').value.trim(), companyId: Number($('#yCompany').value) || 0 } }); const r = await post('/admin/yclients/auth', { login: f.get('login'), password: f.get('password') }); toast(`Вход выполнен: ${r.user.name}`); if (r.companies.length) showCompanies(r.companies); renderSettings(); } catch (err) { toast(err.message, true); } });
  $('#yCompanies').addEventListener('click', async () => { try { showCompanies(await get('/admin/yclients/companies')); } catch (e) { toast(e.message, true); } });
  const showCompanies = (list) => { $('#yCompanyList').innerHTML = `<select id="ySel">${list.map((c) => `<option value="${c.id}">${esc(c.title)} — ${esc(c.address || c.city || '')} (#${c.id})</option>`).join('')}</select>`; $('#ySel').addEventListener('change', (e) => { $('#yCompany').value = e.target.value; }); $('#yCompany').value = list[0]?.id || ''; };
  $('#chSave').addEventListener('click', async () => {
    try {
      await put('/admin/settings', { channels: {
        telegram: { enabled: $('#tgOn').checked, botToken: $('#tgToken').value.trim() },
        whatsapp: { enabled: $('#waOn').checked, phoneNumberId: $('#waPhoneId').value.trim(), accessToken: $('#waToken').value.trim(), verifyToken: $('#waVerify').value.trim(), appSecret: $('#waSecret').value.trim(), templateName: $('#waTpl').value.trim(), templateLang: $('#waLang').value.trim() || 'ru' },
        sms: { enabled: $('#smsOn').checked, provider: $('#smsProv').value, login: $('#smsLogin').value.trim(), password: $('#smsPass').value.trim(), sender: $('#smsSender').value.trim(), url: $('#smsUrl').value.trim(), successPattern: $('#smsOk').value.trim(), transliterate: $('#smsTranslit').checked },
        log: { enabled: $('#logOn').checked } } });
      toast('Каналы сохранены'); renderSettings();
    } catch (e) { toast(e.message, true); }
  });
  $('#gSave').addEventListener('click', async () => {
    const replies = {}; $$('[data-reply]').forEach((i) => { if (i.value.trim()) replies[i.dataset.reply] = i.value.trim(); });
    const qf = $('#gQFrom').value, qt = $('#gQTo').value;
    try { await put('/admin/settings', { general: { cascade: $('#gCascade').value.split(/[,\s]+/).filter(Boolean), fallbackSec: Number($('#gFallback').value) || 600, quietHours: qf !== '' && qt !== '' ? { from: Number(qf), to: Number(qt) } : null, adminTelegramChatId: $('#gAdminChat').value.trim(), replies } }); toast('Сохранено'); } catch (e) { toast(e.message, true); }
  });
}

// ---- log ----------------------------------------------------------------------------------------
async function renderLog() {
  const [log, jobs] = await Promise.all([get('/admin/log?limit=200'), get('/admin/jobs?limit=100')]);
  $('#tab-log').innerHTML = `
    <div class="card"><h2>Ближайшие задачи</h2><table><thead><tr><th>Когда</th><th>Правило</th><th class="keep">Телефон</th><th>Запись</th><th>Статус</th></tr></thead><tbody>
      ${jobs.map((j) => `<tr><td>${fmtDT(j.due_at)}</td><td>${esc(j.rule_name || j.rule_id)}</td><td class="keep">+${esc(j.phone || '')}</td><td>#${j.record_id}</td><td>${chip(j.status)} ${esc(j.note || '')}</td></tr>`).join('') || '<tr><td class="muted">нет</td></tr>'}</tbody></table></div>
    <div class="card"><h2>Журнал сервиса</h2><table><tbody>${log.map((l) => `<tr><td style="white-space:nowrap">${fmtDT(l.created_at)}</td><td><span class="chip ${l.level === 'error' ? 'bad' : l.level === 'warn' ? 'warn' : ''}">${esc(l.scope)}</span></td><td class="text-cell">${esc(l.message)}</td></tr>`).join('')}</tbody></table></div>`;
}

const RENDER = { overview: renderOverview, schedule: renderSchedule, messages: renderMessages, rules: renderRules, contacts: renderContacts, settings: renderSettings, log: renderLog };
window.show = show; window.closeModal = closeModal;
(async () => { const tab = location.hash.replace('#', '') || 'overview'; if (!TOKEN) return showLogin(); try { await get('/admin/overview'); show(RENDER[tab] ? tab : 'overview'); } catch { /* login shown */ } })();
setInterval(() => { if (TOKEN && $('#modal').classList.contains('hidden') && ['overview', 'schedule', 'messages'].includes(CURRENT)) RENDER[CURRENT]?.().catch(() => {}); }, 30000);
