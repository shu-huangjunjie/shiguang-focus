use crate::scheduler::Reminder;
use windows::{
    core::{Result, HSTRING},
    Data::Xml::Dom::XmlDocument,
    UI::Notifications::{ToastNotification, ToastNotificationManager},
};

// Uninstalled desktop programs can use this existing Windows shortcut identity.
// Installed builds use the AppUserModelID written by their NSIS shortcut.
pub const PORTABLE_APP_ID: &str =
    "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

fn content(reminder: &Reminder) -> Result<XmlDocument> {
    let document = XmlDocument::new()?;
    let audio = if reminder.sound_enabled {
        ""
    } else {
        "<audio silent=\"true\"/>"
    };
    document.LoadXml(&HSTRING::from(format!(
        "<toast><visual><binding template=\"ToastGeneric\"><text/><text/></binding></visual>{audio}</toast>"
    )))?;
    let nodes = document.GetElementsByTagName(&HSTRING::from("text"))?;
    // Text nodes preserve user-entered task names without interpreting XML.
    nodes
        .Item(0)?
        .AppendChild(&document.CreateTextNode(&HSTRING::from(&reminder.title))?)?;
    nodes
        .Item(1)?
        .AppendChild(&document.CreateTextNode(&HSTRING::from(&reminder.body))?)?;
    Ok(document)
}

pub fn show(app_id: &str, reminder: &Reminder) -> Result<()> {
    let toast = ToastNotification::CreateToastNotification(&content(reminder)?)?;
    toast.SetGroup(&HSTRING::from("shiguang-focus"))?;
    toast.SetTag(&HSTRING::from("timer"))?;
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?.Show(&toast)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_preserves_task_text_and_honors_mute_in_windows_xml() {
        let mut reminder = Reminder {
            title: "拾光 · 专注完成".into(),
            body: "阅读 <第 3 章> & \"做笔记\"\n下一阶段".into(),
            sound_enabled: false,
        };
        let muted = content(&reminder).unwrap();
        let texts = muted.GetElementsByTagName(&HSTRING::from("text")).unwrap();
        assert_eq!(
            texts.Item(1).unwrap().InnerText().unwrap().to_string(),
            reminder.body
        );
        let xml = muted.GetXml().unwrap().to_string();
        assert!(xml.contains("silent=\"true\""));
        assert!(xml.contains("&lt;第 3 章&gt;"));
        reminder.sound_enabled = true;
        assert!(!content(&reminder)
            .unwrap()
            .GetXml()
            .unwrap()
            .to_string()
            .contains("silent="));
    }
}
