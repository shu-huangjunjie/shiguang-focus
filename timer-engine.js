(function (root, factory) {
  'use strict';
  const FocusTimer = factory();
  if (typeof module === 'object' && module.exports) module.exports = { FocusTimer };
  else root.FocusTimer = FocusTimer;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'focus-on-tools:v1';
  const MINUTE = 60000;
  const DEFAULTS = Object.freeze({
    focusMinutes: 25, breakMinutes: 5, rounds: 4,
    autoAdvance: true, soundEnabled: true
  });
  const LIMITS = { focusMinutes: [1, 180], breakMinutes: [1, 60], rounds: [1, 12] };
  const validNumber = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  const dateKey = time => {
    const date = new Date(time);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };
  function normalizeSettings(value) {
    const result = { ...DEFAULTS };
    if (!value || typeof value !== 'object') return result;
    for (const [key, limits] of Object.entries(LIMITS)) {
      if (validNumber(value[key], ...limits)) result[key] = value[key];
    }
    for (const key of ['autoAdvance', 'soundEnabled']) {
      if (typeof value[key] === 'boolean') result[key] = value[key];
    }
    return result;
  }
  function defaultStorage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; }
    catch (_) { return null; }
  }
  class FocusTimer {
    constructor(options = {}) {
      this._now = options.now || Date.now;
      this._storage = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage : defaultStorage();
      this.storageAvailable = Boolean(this._storage);
      this._listeners = new Set();
      this.settings = { ...DEFAULTS };
      this.task = '';
      this.history = [];
      this.plan = null;
      this._idle();
      this._restore();
    }

    _idle() {
      this.plan = null;
      this.phase = 'focus';
      this.status = 'idle';
      this.round = 1;
      this.durationMs = this.settings.focusMinutes * MINUTE;
      this.remainingMs = this.durationMs;
      this.deadline = null;
      this.phaseStartedAt = null;
    }

    _restore() {
      if (!this._storage) return;
      let saved;
      try { saved = JSON.parse(this._storage.getItem(KEY) || 'null'); }
      catch (error) {
        if (!(error instanceof SyntaxError)) this.storageAvailable = false;
        return;
      }
      if (!saved || saved.version !== 1) return;
      this.settings = normalizeSettings(saved.settings);
      this.task = typeof saved.task === 'string' ? saved.task.slice(0, 80) : '';
      const seen = new Set();
      this.history = (Array.isArray(saved.history) ? saved.history : [])
        .filter(record => {
          if (!record || typeof record.id !== 'string' || seen.has(record.id) ||
              !validNumber(record.minutes, 1, 180) ||
              !Number.isFinite(record.endedAt) || record.endedAt <= 0 || record.endedAt > 8640000000000000 ||
              !Number.isFinite(record.startedAt) || record.startedAt <= 0 || record.startedAt > record.endedAt) return false;
          seen.add(record.id);
          return true;
        })
        .map(record => ({
          id: record.id.slice(0, 120), task: String(record.task || '').slice(0, 80),
          minutes: record.minutes, endedAt: record.endedAt, startedAt: record.startedAt,
          round: validNumber(record.round, 1, 12) ? record.round : 1,
          sessionId: typeof record.sessionId === 'string' ? record.sessionId.slice(0, 100) : ''
        }))
        .sort((a, b) => b.endedAt - a.endedAt).slice(0, 5000);
      this._idle();
      const state = saved.active;
      if (!state || !state.plan || typeof state.plan.id !== 'string') return;
      const plan = state.plan;
      if (!Object.entries(LIMITS).every(([key, limits]) => validNumber(plan[key], ...limits)) ||
          typeof plan.autoAdvance !== 'boolean' ||
          !['running', 'paused', 'waiting', 'completed'].includes(state.status) ||
          !['focus', 'break'].includes(state.phase) ||
          !validNumber(state.round, 1, plan.rounds) ||
          (state.phase === 'break' && state.round === plan.rounds)) return;
      const duration = (state.phase === 'focus' ? plan.focusMinutes : plan.breakMinutes) * MINUTE;
      if (state.status === 'running' && (!Number.isFinite(state.deadline) || state.deadline <= 0 ||
          state.deadline - this._now() > duration + 1000)) return;
      if (state.status === 'paused' && (!Number.isFinite(state.remainingMs) ||
          state.remainingMs < 0 || state.remainingMs > duration)) return;
      this.plan = {
        id: plan.id.slice(0, 100), focusMinutes: plan.focusMinutes,
        breakMinutes: plan.breakMinutes, rounds: plan.rounds, autoAdvance: plan.autoAdvance
      };
      this.status = state.status;
      this.phase = state.phase;
      this.round = state.round;
      this.durationMs = duration;
      this.remainingMs = state.status === 'paused' ? state.remainingMs : duration;
      this.deadline = state.status === 'running' ? state.deadline : null;
      this.phaseStartedAt = Number.isFinite(state.phaseStartedAt) && state.phaseStartedAt > 0
        ? state.phaseStartedAt : this._now();
      if (this.status === 'completed') {
        this.phase = 'focus';
        this.round = plan.rounds;
        this.durationMs = plan.focusMinutes * MINUTE;
        this.remainingMs = 0;
      }
    }

    _persist() {
      if (!this._storage || !this.storageAvailable) return;
      try {
        this._storage.setItem(KEY, JSON.stringify({
          version: 1, settings: this.settings, task: this.task, history: this.history,
          active: this.plan ? {
            plan: this.plan, phase: this.phase, status: this.status, round: this.round,
            remainingMs: this.remainingMs, deadline: this.deadline, phaseStartedAt: this.phaseStartedAt
          } : null
        }));
      } catch (_) { this.storageAvailable = false; }
    }

    subscribe(listener) {
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    }

    _emit(event = null, persist = true) {
      if (persist) this._persist();
      const snapshot = this.getSnapshot();
      for (const listener of this._listeners) listener(snapshot, event);
    }

    getSnapshot() {
      const now = this._now();
      const remaining = this.status === 'running'
        ? Math.max(0, Math.min(this.durationMs, this.deadline - now)) : this.remainingMs;
      const today = dateKey(now);
      const todayHistory = this.history.filter(record => dateKey(record.endedAt) === today);
      const totalRounds = this.plan ? this.plan.rounds : this.settings.rounds;
      return {
        settings: { ...this.settings }, task: this.task, phase: this.phase, status: this.status,
        sessionId: this.plan ? this.plan.id : null, deadline: this.deadline,
        round: this.round, totalRounds, remainingMs: remaining, durationMs: this.durationMs,
        progress: Math.max(0, Math.min(1, 1 - remaining / this.durationMs)),
        planLocked: ['running', 'paused', 'waiting'].includes(this.status),
        nextPhase: this.status === 'completed' ? null : this.phase === 'break' ? 'focus'
          : this.round < totalRounds ? 'break' : null,
        stats: {
          todayMinutes: todayHistory.reduce((total, record) => total + record.minutes, 0),
          todayRounds: todayHistory.length,
          totalMinutes: this.history.reduce((total, record) => total + record.minutes, 0),
          totalRounds: this.history.length
        },
        history: this.history.map(record => ({ ...record })),
        todayHistory: todayHistory.map(record => ({ ...record })),
        storageAvailable: this.storageAvailable
      };
    }

    setSettings(patch) {
      if (!patch || typeof patch !== 'object') return { ok: false, message: '请填写有效的设置。' };
      for (const [key, limits] of Object.entries(LIMITS)) {
        if (Object.prototype.hasOwnProperty.call(patch, key) && !validNumber(patch[key], ...limits)) {
          const name = { focusMinutes: '学习时长', breakMinutes: '休息时长', rounds: '循环轮数' }[key];
          return { ok: false, message: `${name}请填写 ${limits[0]}–${limits[1]} 之间的整数。` };
        }
      }
      for (const key of ['autoAdvance', 'soundEnabled']) {
        if (Object.prototype.hasOwnProperty.call(patch, key) && typeof patch[key] !== 'boolean') {
          return { ok: false, message: '请选择有效的开关状态。' };
        }
      }
      const keys = [...Object.keys(LIMITS), 'autoAdvance', 'soundEnabled'];
      const changed = keys.filter(key => Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== this.settings[key]);
      if (!changed.length) return { ok: true };
      if (this.getSnapshot().planLocked && changed.some(key => key !== 'soundEnabled')) {
        return { ok: false, message: '结束当前计划后，就可以调整节奏。' };
      }
      for (const key of changed) this.settings[key] = patch[key];
      if (changed.some(key => key !== 'soundEnabled')) this._idle();
      this._emit({ type: 'settings-changed' });
      return { ok: true };
    }

    setTask(task) {
      const next = String(task == null ? '' : task).slice(0, 80);
      if (this.task === next) return { ok: true };
      this.task = next;
      this._emit();
      return { ok: true };
    }

    start() {
      if (this.status === 'running') return { ok: true };
      const now = this._now();
      if (this.status === 'idle' || this.status === 'completed') {
        this.plan = {
          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID()
            : `${now}-${Math.random().toString(36).slice(2)}`,
          focusMinutes: this.settings.focusMinutes, breakMinutes: this.settings.breakMinutes,
          rounds: this.settings.rounds, autoAdvance: this.settings.autoAdvance
        };
        this.phase = 'focus';
        this.round = 1;
        this.durationMs = this.plan.focusMinutes * MINUTE;
        this.remainingMs = this.durationMs;
        this.phaseStartedAt = now;
      } else if (this.status === 'waiting') {
        this.phaseStartedAt = now;
      }
      this.status = 'running';
      this.deadline = now + this.remainingMs;
      this._emit({ type: 'phase-start', phase: this.phase });
      return { ok: true };
    }

    pause() {
      this.tick();
      if (this.status !== 'running') return { ok: false, message: '当前没有正在计时的阶段。' };
      this.remainingMs = Math.max(0, this.deadline - this._now());
      this.deadline = null;
      this.status = 'paused';
      this._emit();
      return { ok: true };
    }

    reset() {
      this.tick();
      this._idle();
      this._emit({ type: 'reset' });
      return { ok: true };
    }

    _beginPhase(phase, boundary) {
      this.phase = phase;
      this.durationMs = (phase === 'focus' ? this.plan.focusMinutes : this.plan.breakMinutes) * MINUTE;
      this.remainingMs = this.durationMs;
      this.status = this.plan.autoAdvance ? 'running' : 'waiting';
      this.phaseStartedAt = this.plan.autoAdvance ? boundary : null;
      this.deadline = this.plan.autoAdvance ? boundary + this.durationMs : null;
    }

    _finishPhase(boundary) {
      const finished = this.phase;
      if (finished === 'focus') {
        const id = `${this.plan.id}:${this.round}`;
        if (!this.history.some(record => record.id === id)) {
          this.history.unshift({
            id, task: this.task.trim(), minutes: this.plan.focusMinutes,
            startedAt: Math.min(this.phaseStartedAt || boundary, boundary), endedAt: boundary,
            round: this.round, sessionId: this.plan.id
          });
          this.history = this.history.slice(0, 5000);
        }
        if (this.round === this.plan.rounds) {
          this.status = 'completed';
          this.remainingMs = 0;
          this.deadline = null;
          this._emit({ type: 'plan-complete', phase: 'focus', nextPhase: null });
          return;
        }
        this._beginPhase('break', boundary);
      } else {
        this.round += 1;
        this._beginPhase('focus', boundary);
      }
      this._emit({ type: 'phase-complete', phase: finished, nextPhase: this.phase });
    }

    tick() {
      const now = this._now();
      // At most 23 phases exist in a valid plan. Deadlines, rather than interval
      // counts, let suspended/background tabs catch up without losing time.
      let transitions = 0;
      while (this.status === 'running' && this.deadline <= now && transitions < 24) {
        const boundary = this.deadline;
        this._finishPhase(boundary);
        transitions += 1;
      }
      if (this.status === 'running') this.remainingMs = Math.max(0, this.deadline - now);
      this._emit(null, false);
    }

    skipBreak() {
      this.tick();
      if (this.phase !== 'break' || !this.getSnapshot().planLocked) {
        return { ok: false, message: '只有休息阶段可以跳过。' };
      }
      this.round += 1;
      this._beginPhase('focus', this._now());
      this._emit({ type: 'phase-start', phase: 'focus' });
      return { ok: true };
    }
  }
  return FocusTimer;
});
