'use strict';

const $ = (id) => document.getElementById(id);
const format = (n) => String(n).padStart(2, '0');
const DRAWS_PER_YEAR = 156;
const TICKET_COST = 2;
const TOTAL_COMBINATIONS = 17721088;
const TRIAL_ATTEMPTS_PER_FRAME = 10000;
const RANDOM_BUFFER_SIZE = 4096;

let state = null;
let target = null;
let targetRed = new Uint8Array(34);
let randomWords = new Uint32Array(RANDOM_BUFFER_SIZE);
let randomIndex = randomWords.length;
let redUsed = new Uint8Array(34);
let redScratch = new Array(6);
let redPool = new Uint8Array(33);
let redPoolWeights = new Uint32Array(33);
let redWeights = new Uint32Array(33).fill(10000);
let blueWeights = new Uint32Array(16).fill(10000);
let weightsReady = false;
let lastBlue = 0;
let periods = 0;
let running = false;
let hit = false;
const prizeCounts = {2: 0, 3: 0, 4: 0, 5: 0, 6: 0};

function toast(message) {
  $('trial-toast').textContent = message;
  $('trial-toast').hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $('trial-toast').hidden = true; }, 3300);
}

async function api(path) {
  const response = await fetch(path, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function targetFromState(nextState) {
  const requested = new URLSearchParams(location.search).get('issue');
  return nextState.latest3.find((draw) => draw.issue === requested) || nextState.latest3[0] || null;
}

function renderTicket(root, red, blue, empty = false) {
  const values = empty ? Array(7).fill('--') : [...red, blue].map(format);
  [...root.children].forEach((element, index) => {
    element.textContent = values[index];
    element.classList.toggle('empty', empty);
  });
}

function renderTarget() {
  $('trial-target-issue').textContent = target ? `第${target.issue}期` : '无有效数据';
  $('trial-target-numbers').textContent = target ? `${target.red.map(format).join(' ')} + ${format(target.blue)}` : '-- -- -- -- -- -- + --';
}

function updateStats() {
  $('trial-periods').textContent = periods.toLocaleString('zh-CN');
  $('trial-years').textContent = (periods / DRAWS_PER_YEAR).toFixed(2);
  $('trial-cost').textContent = (periods * TICKET_COST).toLocaleString('zh-CN');
  updatePrizeStats();
}

function updatePrizeStats() {
  for (let level = 2; level <= 6; level += 1) {
    $('trial-prize-' + level).textContent = prizeCounts[level].toLocaleString('zh-CN');
  }
}

function updateControls() {
  const weighted = document.querySelector('input[name="trial-mode"]:checked')?.value === 'weighted';
  $('trial-toggle').disabled = !target || (weighted && !weightsReady);
  $('trial-speed').disabled = running;
  document.querySelectorAll('input[name="trial-mode"]').forEach((input) => { input.disabled = running || (input.value === 'weighted' && !weightsReady); });
  $('trial-toggle').firstElementChild.textContent = running ? '停止试命' : hit ? '再试一次' : periods ? '继续试命' : '开始试命';
  $('trial-toggle').classList.toggle('trial-toggle-stop', running);
  $('trial-mode-note').textContent = weighted
    ? weightsReady ? '使用最近真实数据的轻微权重偏好；不改变中奖概率。' : '真实数据权重暂不可用，请切换纯随机。'
    : '每颗球权重相同，历史开奖不参与试算。';
}

function randomBelow(max) {
  const range = 0x100000000;
  const limit = range - (range % max);
  let value;
  do {
    if (randomIndex >= randomWords.length) {
      crypto.getRandomValues(randomWords);
      randomIndex = 0;
    }
    value = randomWords[randomIndex++];
  } while (value >= limit);
  return value % max;
}

function weightedPick(weights, size = weights.length) {
  let total = 0;
  for (let index = 0; index < size; index += 1) total += weights[index];
  if (!total) throw new Error('试命权重无效');
  let roll = randomBelow(total);
  for (let index = 0; index < size; index += 1) {
    if (roll < weights[index]) return index;
    roll -= weights[index];
  }
  throw new Error('试命抽样失败');
}

function evaluateTrialPrize(redMatches, blueMatch) {
  if (redMatches === 6 && blueMatch) return 1;
  if (redMatches === 6) return 2;
  if (redMatches === 5 && blueMatch) return 3;
  if (redMatches === 5 || (redMatches === 4 && blueMatch)) return 4;
  if (redMatches === 4 || (redMatches === 3 && blueMatch)) return 5;
  if (blueMatch) return 6;
  return 0;
}

function drawTrialTicket() {
  let matches = 0;
  const weighted = document.querySelector('input[name="trial-mode"]:checked')?.value === 'weighted';
  if (weighted) {
    for (let index = 0; index < 33; index += 1) {
      redPool[index] = index + 1;
      redPoolWeights[index] = redWeights[index];
    }
    let available = 33;
    for (let index = 0; index < 6; index += 1) {
      const poolIndex = weightedPick(redPoolWeights, available);
      const number = redPool[poolIndex];
      redScratch[index] = number;
      if (targetRed[number]) matches += 1;
      available -= 1;
      redPool[poolIndex] = redPool[available];
      redPoolWeights[poolIndex] = redPoolWeights[available];
    }
    lastBlue = weightedPick(blueWeights) + 1;
  } else {
    for (let index = 0; index < 6; index += 1) {
      let number;
      do { number = randomBelow(33) + 1; } while (redUsed[number]);
      redUsed[number] = 1;
      redScratch[index] = number;
      if (targetRed[number]) matches += 1;
    }
    lastBlue = randomBelow(16) + 1;
    for (let index = 0; index < 6; index += 1) redUsed[redScratch[index]] = 0;
  }
  const blueMatch = lastBlue === target.blue;
  return {hit: matches === 6 && blueMatch, level: evaluateTrialPrize(matches, blueMatch)};
}

function renderProgress() {
  const red = redScratch.slice().sort((a, b) => a - b);
  renderTicket($('trial-balls'), red, lastBlue);
  updateStats();
  $('trial-caption').textContent = hit ? `第${periods.toLocaleString('zh-CN')}期，遇见了目标号码。` : `已模拟 ${periods.toLocaleString('zh-CN')} 期，仍在寻找。`;
}

function stopTrial(message = '已停止') {
  running = false;
  $('trial-status').textContent = message;
  $('trial-machine').classList.remove('is-spinning');
  updateControls();
}

function runFrame() {
  if (!running) return;
  let attempts = 0;
  try {
    const limit = Math.max(1, Math.trunc(Number($('trial-speed').value)) || TRIAL_ATTEMPTS_PER_FRAME);
    while (running && attempts < limit) {
      attempts += 1;
      periods += 1;
      const result = drawTrialTicket();
      const level = result.level;
      if (level >= 2 && level <= 6) prizeCounts[level] += 1;
      if (result.hit) {
        hit = true;
        running = false;
        break;
      }
    }
  } catch (error) {
    stopTrial('随机源不可用');
    toast(error.message || '安全随机源不可用，试命已停止');
    return;
  }
  renderProgress();
  if (hit) {
    $('trial-status').textContent = '已命中';
    $('trial-machine').classList.remove('is-spinning');
    toast(`命中了第${periods.toLocaleString('zh-CN')}期模拟`);
    updateControls();
  } else if (running) {
    requestAnimationFrame(runFrame);
  } else {
    stopTrial();
  }
}

function startTrial() {
  if (!target || running) return;
  if (hit) {
    periods = 0;
    hit = false;
    for (let level = 2; level <= 6; level += 1) prizeCounts[level] = 0;
    renderTicket($('trial-balls'), [], 0, true);
  }
  running = true;
  $('trial-status').textContent = periods ? '继续试算' : '试算中';
  $('trial-machine').classList.add('is-spinning');
  updateControls();
  requestAnimationFrame(runFrame);
}

function toggleTrial() {
  if (running) {
    stopTrial();
    toast('试命已停止，可以继续');
  } else {
    startTrial();
  }
}

function loadState() {
  return api('api/state').then((nextState) => {
    state = nextState;
    target = targetFromState(state);
    if (!target) throw new Error('尚无有效的最近三期真实开奖数据');
    targetRed = new Uint8Array(34);
    target.red.forEach((number) => { targetRed[number] = 1; });
    weightsReady = false;
    document.querySelector('input[name="trial-mode"][value="weighted"]').disabled = true;
    $('trial-notice').hidden = true;
    $('trial-status').textContent = '待开始';
    $('trial-probability').textContent = `1 / ${TOTAL_COMBINATIONS.toLocaleString('zh-CN')}`;
    renderTarget(); updateStats(); updateControls();
    if (!state.weighted_available) {
      document.querySelector('input[name="trial-mode"][value="uniform"]').checked = true;
      updateControls();
      return;
    }
    return api('api/weights?strength=5').then((data) => {
      redWeights = Uint32Array.from(data.weights.red.map((row) => row.weight));
      blueWeights = Uint32Array.from(data.weights.blue.map((row) => row.weight));
      weightsReady = true;
      document.querySelector('input[name="trial-mode"][value="weighted"]').disabled = false;
      updateControls();
    }).catch((error) => {
      document.querySelector('input[name="trial-mode"][value="uniform"]').checked = true;
      $('trial-mode-note').textContent = `权重读取失败：${error.message}，已切换纯随机。`;
      updateControls();
    });
  }).catch((error) => {
    target = null;
    weightsReady = false;
    $('trial-notice').textContent = `${error.message}。不会使用模拟数据。`;
    $('trial-status').textContent = '不可用';
    renderTarget(); updateControls();
  });
}

$('trial-toggle').addEventListener('click', toggleTrial);
loadState();
