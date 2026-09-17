'use strict';

const $ = (id) => document.getElementById(id);
const format = (n) => String(n).padStart(2, '0');
const storageKey = 'yiyao.batches.v1';
const MAX_DRAW_COUNT = 20;
const MAX_ROLL_COUNT = 500000;
const MAX_TOTAL_ROLLS = 100000;
const DRAW_TIMEOUT_MS = 300000;
let state = null;
let current = null;
let busy = false;
let toastTimer;
let weightTimer;
let weightRequest = 0;
let weightSignature = '';
let batches = [];
let editingIndex = null;
let prizeCheck = null;

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

function persistBatches() {
  try { localStorage.setItem(storageKey, JSON.stringify(batches)); }
  catch { toast('号码已修改，但浏览器未允许保存记录'); }
}

function clearPrizeCheck() {
  prizeCheck = null;
  $('prize-results').hidden = true;
  $('prize-results').replaceChildren();
}

function clearCurrent() {
  if (!current || busy) return;
  current = null; editingIndex = null; clearPrizeCheck();
  const root = $('results'); root.replaceChildren(); root.className = 'results empty-results';
  const symbol = document.createElement('span'); symbol.className = 'empty-symbol'; symbol.setAttribute('aria-hidden', 'true'); symbol.textContent = '＋';
  const message = document.createElement('p'); message.textContent = '还没有号码。';
  const hint = document.createElement('small'); hint.textContent = '摇好之后，整组复制，不用一个个抄。'; message.append(document.createElement('br'), hint);
  root.append(symbol, message);
  $('result-count').textContent = '等待开始'; $('receipt').hidden = true; $('plain-details').hidden = true; $('plain-output').value = '';
  $('prize-options').hidden = true; $('fuyun').checked = false; $('copy').disabled = true; $('export').disabled = true;
  $('machine-caption').textContent = '六颗红球，一颗蓝球。准备好了就开始。'; showBalls(null); updateControls(); toast('已清空当前号码，最近批次仍保留');
}

function parseTicket(redValues, blueValue) {
  const red = redValues.map((value) => Number(value));
  const blue = Number(blueValue);
  if (red.some((n) => !Number.isInteger(n) || n < 1 || n > 33) || new Set(red).size !== 6 ||
      !Number.isInteger(blue) || blue < 1 || blue > 16) return null;
  return { red: red.sort((a, b) => a - b), blue };
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
  const timeout = path === 'api/draw' || path === 'api/reroll' ? DRAW_TIMEOUT_MS : 25000;
  const timer = setTimeout(() => controller.abort(), timeout);
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
  const target = current ? targetIssue(current) : '';
  const prizeReady = Boolean(current && target && state?.weighted_available && isIssueDrawn(target));
  $('strength').disabled = !weighted || busy;
  $('weight-tag').textContent = weighted ? '微调已启用' : '当前未启用';
  $('mode-description').textContent = weighted
    ? `历史仅作轻微偏好，单球权重最多调整 ±${$('strength').value}%。不强制分散。`
    : '每颗球权重相同。历史开奖不参与本次选择。';
  $('draw').disabled = busy || !state || (weighted && !state.weighted_available);
  $('draw-label').textContent = busy ? '正在摇号…' : !state ? '等待本地服务' : weighted && !state.weighted_available ? '请先更新数据' : '开始摇号';
  $('refresh').disabled = !state || state.refreshing;
  $('refresh').textContent = state?.refreshing ? '正在更新…' : '立即更新 ↻';
  $('roll-range-toggle').disabled = busy;
  document.querySelectorAll('.roll-range-fields input').forEach((input) => { input.disabled = busy; });
  $('check-prize').disabled = busy || !prizeReady || editingIndex !== null;
  $('check-prize').textContent = current && !prizeReady ? '等待开奖' : '自动算奖';
  $('clear').disabled = busy || !current || editingIndex !== null;
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

function updateTrialLink() {
  const link = $('trial');
  if (!link) return;
  const issue = state?.latest3?.[0]?.issue;
  link.href = issue ? `trial.html?issue=${encodeURIComponent(issue)}` : 'trial.html';
}

async function loadState() {
  try {
    state = await api('api/state');
    if (state.app_id !== 'ssq-local-draw') throw new Error('连接的不是本地摇号服务');
    $('data-status').textContent = state.weighted_available ? `${state.count}期 · 校验通过` : state.refreshing ? '更新中' : state.count ? '缓存数据 · 微调暂停' : '等待真实数据';
    $('data-status').classList.toggle('error', !state.weighted_available && !state.refreshing);
    $('checked-at').textContent = state.last_success ? `上次校验 ${dateText(state.last_success, true)}` : '尚未校验数据';
    $('next-refresh').textContent = state.refreshing ? '正在从广东福彩读取最新50期…' : `下次检查 ${dateText(state.next_refresh, true)}${state.error ? ' · 失败后10分钟重试' : ''}`;
    $('notice').hidden = state.weighted_available || (!state.error && state.refreshing);
    $('notice').textContent = state.error ? `${state.error}。微调模式暂停；你仍可主动选择纯随机。`
      : '尚无有效的最新数据，或缓存已超过24小时。微调暂停；纯随机不依赖历史数据。';
    renderHistory();
    updateTrialLink();
    renderBatchButtons();
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

function numberInput(value, className, label, max) {
  const input = document.createElement('input');
  input.type = 'number'; input.min = '1'; input.max = String(max); input.value = String(value);
  input.className = className; input.inputMode = 'numeric'; input.setAttribute('aria-label', label);
  return input;
}

function renderTicketEditor(row, ticket, index, batch) {
  const form = document.createElement('div'); form.className = 'edit-form';
  const red = document.createElement('div'); red.className = 'edit-red';
  ticket.red.forEach((value, position) => red.append(numberInput(value, 'edit-red-number', `第${index + 1}注红球${position + 1}`, 33)));
  const plus = document.createElement('span'); plus.className = 'edit-plus'; plus.textContent = '+';
  const blue = numberInput(ticket.blue, 'edit-blue-number', `第${index + 1}注蓝球`, 16);
  const actions = document.createElement('div'); actions.className = 'edit-actions';
  const save = document.createElement('button'); save.type = 'button'; save.className = 'edit-save'; save.textContent = '保存';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'edit-cancel'; cancel.textContent = '取消';
  save.addEventListener('click', () => {
    const next = parseTicket([...red.children].map((input) => input.value), blue.value);
    if (!next) { toast('红球必须为1-33且不能重复，蓝球必须为1-16'); return; }
    if (!batch.original_tickets) batch.original_tickets = batch.tickets.map((item) => ({ red: [...item.red], blue: item.blue }));
    batch.tickets[index] = next; batch.edited = true; batch.edited_at = new Date().toISOString();
    editingIndex = null; persistBatches(); clearPrizeCheck(); renderBatch(batch); toast(`第${index + 1}注已修改`);
  });
  cancel.addEventListener('click', () => { editingIndex = null; renderBatch(batch); });
  actions.append(save, cancel); form.append(red, plus, blue, actions); row.append(form);
}

async function rerollTicket(batch, index) {
  if (busy || !batch?.tickets[index]) return;
  busy = true; editingIndex = null; clearPrizeCheck(); updateControls();
  try {
    const weighted = batch.snapshot?.mode === 'weighted';
    const rollRange = batch.snapshot?.roll_range || [1, 1];
    const result = await api('api/reroll', {
      mode: weighted ? 'weighted' : 'uniform',
      strength: weighted ? Number(batch.snapshot.strength) : 0,
      roll_range: rollRange,
    });
    if (!validBatch({ tickets: [result.ticket] })) throw new Error('返回的号码格式异常，已停止替换');
    if (!batch.original_tickets) batch.original_tickets = batch.tickets.map((item) => ({ red: [...item.red], blue: item.blue }));
    batch.tickets[index] = result.ticket;
    if (Array.isArray(batch.roll_counts) && batch.roll_counts.length === batch.tickets.length) batch.roll_counts[index] = result.roll_counts?.[0] || 1;
    batch.edited = true; batch.edited_at = new Date().toISOString();
    persistBatches();
    busy = false;
    renderBatch(batch);
    toast(`第${index + 1}注已重摇，其他号码未改变`);
  } catch (error) {
    toast(error.message || '重摇失败');
  } finally {
    busy = false; updateControls();
  }
}

function renderBatch(batch) {
  if (!validBatch(batch)) return;
  current = batch;
  const root = $('results'); root.replaceChildren(); root.classList.remove('empty-results');
  batch.tickets.forEach((ticket, index) => {
    const row = document.createElement('div'); row.className = 'result-row';
    const number = document.createElement('span'); number.className = 'row-index'; number.textContent = format(index + 1);
    row.append(number);
    if (editingIndex === index) {
      renderTicketEditor(row, ticket, index, batch);
    } else {
      const text = document.createElement('span'); text.className = 'row-numbers'; text.textContent = ticket.red.map(format).join(' ');
      const plus = document.createElement('span'); plus.className = 'row-plus'; plus.textContent = '+';
      const blue = document.createElement('span'); blue.className = 'row-blue'; blue.textContent = format(ticket.blue);
      text.append(plus, blue);
      const actions = document.createElement('div'); actions.className = 'row-actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'row-edit'; edit.textContent = '修改'; edit.setAttribute('aria-label', `修改第${index + 1}注`);
      edit.addEventListener('click', () => { if (!busy) { editingIndex = index; clearPrizeCheck(); renderBatch(batch); updateControls(); } });
      const reroll = document.createElement('button'); reroll.type = 'button'; reroll.className = 'row-reroll'; reroll.textContent = '重摇'; reroll.setAttribute('aria-label', `重摇第${index + 1}注`);
      reroll.addEventListener('click', () => rerollTicket(batch, index));
      actions.append(edit, reroll); row.append(text, actions);
    }
    root.append(row);
  });
  const weighted = batch.snapshot?.mode === 'weighted';
  const issue = targetIssue(batch);
  $('result-count').textContent = `${batch.tickets.length}注 · ${weighted ? '微调加权' : '纯随机'}${batch.edited ? ' · 已修改' : ''}`;
  $('machine-caption').textContent = `首注预览 · ${dateText(batch.created_at)} · ${weighted ? '微调加权' : '纯随机'}`;
  $('receipt').hidden = false;
  const rollCounts = Array.isArray(batch.roll_counts) && batch.roll_counts.length === batch.tickets.length ? ` / 每注摇动 ${batch.roll_counts.join(',')} 次` : '';
  $('receipt').textContent = `${dateText(batch.created_at, true)} / 批次 ${batch.batch_id || ''} / 快照 ${(batch.snapshot_id || '').slice(0, 12)}${issue ? ` / 目标期号 ${issue}` : ''}${weighted ? ` / 数据期号 ${batch.snapshot.latest_issue} / 最大±${batch.snapshot.strength}%` : ' / 历史权重未参与'}${rollCounts}${batch.edited ? ' / 已手动修改' : ''}`;
  $('copy').disabled = false; $('export').disabled = false; $('plain-details').hidden = false; $('prize-options').hidden = false;
  $('plain-output').value = plainText(batch); $('plain-output').rows = Math.min(batch.tickets.length + 1, 12);
  showBalls(batch.tickets[0]); renderBatchButtons(); updateControls();
}

function nextIssue(issue) {
  if (!issue) return '';
  const value = Number(issue);
  return Number.isSafeInteger(value) ? String(value + 1).padStart(String(issue).length, '0') : '';
}

function targetIssue(batch) {
  return batch.target_issue || nextIssue(batch.snapshot?.latest_issue || batch.reference_issue || state?.latest3?.[0]?.issue);
}

function isIssueDrawn(issue) {
  const target = Number(issue);
  const latest = Number(state?.latest3?.[0]?.issue);
  return Number.isSafeInteger(target) && Number.isSafeInteger(latest) && latest >= target;
}

function batchButtonLabel(batch) {
  const issue = targetIssue(batch);
  return `${dateText(batch.created_at, true)} · ${issue ? `第${issue}期` : '未关联期号'} · ${batch.tickets.length}注`;
}

function removeBatch(batch) {
  if (busy) return;
  const index = batches.indexOf(batch);
  if (index < 0) return;
  batches.splice(index, 1);
  persistBatches(); renderBatchButtons(); toast('已删除一条最近批次记录');
}

function renderBatchButtons() {
  const root = $('batch-buttons'); root.replaceChildren();
  $('recent-batches').hidden = batches.length === 0;
  $('clear-batches').disabled = batches.length === 0 || busy;
  for (const batch of batches.slice(0, 5)) {
    const item = document.createElement('div'); item.className = 'recent-batch';
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = batchButtonLabel(batch);
    button.addEventListener('click', () => { if (!busy) { editingIndex = null; clearPrizeCheck(); renderBatch(batch); } });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'batch-delete'; remove.textContent = 'x';
    remove.setAttribute('aria-label', `删除${batchButtonLabel(batch)}`);
    remove.addEventListener('click', () => removeBatch(batch));
    item.append(button, remove); root.append(item);
  }
}

function clearBatches() {
  if (!batches.length || busy) return;
  batches = []; persistBatches(); renderBatchButtons(); toast('最近批次记录已清空');
}

function renderPrizeCheck(result) {
  const root = $('prize-results'); root.replaceChildren(); root.hidden = false;
  const heading = document.createElement('div'); heading.className = 'prize-heading';
  const title = document.createElement('strong'); title.textContent = `第${result.issue}期识别结果`;
  const summary = document.createElement('span'); summary.textContent = `${result.summary.winning}/${result.summary.total}注命中 · 固定奖金${result.summary.fixed_prize_total}元${result.summary.floating_prize_count ? ` · 浮动奖${result.summary.floating_prize_count}注` : ''}`; heading.append(title, summary);
  const draw = document.createElement('p'); draw.className = 'prize-draw';
  draw.textContent = `开奖号码：${result.winning_draw.red.map(format).join(' ')} + ${format(result.winning_draw.blue)} · 校验于 ${dateText(result.checked_at, true)}`;
  root.append(heading, draw);
  for (const item of result.results) {
    const row = document.createElement('div'); row.className = `prize-row ${item.level === '未中奖' ? 'no-prize' : 'won'}`;
    const index = document.createElement('span'); index.className = 'row-index'; index.textContent = format(result.results.indexOf(item) + 1);
    const condition = document.createElement('span'); condition.className = 'prize-condition'; condition.textContent = `${item.condition} · 红${item.red_matches} ${item.blue_match ? '蓝中' : '蓝未中'}`;
    const level = document.createElement('strong'); level.className = 'prize-level'; level.textContent = item.level;
    const amount = document.createElement('span'); amount.className = 'prize-amount'; amount.textContent = item.prize_display;
    row.append(index, condition, level, amount); root.append(row);
  }
  const note = document.createElement('small'); note.className = 'prize-note'; note.textContent = result.fuyun_active ? '已按你勾选的特别规定识别福运奖；浮动奖级具体金额以官方公告为准。' : '一等奖、二等奖为浮动奖级；其余显示固定奖金。最终以官方开奖公告为准。'; root.append(note);
}

function renderPrizePending(result) {
  const root = $('prize-results'); root.replaceChildren(); root.hidden = false;
  const heading = document.createElement('div'); heading.className = 'prize-heading';
  const title = document.createElement('strong'); title.textContent = `第${result.issue}期待开奖`;
  const summary = document.createElement('span'); summary.textContent = `当前最新第${result.latest_issue}期`; heading.append(title, summary);
  const message = document.createElement('p'); message.className = 'prize-draw'; message.textContent = `第${result.issue}期尚未发布真实开奖号码 · 数据校验于 ${dateText(result.checked_at, true)}`;
  const note = document.createElement('small'); note.className = 'prize-note'; note.textContent = '现在不能计算中奖。开奖后点击“立即更新”，再点击“自动算奖”。';
  root.append(heading, message, note);
}

async function checkPrize() {
  if (!current || editingIndex !== null || busy) return;
  const issue = targetIssue(current);
  if (!issue) { toast('当前号码没有关联待开奖期号'); return; }
  const button = $('check-prize'); button.disabled = true; button.textContent = '识别中…';
  try {
    const result = await api('api/check', { tickets: current.tickets, issue, fuyun_active: $('fuyun').checked });
    prizeCheck = result;
    if (result.pending) { renderPrizePending(result); toast(`第${result.issue}期尚未开奖`); }
    else { renderPrizeCheck(result); toast(`第${result.issue}期已完成算奖`); }
  } catch (error) { toast(error.message || '算奖失败'); }
  finally { button.textContent = '自动算奖'; updateControls(); }
}

function parseCountRange() {
  const min = Math.trunc(Number($('roll-min').value));
  const max = Math.trunc(Number($('roll-max').value));
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || min > max || max > MAX_ROLL_COUNT) return null;
  return { min, max };
}

function updateRollRangeSummary() {
  const range = parseCountRange();
  $('roll-range-summary').textContent = range ? `${range.min === range.max ? range.min : `${range.min}-${range.max}`} 次/注` : '范围有误';
}

function toggleRollRange() {
  const fields = $('roll-range-fields');
  const expanded = fields.hidden;
  fields.hidden = !expanded;
  $('roll-range-toggle').setAttribute('aria-expanded', String(expanded));
  $('roll-range-toggle').lastElementChild.textContent = expanded ? '－' : '＋';
}

function countValue() {
  const count = Math.trunc(Number($('count').value));
  return Math.max(1, Math.min(MAX_DRAW_COUNT, Number.isFinite(count) ? count : 5));
}

async function draw() {
  if (busy) return;
  const count = countValue(); $('count').value = String(count);
  const range = parseCountRange();
  if (!range) {
    toast(`摇动次数范围无效，请填写1或最小-最大（范围1-${MAX_ROLL_COUNT}）`);
    return;
  }
  if (count * range.max > MAX_TOTAL_ROLLS) {
    toast(`单次总摇动次数最多${MAX_TOTAL_ROLLS}次，当前 ${count} 注 × 每注最多 ${range.max} 次 = ${count * range.max} 次，请减少注数或摇动次数`);
    return;
  }
  busy = true; editingIndex = null; clearPrizeCheck(); updateControls();
  $('machine').classList.remove('is-revealing'); $('machine').classList.add('is-spinning'); showBalls(null);
  const rollText = range.min === range.max ? `${range.min}次` : `${range.min}-${range.max}次`;
  $('machine-caption').textContent = `交给系统随机源，正在抽取${count}注，每注摇动${rollText}…`;
  try {
    const batch = await api('api/draw', { count, mode: mode(), strength: Number($('strength').value), roll_range: [range.min, range.max] });
    if (!validBatch(batch)) throw new Error('返回的号码格式异常，已停止显示');
    batch.reference_issue = state?.latest3?.[0]?.issue || null;
    batch.target_issue = nextIssue(batch.reference_issue);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise((resolve) => setTimeout(resolve, 650));
    batches.unshift(batch); batches = batches.slice(0, 10);
    persistBatches();
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
$('plus').addEventListener('click', () => { $('count').value = String(Math.min(MAX_DRAW_COUNT, countValue() + 1)); });
$('count').addEventListener('change', () => { $('count').value = String(countValue()); });
$('roll-range-toggle').addEventListener('click', toggleRollRange);
document.querySelectorAll('.roll-range-fields input').forEach((input) => input.addEventListener('input', updateRollRangeSummary));
updateRollRangeSummary();
document.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener('change', () => {
  updateControls(); if ($('weights-details').open) loadWeights();
}));
$('strength').addEventListener('input', () => {
  $('strength-value').replaceChildren(document.createTextNode(`±${$('strength').value}`));
  const percent = document.createElement('span'); percent.textContent = '%'; $('strength-value').append(percent);
  updateControls(); clearTimeout(weightTimer);
  if ($('weights-details').open) weightTimer = setTimeout(loadWeights, 180);
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
$('check-prize').addEventListener('click', checkPrize);
$('clear').addEventListener('click', clearCurrent);
$('clear-batches').addEventListener('click', clearBatches);
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

/* 试命悬浮浮标:默认右下角跟随;滚动到真实数据区块时改为停靠形态(右缘+对齐锚点行),避免遮挡 */
(function () {
  const floatBtn = $('trial-float');
  if (!floatBtn) return;
  const anchor = $('trial');
  const pinnedClass = 'trial-float-pinned';
  const update = () => {
    if (!anchor) return;
    // 页面顶部不显示,避免遮挡;滚动后才出现
    const visible = window.scrollY > 40;
    const rect = anchor.getBoundingClientRect();
    // 锚点进入视口时停靠到其所在行(右缘吸住)
    const inView = rect.top < window.innerHeight - 20 && rect.bottom > 60;
    if (!visible) {
      floatBtn.classList.add('trial-float-hidden');
      floatBtn.classList.remove(pinnedClass);
    } else if (inView) {
      floatBtn.classList.remove('trial-float-hidden');
      const top = Math.max(rect.top, 8);
      floatBtn.style.setProperty('--trial-pin-top', top + 'px');
      floatBtn.classList.add(pinnedClass);
    } else {
      floatBtn.classList.remove('trial-float-hidden');
      floatBtn.classList.remove(pinnedClass);
    }
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
})();
