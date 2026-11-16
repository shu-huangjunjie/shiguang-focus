#[cfg(windows)]
mod notification;
mod scheduler;

use scheduler::{Reminder, Schedule, Scheduler};
use std::{
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WebviewWindow, WindowEvent,
};

type TimerState = Mutex<Scheduler>;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("desktop:tick", ());
    }
}

fn deliver(app: &tauri::AppHandle, reminder: Reminder) {
    // The native thread owns deadlines; the webview only updates its display.
    // Native notifications own audio in the app, avoiding duplicate browser chimes.
    #[cfg(windows)]
    {
        let installed = std::env::var_os("APPDATA").is_some_and(|roaming| {
            std::path::PathBuf::from(roaming)
                .join("Microsoft/Windows/Start Menu/Programs/拾光/拾光.lnk")
                .exists()
        });
        let app_id = if installed {
            app.config().identifier.as_str()
        } else {
            notification::PORTABLE_APP_ID
        };
        if let Err(error) = notification::show(app_id, &reminder) {
            eprintln!("Notification delivery failed: {error}");
            let _ = app.emit(
                "desktop:notice",
                "系统通知暂不可用，请检查 Windows 通知设置。",
            );
        }
    }
    let _ = app.emit("desktop:tick", ());
}

#[tauri::command]
fn sync_timer(
    app: tauri::AppHandle,
    state: State<'_, TimerState>,
    mut schedule: Option<Schedule>,
) -> Result<(), String> {
    let now = now_ms();
    if let Some(plan) = schedule.as_mut() {
        plan.validate(now)?;
    }
    let reminder = state
        .lock()
        .map_err(|_| "Timer state is unavailable")?
        .replace(schedule, now);
    if let Some(reminder) = reminder {
        deliver(&app, reminder);
    }
    Ok(())
}

#[tauri::command]
fn set_immersive(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_fullscreen(enabled)
        .map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app)
        }))
        .manage(TimerState::default())
        .invoke_handler(tauri::generate_handler![sync_timer, set_immersive])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "打开拾光", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "退出拾光", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &separator, &quit])?;
            let mut tray = TrayIconBuilder::with_id("focus-tray")
                .tooltip("拾光 · 学习与休息，按自己的节奏来")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => (),
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            let handle = app.handle().clone();
            thread::Builder::new()
                .name("focus-deadlines".into())
                .spawn(move || loop {
                    let reminder = handle
                        .state::<TimerState>()
                        .lock()
                        .ok()
                        .and_then(|mut timer| timer.advance_due(now_ms()));
                    if let Some(reminder) = reminder {
                        deliver(&handle, reminder);
                    }
                    thread::sleep(Duration::from_millis(250));
                })?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // The tray menu is the explicit way to quit; closing the window
                // leaves the local timer and its reminder thread alive.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Unable to start 拾光");
}
