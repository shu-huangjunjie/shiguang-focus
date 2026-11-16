const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FocusTimer } = require('../timer-engine.js');

function fixture(overrides = {}) {
  let clock = new Date(2026, 10, 16, 10, 0, 0).getTime();
  const data = new Map();
  const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const now = () => clock;
  const timer = new FocusTimer({ storage, now, ...overrides });
  return { timer, storage, data, now, advance(ms) { clock += ms; timer.tick(); } };
}

test('a study plan alternates study and rest, ends after its last study, and records each completed round once', () => {
  const { timer, advance } = fixture();
  timer.setSettings({ focusMinutes: 1, breakMinutes: 2, rounds: 2 });
  timer.setTask('阅读第三章');
  timer.start();
  advance(60000);
  let view = timer.getSnapshot();
  assert.equal(view.phase, 'break');
  assert.equal(view.remainingMs, 120000);
  assert.equal(view.stats.todayRounds, 1);
  advance(120000);
  view = timer.getSnapshot();
  assert.equal(view.phase, 'focus');
  assert.equal(view.round, 2);
  advance(60000);
  advance(999999);
  view = timer.getSnapshot();
  assert.equal(view.status, 'completed');
  assert.equal(view.nextPhase, null);
  assert.equal(view.stats.todayMinutes, 2);
  assert.equal(view.history.length, 2);
  assert.equal(view.history[0].task, '阅读第三章');
});

test('pause and reload preserve exact remaining time, and resume sets a new deadline', () => {
  const f = fixture();
  f.timer.start();
  f.advance(12345);
  f.timer.pause();
  f.advance(90000);
  const restored = new FocusTimer({ storage: f.storage, now: f.now });
  assert.equal(restored.getSnapshot().status, 'paused');
  assert.equal(restored.getSnapshot().remainingMs, 1500000 - 12345);
  restored.start();
  f.advance(1234);
  assert.equal(restored.getSnapshot().remainingMs, 1500000 - 12345 - 1234);
});

test('returning after sleep catches up all deadlines without drifting or adding extra rounds', () => {
  const f = fixture();
  f.timer.setSettings({ focusMinutes: 1, breakMinutes: 1, rounds: 12 });
  f.timer.start();
  f.advance(24 * 60 * 60000);
  const view = f.timer.getSnapshot();
  assert.equal(view.status, 'completed');
  assert.equal(view.history.length, 12);
  assert.equal(view.history[0].endedAt - view.history[11].endedAt, 22 * 60000);
});

test('reload of a running timer catches up and repeated reloads do not duplicate history', () => {
  const f = fixture();
  f.timer.setSettings({ focusMinutes: 1, breakMinutes: 1, rounds: 2 });
  f.timer.start();
  f.advance(150000);
  const restored = new FocusTimer({ storage: f.storage, now: f.now });
  restored.tick();
  assert.equal(restored.getSnapshot().phase, 'focus');
  assert.equal(restored.getSnapshot().round, 2);
  assert.equal(restored.getSnapshot().remainingMs, 30000);
  assert.equal(restored.getSnapshot().history.length, 1);
  const again = new FocusTimer({ storage: f.storage, now: f.now });
  again.tick();
  assert.equal(again.getSnapshot().history.length, 1);
});

test('a closed page restores elapsed phases from its original saved deadline', () => {
  let clock = new Date(2026, 10, 16, 10).getTime();
  let saved = null;
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  const original = new FocusTimer({ storage, now: () => clock });
  original.setSettings({ focusMinutes: 1, breakMinutes: 1, rounds: 2 });
  original.start();
  clock += 150000; // No interval, visibility event, or tick occurs before reopening.
  const reopened = new FocusTimer({ storage, now: () => clock });
  reopened.tick();
  assert.equal(reopened.getSnapshot().round, 2);
  assert.equal(reopened.getSnapshot().remainingMs, 30000);
  assert.equal(reopened.getSnapshot().history.length, 1);
});

test('reset at an elapsed deadline retains the round that was already completed', () => {
  let clock = new Date(2026, 10, 16, 10).getTime();
  const timer = new FocusTimer({ storage: null, now: () => clock });
  timer.setSettings({ focusMinutes: 1, rounds: 1 });
  timer.start();
  clock += 60001;
  timer.reset();
  assert.equal(timer.getSnapshot().status, 'idle');
  assert.equal(timer.getSnapshot().history.length, 1);
});

test('manual advance waits for the user, including after long periods away', () => {
  const f = fixture();
  f.timer.setSettings({ focusMinutes: 1, breakMinutes: 1, rounds: 2, autoAdvance: false });
  f.timer.start();
  f.advance(3600000);
  let view = f.timer.getSnapshot();
  assert.equal(view.status, 'waiting');
  assert.equal(view.phase, 'break');
  assert.equal(view.remainingMs, 60000);
  assert.equal(view.history.length, 1);
  f.timer.start();
  f.advance(60000);
  view = f.timer.getSnapshot();
  assert.equal(view.status, 'waiting');
  assert.equal(view.round, 2);
  f.timer.start();
  f.advance(60000);
  assert.equal(f.timer.getSnapshot().status, 'completed');
});

test('skipping rest advances once without crediting study minutes', () => {
  const f = fixture();
  f.timer.setSettings({ focusMinutes: 1, breakMinutes: 1, rounds: 3 });
  f.timer.start();
  assert.equal(f.timer.skipBreak().ok, false);
  f.advance(60000);
  f.timer.pause();
  assert.equal(f.timer.skipBreak().ok, true);
  assert.equal(f.timer.getSnapshot().round, 2);
  assert.equal(f.timer.getSnapshot().phase, 'focus');
  assert.equal(f.timer.getSnapshot().stats.todayMinutes, 1);
  assert.equal(f.timer.skipBreak().ok, false);
});

test('active plan settings are protected; sound and task can change; reset keeps completed records', () => {
  const f = fixture();
  f.timer.setSettings({ focusMinutes: 1, rounds: 2 });
  f.timer.start();
  assert.equal(f.timer.setSettings({ focusMinutes: 10 }).ok, false);
  assert.equal(f.timer.setSettings({ autoAdvance: false }).ok, false);
  assert.equal(f.timer.setSettings({ soundEnabled: false }).ok, true);
  assert.equal(f.timer.setTask('练习英语').ok, true);
  f.advance(60000);
  f.timer.reset();
  assert.equal(f.timer.getSnapshot().status, 'idle');
  assert.equal(f.timer.getSnapshot().planLocked, false);
  assert.equal(f.timer.getSnapshot().todayHistory[0].task, '练习英语');
  assert.equal(f.timer.setSettings({ focusMinutes: 10 }).ok, true);
  assert.equal(f.timer.getSnapshot().remainingMs, 600000);
});

test('invalid and fractional durations are rejected atomically', () => {
  const { timer } = fixture();
  for (const value of [0, -1, 181, 1.5, NaN, Infinity, '25', null]) {
    assert.equal(timer.setSettings({ focusMinutes: value, rounds: 8 }).ok, false);
    assert.equal(timer.getSnapshot().settings.rounds, 4);
  }
  assert.equal(timer.setSettings({ breakMinutes: 61 }).ok, false);
  assert.equal(timer.setSettings({ rounds: 13 }).ok, false);
});

test('a single-round plan emits one completion event and never a rest transition', () => {
  const f = fixture();
  const events = [];
  f.timer.subscribe((_, event) => { if (event) events.push(event.type); });
  f.timer.setSettings({ focusMinutes: 1, rounds: 1 });
  f.timer.start();
  f.advance(60000);
  assert.equal(events.filter(type => type === 'plan-complete').length, 1);
  assert.equal(events.includes('phase-complete'), false);
  assert.equal(f.timer.getSnapshot().progress, 1);
  f.timer.start();
  assert.equal(f.timer.getSnapshot().round, 1);
  assert.equal(f.timer.getSnapshot().remainingMs, 60000);
});

test('today statistics follow local calendar day while all-time totals remain', () => {
  const f = fixture();
  f.timer.setSettings({ focusMinutes: 1, rounds: 1 });
  f.timer.start();
  f.advance(60000);
  assert.equal(f.timer.getSnapshot().stats.todayMinutes, 1);
  f.advance(24 * 60 * 60000);
  assert.equal(f.timer.getSnapshot().stats.todayMinutes, 0);
  assert.equal(f.timer.getSnapshot().stats.totalMinutes, 1);
});

test('damaged storage and unavailable storage do not prevent study', () => {
  const f = fixture();
  f.data.set('focus-on-tools:v1', '{broken');
  const restored = new FocusTimer({ storage: f.storage, now: f.now });
  assert.equal(restored.getSnapshot().remainingMs, 1500000);
  const unavailable = new FocusTimer({ storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); } }, now: f.now });
  unavailable.setSettings({ focusMinutes: 1, rounds: 1 });
  unavailable.start();
  f.advance(60000);
  unavailable.tick();
  assert.equal(unavailable.getSnapshot().status, 'completed');
  assert.equal(unavailable.getSnapshot().storageAvailable, false);
});
