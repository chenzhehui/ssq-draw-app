'use strict';

const $ = (id) => document.getElementById(id);
const format = (n) => String(n).padStart(2, '0');
const storageKey = 'yiyao.batches.v1';
let state = null;
let current = null;
let busy = false;
let toastTimer;
let weightTimer;
let weightRequest = 0;
let weightSignature = '';
let batches = [];

function validBatch(batch) {
  return batch && Array.isArray(batch.tickets) && batch.tickets.length >= 1 && batch.tickets.length <= 20 &&
    batch.tickets.every((t) => Array.isArray(t.red) && t.red.length === 6 && new Set(t.red).size === 6 &&
      t.red.every((n) => Number.isInteger(n) && n >= 1 && n <= 33) && Number.isInteger(t.blue) && t.blue >= 1 && t.blue <= 16);
}

try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(stored)) batches = stored.filter(validBatch).slice(0, 10);
} catch { /* Storage is optional; drawing does not depend on it. */ }

function mode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3300);
}

function dateText(value, full = false) {
  if (!value) return '尚未更新';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', full ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' }).format(date);
}

async function api(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-App-Token': state?.token || '' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '请求失败');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function updateControls() {
  const weighted = mode() === 'weighted';
  $('strength').disabled = !weighted || busy;
  $('weight-tag').textContent = weighted ? '微调已启用' : '当前未启用';
  $('mode-description').textContent = weighted
    ? `历史仅作轻微偏好，单球权重最多调整 ±${$('strength').value}%。不强制分散。`
    : '每颗球权重相同。历史开奖不参与本次选择。';
  $('draw').disabled = busy || !state || (weighted && !state.weighted_available);
  $('draw-label').textContent = busy ? '正在摇号…' : !state ? '等待本地服务' : weighted && !state.weighted_available ? '请先更新数据' : '开始摇号';
  $('refresh').disabled = !state || state.refreshing;
  $('refresh').textContent = state?.refreshing ? '正在更新…' : '立即更新 ↻';
  document.querySelectorAll('input[name="mode"]').forEach((input) => { input.disabled = busy; });
}

function renderHistory() {
  const root = $('latest-draws');
  root.replaceChildren();
  if (!state.latest3.length) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = '尚无真实开奖记录。不会生成替代数据。';
    root.append(note);
    return;
  }
  for (const draw of state.latest3) {
    const row = document.createElement('div'); row.className = 'history-row';
    const issue = document.createElement('span'); issue.className = 'history-issue'; issue.textContent = `${draw.issue} 期`;
    const numbers = document.createElement('span'); numbers.className = 'history-numbers'; numbers.textContent = draw.red.map(format).join(' ');
    const blue = document.createElement('span'); blue.className = 'history-blue'; blue.textContent = `+ ${format(draw.blue)}`;
    numbers.append(blue); row.append(issue, numbers); root.append(row);
  }
}

async function loadState() {
  try {
    state = await api('api/state');
    if (state.app_id !== 'ssq-local-draw') throw new Error('连接的不是本地摇号服务');
    $('data-status').textContent = state.weighted_available ? `${state.count}期 · 校验通过` : state.refreshing ? '更新中' : state.count ? '缓存数据 · 微调暂停' : '等待真实数据';
    $('data-status').classList.toggle('error', !state.weighted_available && !state.refreshing);
    $('checked-at').textContent = state.last_success ? `上次校验 ${dateText(state.last_success, true)}` : '尚未校验数据';
    $('interval').value = String(state.interval_hours);
    $('next-refresh').textContent = state.refreshing ? '正在从广东福彩读取最新50期…' : `下次检查 ${dateText(state.next_refresh, true)}${state.error ? ' · 失败后10分钟重试' : ''}`;
    $('notice').hidden = state.weighted_available || (!state.error && state.refreshing);
    $('notice').textContent = state.error ? `${state.error}。微调模式暂停；你仍可主动选择纯随机。`
      : '尚无有效的最新数据，或缓存已超过24小时。微调暂停；纯随机不依赖历史数据。';
    renderHistory();
    updateControls();
    const signature = `${state.last_success}:${state.weighted_available}:${$('strength').value}`;
    if ($('weights-details').open && signature !== weightSignature) {
      weightSignature = signature;
      await loadWeights();
    }
  } catch (error) {
    state = null;
    $('notice').hidden = false;
    $('notice').textContent = '本地服务连接中断。请确认启动窗口仍在运行，再刷新页面。';
    $('data-status').textContent = '连接中断';
    $('data-status').classList.add('error');
    updateControls();
  }
}

function plainText(batch) {
  return batch.tickets.map((t) => `${t.red.map(format).join(' ')} + ${format(t.blue)}`).join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text; area.className = 'sr-only'; document.body.append(area); area.select();
    const succeeded = document.execCommand('copy'); area.remove();
    if (!succeeded) { toast('复制未获允许，请直接选择号码文字复制'); return; }
  }
  toast('已复制纯文本号码');
}

function showBalls(ticket) {
  const values = ticket ? [...ticket.red, ticket.blue].map(format) : Array(7).fill('--');
  [...$('balls').children].forEach((element, index) => {
    element.textContent = values[index];
    element.classList.toggle('empty', !ticket);
  });
}

function renderBatch(batch) {
  if (!validBatch(batch)) return;
  current = batch;
  const root = $('results'); root.replaceChildren(); root.classList.remove('empty-results');
  batch.tickets.forEach((ticket, index) => {
    const row = document.createElement('div'); row.className = 'result-row';
    const number = document.createElement('span'); number.className = 'row-index'; number.textContent = format(index + 1);
    const text = document.createElement('span'); text.className = 'row-numbers'; text.textContent = ticket.red.map(format).join(' ');
    const plus = document.createElement('span'); plus.className = 'row-plus'; plus.textContent = '+';
    const blue = document.createElement('span'); blue.className = 'row-blue'; blue.textContent = format(ticket.blue);
    text.append(plus, blue);
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'row-copy'; copy.textContent = '复制'; copy.setAttribute('aria-label', `复制第${index + 1}注`);
    copy.addEventListener('click', () => copyText(`${ticket.red.map(format).join(' ')} + ${format(ticket.blue)}`));
    row.append(number, text, copy); root.append(row);
  });
  const weighted = batch.snapshot?.mode === 'weighted';
  $('result-count').textContent = `${batch.tickets.length}注 · ${weighted ? '微调加权' : '纯随机'}`;
  $('machine-caption').textContent = `首注预览 · ${dateText(batch.created_at)} · ${weighted ? '微调加权' : '纯随机'}`;
  $('receipt').hidden = false;
  $('receipt').textContent = `${dateText(batch.created_at, true)} / 批次 ${batch.batch_id || ''} / 快照 ${(batch.snapshot_id || '').slice(0, 12)}${weighted ? ` / 数据期号 ${batch.snapshot.latest_issue} / 最大±${batch.snapshot.strength}%` : ' / 历史权重未参与'}`;
  $('copy').disabled = false; $('export').disabled = false;
  $('plain-details').hidden = false;
  $('plain-output').value = plainText(batch);
  $('plain-output').rows = Math.min(batch.tickets.length + 1, 12);
  showBalls(batch.tickets[0]);
  renderBatchButtons();
}

function renderBatchButtons() {
  const root = $('batch-buttons'); root.replaceChildren();
  $('recent-batches').hidden = batches.length === 0;
  for (const batch of batches.slice(0, 5)) {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = `${dateText(batch.created_at)} · ${batch.tickets.length}注`;
    button.addEventListener('click', () => { if (!busy) renderBatch(batch); });
    root.append(button);
  }
}

function countValue() {
  const count = Math.trunc(Number($('count').value));
  return Math.max(1, Math.min(20, Number.isFinite(count) ? count : 5));
}

async function draw() {
  if (busy) return;
  const count = countValue(); $('count').value = String(count);
  busy = true; updateControls();
  $('machine').classList.remove('is-revealing'); $('machine').classList.add('is-spinning'); showBalls(null);
  $('machine-caption').textContent = '交给系统随机源，正在抽取…';
  try {
    const batch = await api('api/draw', { count, mode: mode(), strength: Number($('strength').value) });
    if (!validBatch(batch)) throw new Error('返回的号码格式异常，已停止显示');
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise((resolve) => setTimeout(resolve, 650));
    batches.unshift(batch); batches = batches.slice(0, 10);
    try { localStorage.setItem(storageKey, JSON.stringify(batches)); } catch { toast('号码已生成，但浏览器未允许保存记录'); }
    renderBatch(batch);
    $('machine').classList.remove('is-spinning'); $('machine').classList.add('is-revealing');
  } catch (error) {
    showBalls(current?.tickets[0]);
    $('machine-caption').textContent = '本次未完成，请查看提示后重试。';
    toast(error.message || '摇号失败');
    await loadState();
  } finally {
    busy = false; $('machine').classList.remove('is-spinning'); updateControls();
  }
}

async function loadWeights() {
  const sequence = ++weightRequest;
  if (!state?.weighted_available) {
    $('weights-note').textContent = '无法获取有效数据，暂不提供加权预览。没有使用模拟开奖。';
    $('red-weights').replaceChildren(); $('blue-weights').replaceChildren(); return;
  }
  try {
    const strength = Number($('strength').value);
    const data = await api(`api/weights?strength=${strength}`);
    if (sequence !== weightRequest) return;
    $('weights-note').textContent = `依据 ${data.latest_issue} 期及此前记录，最大偏移±${strength}%。1.000×表示不调整。${mode() === 'uniform' ? '这里只是预览，当前纯随机不使用这些权重。' : '下一次微调摇号使用此规则；已生成的号码不受影响。'}`;
    for (const color of ['red', 'blue']) {
      const root = $(`${color}-weights`); root.replaceChildren();
      for (const row of data.weights[color]) {
        const cell = document.createElement('div'); cell.className = `weight-cell ${row.weight > 10000 ? 'up' : row.weight < 10000 ? 'down' : ''}`;
        cell.title = `近10期 ${row.recent} 次 / 此前10期 ${row.previous} 次 / 差值 ${row.delta}`;
        const number = document.createElement('strong'); number.textContent = format(row.number);
        const weight = document.createElement('span'); weight.textContent = `${(row.weight / 10000).toFixed(3)}×`;
        cell.append(number, weight); root.append(cell);
      }
    }
  } catch (error) {
    if (sequence === weightRequest) $('weights-note').textContent = error.message;
  }
}

$('draw').addEventListener('click', draw);
$('minus').addEventListener('click', () => { $('count').value = String(Math.max(1, countValue() - 1)); });
$('plus').addEventListener('click', () => { $('count').value = String(Math.min(20, countValue() + 1)); });
$('count').addEventListener('change', () => { $('count').value = String(countValue()); });
document.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener('change', () => {
  updateControls(); if ($('weights-details').open) loadWeights();
}));
$('strength').addEventListener('input', () => {
  $('strength-value').replaceChildren(document.createTextNode(`±${$('strength').value}`));
  const percent = document.createElement('span'); percent.textContent = '%'; $('strength-value').append(percent);
  updateControls(); clearTimeout(weightTimer);
  if ($('weights-details').open) weightTimer = setTimeout(loadWeights, 180);
});
$('interval').addEventListener('change', async () => {
  try { await api('api/settings', { interval_hours: Number($('interval').value) }); await loadState(); toast('自动更新周期已保存'); }
  catch (error) { toast(error.message); await loadState(); }
});
$('refresh').addEventListener('click', async () => {
  try {
    $('refresh').disabled = true;
    await api('api/refresh', {}); await loadState();
    for (let attempt = 0; attempt < 12 && state?.refreshing; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000)); await loadState();
    }
    if (state?.weighted_available && !state.refreshing) toast('真实开奖数据已更新');
  } catch (error) { toast(error.message); updateControls(); }
});
$('copy').addEventListener('click', () => { if (current) copyText(plainText(current)); });
$('plain-output').addEventListener('click', () => $('plain-output').select());
$('export').addEventListener('click', () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...current, plain_text: plainText(current) }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `yiyao-${current.batch_id}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast('已导出号码、权重快照与批次记录');
});
$('weights-details').addEventListener('toggle', () => { if ($('weights-details').open) loadWeights(); });
if (batches.length) renderBatch(batches[0]);
loadState();
setInterval(loadState, 30000);
