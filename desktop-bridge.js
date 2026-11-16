(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FocusDesktop = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function nativeSchedule(view) {
    if (view.status !== 'running') return null;
    return {
      sessionId: view.sessionId, task: view.task, phase: view.phase, round: view.round,
      rounds: view.totalRounds, focusMinutes: view.settings.focusMinutes,
      breakMinutes: view.settings.breakMinutes, autoAdvance: view.settings.autoAdvance,
      soundEnabled: view.settings.soundEnabled, deadlineMs: view.deadline
    };
  }

  function connect(timer, options = {}) {
    const bridge = options.bridge || root.__TAURI__;
    if (!bridge || !bridge.core || !bridge.event) return { active: false, nativeReminders: false };
    const adapter = {
      active: true,
      nativeReminders: true,
      setFullscreen: enabled => bridge.core.invoke('set_immersive', { enabled })
    };
    let previous = '';
    let queue = Promise.resolve();
    let warned = false;
    const sync = view => {
      const schedule = nativeSchedule(view);
      const key = JSON.stringify(schedule);
      if (key === previous) return;
      previous = key;
      queue = queue.then(() => bridge.core.invoke('sync_timer', { schedule })).then(() => {
        adapter.nativeReminders = true;
      }).catch(error => {
        adapter.nativeReminders = false;
        previous = '';
        if (!warned && options.onNotice) options.onNotice('后台提醒连接暂不可用，页面计时仍可继续。');
        warned = true;
        if (options.onError) options.onError(error);
      });
    };
    sync(timer.getSnapshot());
    timer.subscribe(sync);
    bridge.event.listen('desktop:tick', () => timer.tick()).catch(() => {});
    bridge.event.listen('desktop:notice', event => { if (options.onNotice) options.onNotice(String(event.payload)); }).catch(() => {});
    adapter.flush = () => queue;
    return adapter;
  }

  return { connect, nativeSchedule };
});
