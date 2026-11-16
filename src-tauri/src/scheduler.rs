use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

const MINUTE: u64 = 60_000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Focus,
    Break,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub session_id: String,
    pub task: String,
    pub phase: Phase,
    pub round: u8,
    pub rounds: u8,
    pub focus_minutes: u16,
    pub break_minutes: u16,
    pub auto_advance: bool,
    pub sound_enabled: bool,
    pub deadline_ms: u64,
}

impl Schedule {
    pub fn validate(&mut self, now: u64) -> Result<(), String> {
        if self.session_id.is_empty() || self.session_id.len() > 120 {
            return Err("Invalid session identifier".into());
        }
        if !(1..=180).contains(&self.focus_minutes)
            || !(1..=60).contains(&self.break_minutes)
            || !(1..=12).contains(&self.rounds)
            || !(1..=self.rounds).contains(&self.round)
            || (self.phase == Phase::Break && self.round == self.rounds)
        {
            return Err("Invalid timer plan".into());
        }
        let duration = match self.phase {
            Phase::Focus => self.focus_minutes,
            Phase::Break => self.break_minutes,
        } as u64
            * MINUTE;
        if self.deadline_ms == 0 || self.deadline_ms > now.saturating_add(duration + 5_000) {
            return Err("Invalid timer deadline".into());
        }
        self.task = self
            .task
            .chars()
            .filter(|ch| !ch.is_control())
            .take(80)
            .collect();
        Ok(())
    }

    fn ordinal(&self) -> u8 {
        (self.round - 1) * 2 + u8::from(self.phase == Phase::Break)
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub title: String,
    pub body: String,
    pub sound_enabled: bool,
}

impl Reminder {
    fn from_schedule(plan: &Schedule) -> Self {
        let final_round = plan.phase == Phase::Focus && plan.round == plan.rounds;
        let title = if final_round {
            "拾光 · 这一组专注完成了"
        } else if plan.phase == Phase::Focus {
            "拾光 · 该休息一下了"
        } else {
            "拾光 · 休息结束"
        };
        let action = if final_round {
            format!("已完成 {} 轮学习。好好休息一下吧。", plan.rounds)
        } else if plan.phase == Phase::Focus {
            format!(
                "第 {} 轮完成，休息 {} 分钟。",
                plan.round, plan.break_minutes
            )
        } else {
            format!(
                "准备开始第 {} 轮，学习 {} 分钟。",
                plan.round + 1,
                plan.focus_minutes
            )
        };
        Self {
            title: title.into(),
            body: if plan.task.is_empty() {
                action
            } else {
                format!("{}\n{}", plan.task, action)
            },
            sound_enabled: plan.sound_enabled,
        }
    }
}

#[derive(Default)]
pub struct Scheduler {
    current: Option<Schedule>,
    completed: HashMap<String, u8>,
    recent_sessions: VecDeque<String>,
}

impl Scheduler {
    // Drain the old deadline before replacement, so a frontend transition cannot
    // erase an alarm that became due just before the IPC message arrived.
    pub fn replace(&mut self, schedule: Option<Schedule>, now: u64) -> Option<Reminder> {
        let previous = self.advance_due(now);
        self.current = schedule;
        self.advance_due(now).or(previous)
    }

    pub fn advance_due(&mut self, now: u64) -> Option<Reminder> {
        let mut latest = None;
        // A supported plan contains at most twelve focus and eleven rest phases.
        // Resume from sleep emits only the latest missed reminder, not a burst.
        for _ in 0..24 {
            let Some(mut plan) = self.current.take() else {
                break;
            };
            if plan.deadline_ms > now {
                self.current = Some(plan);
                break;
            }
            let ordinal = plan.ordinal();
            let unseen = self
                .completed
                .get(&plan.session_id)
                .is_none_or(|last| ordinal > *last);
            if unseen {
                if !self.completed.contains_key(&plan.session_id) {
                    self.recent_sessions.push_back(plan.session_id.clone());
                    if self.recent_sessions.len() > 64 {
                        if let Some(oldest) = self.recent_sessions.pop_front() {
                            self.completed.remove(&oldest);
                        }
                    }
                }
                self.completed.insert(plan.session_id.clone(), ordinal);
                latest = Some(Reminder::from_schedule(&plan));
            }
            let finished = plan.phase == Phase::Focus && plan.round == plan.rounds;
            if finished || !plan.auto_advance {
                break;
            }
            if plan.phase == Phase::Focus {
                plan.phase = Phase::Break;
                plan.deadline_ms += plan.break_minutes as u64 * MINUTE;
            } else {
                plan.phase = Phase::Focus;
                plan.round += 1;
                plan.deadline_ms += plan.focus_minutes as u64 * MINUTE;
            }
            self.current = Some(plan);
        }
        latest
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan() -> Schedule {
        Schedule {
            session_id: "test-session".into(),
            task: "读书".into(),
            phase: Phase::Focus,
            round: 1,
            rounds: 2,
            focus_minutes: 1,
            break_minutes: 1,
            auto_advance: true,
            sound_enabled: true,
            deadline_ms: 60_000,
        }
    }

    #[test]
    fn reminds_at_each_deadline_without_waiting_for_the_webview() {
        let mut scheduler = Scheduler::default();
        assert!(scheduler.replace(Some(plan()), 0).is_none());
        assert!(scheduler.advance_due(59_999).is_none());
        assert!(scheduler
            .advance_due(60_000)
            .unwrap()
            .title
            .contains("休息一下"));
        assert!(scheduler.advance_due(60_001).is_none());
        assert!(scheduler
            .advance_due(120_000)
            .unwrap()
            .title
            .contains("休息结束"));
        assert!(scheduler
            .advance_due(180_000)
            .unwrap()
            .title
            .contains("专注完成"));
        assert!(scheduler.advance_due(240_000).is_none());
    }

    #[test]
    fn catches_up_once_after_sleep_and_deduplicates_frontend_replays() {
        let mut scheduler = Scheduler::default();
        scheduler.replace(Some(plan()), 0);
        assert!(scheduler
            .advance_due(3_600_000)
            .unwrap()
            .title
            .contains("专注完成"));
        assert!(scheduler.replace(Some(plan()), 3_600_000).is_none());
        assert!(scheduler.advance_due(3_600_001).is_none());
    }

    #[test]
    fn manual_advance_waits_and_accepts_the_next_started_phase() {
        let mut scheduler = Scheduler::default();
        let mut schedule = plan();
        schedule.auto_advance = false;
        scheduler.replace(Some(schedule.clone()), 0);
        assert!(scheduler.advance_due(60_000).is_some());
        assert!(scheduler.advance_due(120_000).is_none());
        schedule.phase = Phase::Break;
        schedule.deadline_ms = 180_000;
        scheduler.replace(Some(schedule), 120_000);
        assert!(scheduler
            .advance_due(180_000)
            .unwrap()
            .title
            .contains("休息结束"));
        assert!(scheduler.advance_due(240_000).is_none());
    }

    #[test]
    fn paused_timer_stops_and_resume_uses_the_new_deadline() {
        let mut scheduler = Scheduler::default();
        scheduler.replace(Some(plan()), 0);
        scheduler.replace(None, 30_000);
        assert!(scheduler.advance_due(90_000).is_none());
        let mut resumed = plan();
        resumed.deadline_ms = 120_000;
        scheduler.replace(Some(resumed), 90_000);
        assert!(scheduler.advance_due(119_999).is_none());
        assert!(scheduler.advance_due(120_000).is_some());
    }

    #[test]
    fn frontend_transition_does_not_lose_the_previous_alarm() {
        let mut scheduler = Scheduler::default();
        scheduler.replace(Some(plan()), 0);
        let mut next = plan();
        next.phase = Phase::Break;
        next.deadline_ms = 120_000;
        assert!(scheduler
            .replace(Some(next), 60_010)
            .unwrap()
            .title
            .contains("休息一下"));
        assert!(scheduler.advance_due(60_020).is_none());
    }

    #[test]
    fn skipping_rest_has_no_rest_alarm_and_muting_is_preserved() {
        let mut scheduler = Scheduler::default();
        scheduler.replace(Some(plan()), 0);
        scheduler.advance_due(60_000);
        let mut skipped = plan();
        skipped.round = 2;
        skipped.deadline_ms = 140_000;
        skipped.sound_enabled = false;
        scheduler.replace(Some(skipped), 80_000);
        assert!(scheduler.advance_due(120_000).is_none());
        let reminder = scheduler.advance_due(140_000).unwrap();
        assert!(!reminder.sound_enabled);
        assert!(reminder.title.contains("专注完成"));
    }

    #[test]
    fn rejects_malformed_plans_and_caps_task_length() {
        let mut invalid = plan();
        invalid.rounds = 0;
        assert!(invalid.validate(0).is_err());
        let mut valid = plan();
        valid.task = "中".repeat(100);
        valid.validate(0).unwrap();
        assert_eq!(valid.task.chars().count(), 80);
        valid.deadline_ms = 1_000_000;
        assert!(valid.validate(0).is_err());
    }
}
