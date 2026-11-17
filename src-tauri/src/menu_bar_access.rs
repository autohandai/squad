//! VoiceOver for the menu bar (ADR-0249): what each menu row, the Squad
//! status item and each member's status item say to assistive technology,
//! the announcement when something starts needing the person, and the
//! press action that lets VoiceOver open a member's Quick Chat.
//!
//! The words come from `desktop_tray::menu` and are unit-tested there. This
//! module only hands them to AppKit, and it depends on nothing but AppKit and
//! the planner so `examples/menu_bar_ax.rs` can run it in a bare process and
//! read the result back through the accessibility API.
//!
//! What was measured (macOS 27, AXUIElement from another process, read-only):
//! a menu item's `setAccessibilityTitle` replaces AXTitle, `setAccessibilityHelp`
//! fills AXHelp, `setAccessibilityLabel` fills AXDescription, and a menu
//! item's image description is never exposed, so the drawings stay silent
//! without any work. A status item with no title exposed only its tooltip
//! as AXHelp; VoiceOver had no name to read.

#![cfg(target_os = "macos")]

use autohand_squad_runtime::desktop_tray::menu::{Row, RowKind, StatusSpeech};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject};
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSAccessibility, NSMenu, NSStatusItem};
use objc2_foundation::{NSNumber, NSString};
use std::cell::RefCell;
use std::collections::HashMap;

/// Give each native item the words VoiceOver should read for its planned
/// row. The menu was built from `rows` by `tray_item`, one native item per
/// row in the same order, separators included; an item whose title does not
/// match its row is left alone, so a mismatch can only cost a description,
/// never put the wrong words on a row. Returns how many items were described.
pub(crate) fn describe_menu(menu: &NSMenu, rows: &[Row]) -> usize {
    let items = menu.itemArray();
    if items.count() != rows.len() {
        return 0;
    }
    let mut described = 0;
    for (item, row) in items.iter().zip(rows) {
        let separator = matches!(row.kind, RowKind::Separator);
        if item.isSeparatorItem() != separator || separator {
            continue;
        }
        if item.title().to_string() != row.text {
            continue;
        }
        let title = row.spoken_title();
        if title != row.text {
            item.setAccessibilityTitle(Some(&NSString::from_str(&title)));
        }
        if let Some(help) = &row.help {
            item.setAccessibilityHelp(Some(&NSString::from_str(help)));
        }
        described += 1;
        if let (RowKind::Submenu(children), Some(submenu)) = (&row.kind, item.submenu()) {
            described += describe_menu(&submenu, children);
        }
    }
    described
}

/// Name, state and hint for a status item's button.
pub(crate) fn describe_status_item(
    item: &NSStatusItem,
    speech: &StatusSpeech,
    mtm: MainThreadMarker,
) {
    let Some(button) = item.button(mtm) else {
        return;
    };
    button.setAccessibilityLabel(Some(&NSString::from_str(&speech.label)));
    let value = NSString::from_str(&speech.value);
    unsafe { button.setAccessibilityValue(Some(&value)) };
    button.setAccessibilityHelp(Some(&NSString::from_str(&speech.help)));
}

/// Whether VoiceOver is running now (`NSWorkspace.isVoiceOverEnabled`).
pub(crate) fn voiceover_running() -> bool {
    objc2_app_kit::NSWorkspace::sharedWorkspace().isVoiceOverEnabled()
}

/// Ask VoiceOver to speak `text` at medium priority: it waits for what is
/// being read instead of cutting it off, because it comes from the menu bar
/// while the person is somewhere else.
pub(crate) fn announce(text: &str, mtm: MainThreadMarker) {
    use objc2_app_kit::{
        NSAccessibilityAnnouncementKey, NSAccessibilityAnnouncementRequestedNotification,
        NSAccessibilityPostNotificationWithUserInfo, NSAccessibilityPriorityKey,
        NSAccessibilityPriorityLevel, NSApplication,
    };
    use objc2_foundation::NSDictionary;
    let app = NSApplication::sharedApplication(mtm);
    let announcement = NSString::from_str(text);
    let priority = NSNumber::new_isize(NSAccessibilityPriorityLevel::Medium.0);
    let keys = unsafe { [NSAccessibilityAnnouncementKey, NSAccessibilityPriorityKey] };
    let values: [&AnyObject; 2] = [&announcement, &priority];
    let info = NSDictionary::from_slices(&keys, &values);
    unsafe {
        NSAccessibilityPostNotificationWithUserInfo(
            &app,
            NSAccessibilityAnnouncementRequestedNotification,
            Some(&info),
        )
    };
}

// ---------------------------------------------------------------------------
// Pressing a member's status item
// ---------------------------------------------------------------------------
//
// tray-icon puts a view over the status button that takes every mouse event,
// so a click never reaches the button. VoiceOver's press (AXPress) does: it
// calls the button's action. The Squad item has a menu, so its press pops the
// menu. A member's item has none and no action, so pressing it did nothing.
// Each member's button gets a target whose action opens that member's Quick
// Chat, the same thing a click does.

struct PressIvars {
    member_id: String,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "SquadStatusItemPress"]
    #[ivars = PressIvars]
    struct PressTarget;

    impl PressTarget {
        #[unsafe(method(press:))]
        fn press(&self, _sender: Option<&AnyObject>) {
            let member_id = self.ivars().member_id.clone();
            PRESS.with(|handler| {
                if let Some(handler) = handler.borrow().as_ref() {
                    handler(&member_id);
                }
            });
        }
    }
);

impl PressTarget {
    fn new(member_id: &str, mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(PressIvars {
            member_id: member_id.to_string(),
        });
        unsafe { msg_send![super(this), init] }
    }
}

type PressHandler = Box<dyn Fn(&str)>;

thread_local! {
    static PRESS: RefCell<Option<PressHandler>> = RefCell::new(None);
    /// The button holds its target weakly; these keep them alive.
    static TARGETS: RefCell<HashMap<String, Retained<PressTarget>>> = RefCell::new(HashMap::new());
}

/// What pressing a member's status item does. Main thread only.
pub(crate) fn on_member_press(handler: impl Fn(&str) + 'static) {
    PRESS.with(|slot| *slot.borrow_mut() = Some(Box::new(handler)));
}

/// Make VoiceOver's press on a member's status item open their Quick Chat.
pub(crate) fn make_pressable(item: &NSStatusItem, member_id: &str, mtm: MainThreadMarker) {
    let Some(button) = item.button(mtm) else {
        return;
    };
    let target = TARGETS.with(|targets| {
        targets
            .borrow_mut()
            .entry(member_id.to_string())
            .or_insert_with(|| PressTarget::new(member_id, mtm))
            .clone()
    });
    unsafe {
        button.setTarget(Some(&target));
        button.setAction(Some(sel!(press:)));
    }
}

/// Drop the press targets of members whose status items are gone.
pub(crate) fn retain_pressable(keep: impl Fn(&str) -> bool) {
    TARGETS.with(|targets| targets.borrow_mut().retain(|id, _| keep(id)));
}
