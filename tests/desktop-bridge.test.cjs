'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FocusTimer } = require('../timer-engine.js');
const { connect, nativeSchedule } = require('../desktop-bridge.js');

function fixture(invoke) {
  let now = 1_800_000_000_000;
  const timer = new FocusTimer({ storage: null, now: () => now });
  const calls = [], listeners = new Map(), notices = [];
  const bridge = {
    core: { invoke: async (command, args) => {
      calls.push({ command, args });
      if (invoke) return invoke(command, args);
    } },
    event: { listen: async (name, handler) => { listeners.set(name, handler); return () => listeners.delete(name); } }
  };
  const desktop = connect(timer, { bridge, onNotice: message => notices.push(message) });
  return { timer, calls, listeners, notices, desktop, advance(ms) { now += ms; }, now: () => now };
}

test('a browser runs without the desktop bridge', () => {
  const timer = new FocusTimer({ storage: null });
  assert.deepEqual(connect(timer), { active: false, nativeReminders: false });
  assert.equal(nativeSchedule(timer.getSnapshot()), null);
});

test('native timing receives the exact deadline and is cancelled on pause without per-second rescheduling', async () => {
  const f = fixture();
  await f.desktop.flush();
  f.timer.setSettings({ focusMinutes: 1, breakMinutes: 1, rounds: 2 });
  f.timer.setTask('阅读第三章');
  f.timer.start();
  await f.desktop.flush();
  const start = f.calls.at(-1).args.schedule;
  assert.equal(start.deadlineMs, f.now() + 60_000);
  assert.equal(start.task, '阅读第三章');
  assert.ok(start.sessionId);
  const count = f.calls.length;
  f.advance(1_000);
  f.timer.tick();
  await f.desktop.flush();
  assert.equal(f.calls.length, count);
  f.timer.pause();
  await f.desktop.flush();
  assert.equal(f.calls.at(-1).args.schedule, null);
});

test('rapid start, pause and resume messages retain their order while IPC is pending', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let first = true;
  const f = fixture(async () => { if (first) { first = false; await gate; } });
  f.timer.start();
  f.timer.pause();
  f.timer.start();
  release();
  await f.desktop.flush();
  assert.deepEqual(f.calls.map(call => call.args.schedule !== null), [false, true, false, true]);
});

test('a native deadline event catches up history and synchronizes the next phase and sound setting', async () => {
  const f = fixture();
  f.timer.setSettings({ focusMinutes: 1, breakMinutes: 1, rounds: 2, soundEnabled: false });
  f.timer.start();
  await f.desktop.flush();
  f.advance(60_000);
  f.listeners.get('desktop:tick')({ payload: null });
  await f.desktop.flush();
  assert.equal(f.timer.getSnapshot().stats.todayRounds, 1);
  const next = f.calls.at(-1).args.schedule;
  assert.equal(next.phase, 'break');
  assert.equal(next.deadlineMs, f.now() + 60_000);
  assert.equal(next.soundEnabled, false);
  f.listeners.get('desktop:notice')({ payload: '通知测试' });
  assert.equal(f.notices.at(-1), '通知测试');
});

test('failed IPC enables page reminders and retries on the next update without repeated warnings', async () => {
  let failing = true;
  const f = fixture(async () => { if (failing) throw Error('disconnected'); });
  await f.desktop.flush();
  assert.equal(f.desktop.nativeReminders, false);
  assert.equal(f.notices.length, 1);
  f.timer.start();
  await f.desktop.flush();
  assert.equal(f.notices.length, 1);
  failing = false;
  f.advance(1_000);
  f.timer.tick();
  await f.desktop.flush();
  assert.equal(f.desktop.nativeReminders, true);
});

test('desktop fullscreen uses the native window command', async () => {
  const f = fixture();
  await f.desktop.flush();
  await f.desktop.setFullscreen(true);
  assert.deepEqual(f.calls.at(-1), { command: 'set_immersive', args: { enabled: true } });
});
