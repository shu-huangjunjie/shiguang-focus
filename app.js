(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const timer = new FocusTimer();
  let view = timer.getSnapshot();
  let historyKey = null;
  let previewKey = null;
  let dateKey = '';
  let titleKey = '';
  let toastTimeout;
  let audioContext = null;
  let lastChime = -Infinity;
  let immersive = false;
  let nativeFullscreen = false;
  const inputs = { focusMinutes: $('focus-minutes'), breakMinutes: $('break-minutes'), rounds: $('rounds') };
  const limits = { focusMinutes: [1, 180], breakMinutes: [1, 60], rounds: [1, 12] };
  const presetButtons = [...document.querySelectorAll('.preset-btn')];
  const stepButtons = [...document.querySelectorAll('.step-btn')];
  const clockFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

  function text(id, value) {
    const element = $(id);
    const next = String(value);
    if (element.textContent !== next) element.textContent = next;
  }
  function timeString(milliseconds) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function durationString(minutes) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours} 小时${rest ? ` ${rest} 分钟` : ''}` : `${rest} 分钟`;
  }
  function toast(message) {
    clearTimeout(toastTimeout);
    text('toast', message);
    $('toast').hidden = false;
    toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 6500);
  }
  function check(result) {
    if (!result.ok && result.message) toast(result.message);
    return result.ok;
  }
  function applySettings(patch, source) {
    const result = timer.setSettings(patch);
    if (!check(result)) {
      if (source && source.type === 'number') source.value = view.settings[source.dataset.setting];
      if (source && source.type === 'checkbox') source.checked = view.settings.autoAdvance;
    }
  }

  function makeIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    svg.classList.add('icon');
    svg.setAttribute('aria-hidden', 'true');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }
  function renderHistory(current) {
    const key = current.todayHistory.map(record => record.id).join('|');
    if (key === historyKey) return;
    historyKey = key;
    text('history-count', `${current.todayHistory.length} 段`);
    $('history-list').hidden = !current.todayHistory.length;
    $('history-empty').hidden = Boolean(current.todayHistory.length);
    const fragment = document.createDocumentFragment();
    for (const record of current.todayHistory) {
      const item = document.createElement('li');
      item.className = 'history-item';
      const mark = document.createElement('span');
      mark.className = 'history-mark';
      mark.append(makeIcon('check'));
      const task = document.createElement('div');
      task.className = 'history-task';
      task.textContent = record.task || '未命名专注';
      task.title = task.textContent;
      const time = document.createElement('time');
      time.className = 'history-time';
      time.dateTime = new Date(record.endedAt).toISOString();
      time.textContent = clockFormat.format(record.endedAt);
      time.title = '完成时间';
      const duration = document.createElement('span');
      duration.className = 'history-duration';
      duration.textContent = `${record.minutes} 分钟`;
      item.append(mark, task, time, duration);
      fragment.append(item);
    }
    $('history-list').replaceChildren(fragment);
  }
  function renderPreview(current) {
    const settings = current.settings;
    const key = [settings.focusMinutes, settings.breakMinutes, settings.rounds, current.round, current.phase, current.status].join('|');
    if (key === previewKey) return;
    previewKey = key;
    const minutes = settings.focusMinutes * settings.rounds + settings.breakMinutes * (settings.rounds - 1);
    text('total-plan', durationString(minutes));
    $('plan-track').setAttribute('aria-label', `${settings.rounds} 轮学习，每轮 ${settings.focusMinutes} 分钟，中间休息 ${settings.breakMinutes} 分钟，总计 ${durationString(minutes)}`);
    const fragment = document.createDocumentFragment();
    for (let round = 1; round <= settings.rounds; round++) {
      for (const phase of ['focus', 'break']) {
        if (phase === 'break' && round === settings.rounds) continue;
        const segment = document.createElement('span');
        segment.className = `plan-segment ${phase}`;
        segment.style.flexGrow = phase === 'focus' ? settings.focusMinutes : settings.breakMinutes;
        segment.title = `第 ${round} 轮${phase === 'focus' ? '学习' : '休息'}：${phase === 'focus' ? settings.focusMinutes : settings.breakMinutes} 分钟`;
        const done = current.status === 'completed' || round < current.round ||
          (phase === 'focus' && round === current.round && current.phase === 'break');
        segment.classList.toggle('is-done', done);
        segment.classList.toggle('is-current', !done && round === current.round && phase === current.phase);
        fragment.append(segment);
      }
    }
    $('plan-track').replaceChildren(fragment);
  }

  function render(current) {
    view = current;
    const isBreak = current.phase === 'break';
    const formatted = timeString(current.remainingMs);
    document.body.dataset.phase = current.phase;
    document.body.dataset.status = current.status;
    text('countdown', formatted);
    $('countdown').classList.toggle('long-countdown', formatted.length >= 6);
    text('phase-title', isBreak ? '休息时间' : '学习时间');
    text('timer-caption', current.status === 'completed' ? '认真投入，值得被记住' : isBreak ? '松一松，再出发' : '此刻，只做一件事');
    const status = {
      idle: '准备专注', running: isBreak ? '休息一下' : '正在专注',
      paused: '已暂停', waiting: '等待开始', completed: '本组已完成'
    };
    text('status-label', status[current.status]);
    text('round-label', `第 ${current.round} / ${current.totalRounds} 轮`);
    $('progress-circle').style.strokeDashoffset = String(100 - current.progress * 100);
    $('timer-progress').setAttribute('aria-valuenow', String(Math.round(current.progress * 100)));
    $('timer-progress').setAttribute('aria-valuetext', `${isBreak ? '休息' : '学习'}剩余 ${formatted}`);
    const startText = current.status === 'running' ? '暂停' : current.status === 'completed' ? '再来一组'
      : current.status === 'paused' ? (isBreak ? '继续休息' : '继续专注') : (isBreak ? '开始休息' : '开始专注');
    text('start-text', startText);
    $('start-icon').setAttribute('href', current.status === 'running' ? '#i-pause' : '#i-play');
    text('next-label', current.status === 'completed' ? '这一组完成了，好好休息一下。'
      : current.nextPhase === 'break' ? `下一步：休息 ${current.settings.breakMinutes} 分钟`
      : current.nextPhase === 'focus' ? `下一步：学习 ${current.settings.focusMinutes} 分钟`
      : '这是最后一轮，专注到终点。');
    $('skip-btn').hidden = !(isBreak && current.planLocked);
    $('plan-fields').disabled = current.planLocked;
    $('lock-note').hidden = !current.planLocked;
    if (document.activeElement !== $('task-input') && $('task-input').value !== current.task) $('task-input').value = current.task;
    for (const [key, input] of Object.entries(inputs)) {
      if (document.activeElement !== input && input.value !== String(current.settings[key])) input.value = current.settings[key];
    }
    $('auto-advance').checked = current.settings.autoAdvance;
    for (const button of presetButtons) {
      const active = Number(button.dataset.focus) === current.settings.focusMinutes && Number(button.dataset.break) === current.settings.breakMinutes;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const button of stepButtons) {
      const value = current.settings[button.dataset.key];
      const [min, max] = limits[button.dataset.key];
      button.disabled = current.planLocked || (Number(button.dataset.delta) < 0 ? value <= min : value >= max);
    }
    $('sound-btn').setAttribute('aria-pressed', String(current.settings.soundEnabled));
    $('sound-btn').setAttribute('aria-label', current.settings.soundEnabled ? '关闭声音提醒' : '开启声音提醒');
    $('sound-icon').setAttribute('href', current.settings.soundEnabled ? '#i-sound' : '#i-mute');
    text('sound-state', current.settings.soundEnabled ? '提示音已开' : '提示音已关');
    text('save-text', current.storageAvailable ? '本地保存' : '仅本次会话');
    $('save-label').classList.toggle('storage-warning', !current.storageAvailable);
    $('save-label').title = current.storageAvailable ? '设置和已完成的记录保存在当前浏览器中' : '浏览器无法保存数据，刷新后将无法恢复进度';
    text('stat-today-minutes', current.stats.todayMinutes);
    text('stat-today-rounds', current.stats.todayRounds);
    text('stat-total-minutes', current.stats.totalMinutes);
    renderPreview(current);
    renderHistory(current);
    const now = new Date();
    if (dateKey !== now.toDateString()) {
      dateKey = now.toDateString();
      text('local-date', dateFormat.format(now));
      $('local-date').dateTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
    const title = current.planLocked ? `${formatted} · ${isBreak ? '休息' : '专注'}${current.status === 'paused' ? '已暂停' : ''} | 拾光` : '拾光 · Focus On';
    if (title !== titleKey) { document.title = title; titleKey = title; }
  }

  async function prepareAudio() {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      if (!audioContext || audioContext.state === 'closed') audioContext = new Audio();
      if (audioContext.state === 'suspended') await audioContext.resume();
    } catch (_) { /* Timing remains available if the browser blocks audio. */ }
  }
  function chime() {
    if (desktop.nativeReminders) return;
    if (!view.settings.soundEnabled || !audioContext || audioContext.state !== 'running') return;
    const now = performance.now();
    if (now - lastChime < 1500) return;
    lastChime = now;
    try {
      const start = audioContext.currentTime;
      [523.25, 659.25].forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const volume = audioContext.createGain();
        const at = start + index * .19;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        volume.gain.setValueAtTime(0, at);
        volume.gain.linearRampToValueAtTime(.085, at + .025);
        volume.gain.exponentialRampToValueAtTime(.0001, at + .65);
        oscillator.connect(volume);
        volume.connect(audioContext.destination);
        oscillator.start(at);
        oscillator.stop(at + .7);
        oscillator.onended = () => { oscillator.disconnect(); volume.disconnect(); };
      });
    } catch (_) { /* Audio is optional. */ }
  }
  function toggleTimer() {
    if (view.settings.soundEnabled) void prepareAudio();
    check(view.status === 'running' ? timer.pause() : timer.start());
  }
  function setImmersive(next) {
    immersive = next;
    document.body.classList.toggle('immersive', next);
    text('fullscreen-label', next ? '退出沉浸' : '沉浸模式');
    $('fullscreen-btn').setAttribute('aria-pressed', String(next));
    $('fullscreen-btn').title = next ? '退出沉浸模式（Esc）' : '沉浸模式';
    $('fullscreen-icon').setAttribute('href', next ? '#i-collapse' : '#i-expand');
  }
  async function toggleFullscreen() {
    if (desktop.active) {
      setImmersive(!immersive);
      try { await desktop.setFullscreen(immersive); }
      catch (_) { toast(immersive ? '已进入页面沉浸模式，系统全屏暂不可用。' : '系统全屏暂不可用。'); }
      return;
    }
    if (immersive) {
      setImmersive(false);
      if (document.fullscreenElement && document.exitFullscreen) {
        try { await document.exitFullscreen(); } catch (_) { /* The layout is already restored. */ }
      }
    } else {
      setImmersive(true);
      if (document.documentElement.requestFullscreen) {
        try { await document.documentElement.requestFullscreen(); nativeFullscreen = Boolean(document.fullscreenElement); }
        catch (_) { /* Keep CSS immersive mode when native fullscreen is unavailable. */ }
      }
    }
  }

  $('start-btn').addEventListener('click', toggleTimer);
  $('task-input').addEventListener('input', event => timer.setTask(event.target.value));
  for (const [key, input] of Object.entries(inputs)) {
    input.dataset.setting = key;
    input.addEventListener('input', () => {
      const value = input.value.trim() === '' ? NaN : Number(input.value);
      const [min, max] = limits[key];
      if (Number.isInteger(value) && value >= min && value <= max) applySettings({ [key]: value });
    });
    input.addEventListener('change', () => {
      const value = input.value.trim() === '' ? NaN : Number(input.value);
      applySettings({ [key]: value }, input);
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') input.blur(); });
  }
  for (const button of stepButtons) button.addEventListener('click', () => {
    const key = button.dataset.key;
    applySettings({ [key]: view.settings[key] + Number(button.dataset.delta) });
  });
  for (const button of presetButtons) button.addEventListener('click', () => {
    applySettings({ focusMinutes: Number(button.dataset.focus), breakMinutes: Number(button.dataset.break) });
  });
  $('auto-advance').addEventListener('change', event => applySettings({ autoAdvance: event.target.checked }, event.target));
  $('sound-btn').addEventListener('click', () => {
    const enabled = !view.settings.soundEnabled;
    if (enabled) void prepareAudio();
    check(timer.setSettings({ soundEnabled: enabled }));
  });
  $('fullscreen-btn').addEventListener('click', () => { void toggleFullscreen(); });
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) { nativeFullscreen = true; setImmersive(true); }
    else if (nativeFullscreen) { nativeFullscreen = false; setImmersive(false); }
  });
  $('reset-btn').addEventListener('click', () => {
    if (view.planLocked) {
      $('reset-dialog').showModal();
      $('cancel-reset-btn').focus();
    } else check(timer.reset());
  });
  $('cancel-reset-btn').addEventListener('click', () => $('reset-dialog').close());
  $('confirm-reset-btn').addEventListener('click', () => {
    check(timer.reset());
    $('reset-dialog').close();
    toast('已经重新准备好了，按自己的节奏开始。');
  });
  $('reset-dialog').addEventListener('close', () => $('reset-btn').focus());
  $('skip-btn').addEventListener('click', () => {
    if (view.settings.soundEnabled) void prepareAudio();
    check(timer.skipBreak());
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && immersive && !document.fullscreenElement && !$('reset-dialog').open) {
      setImmersive(false);
      if (desktop.active) desktop.setFullscreen(false).catch(() => {});
    }
    if (event.code !== 'Space' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || $('reset-dialog').open) return;
    const target = event.target;
    if (target instanceof Element && (target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"])'))) return;
    event.preventDefault();
    toggleTimer();
  });
  document.addEventListener('visibilitychange', () => timer.tick());
  const desktop = window.FocusDesktop ? window.FocusDesktop.connect(timer, { onNotice: toast }) : { active: false, nativeReminders: false };
  if (desktop.active) text('desktop-note', '关闭窗口后仍在托盘计时 · 右键托盘图标可退出');
  render(view);
  timer.subscribe((current, event) => {
    render(current);
    if (!event) return;
    if (event.type === 'phase-complete') {
      const waiting = current.status === 'waiting';
      toast(event.phase === 'focus'
        ? `这一轮完成了，${waiting ? '准备休息' : '休息'} ${current.settings.breakMinutes} 分钟。`
        : `休息结束，${waiting ? '准备开始' : '开始'}第 ${current.round} 轮学习。`);
      chime();
    } else if (event.type === 'plan-complete') {
      toast(`这一组专注完成了！今天已专注 ${current.stats.todayMinutes} 分钟，好好休息一下。`);
      chime();
    }
  });
  timer.tick();
  setInterval(() => timer.tick(), 250);
})();
