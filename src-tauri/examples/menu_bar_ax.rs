//! Accessibility check for the menu bar (ADR-0249), without the app.
//!
//! Runs the shell's own `menu_bar_access` module in a bare accessory process:
//! plans the typical menu with the real planner, builds it as native items,
//! describes it, and puts two status items in the menu bar (Squad, with the
//! attention dot, and one member) for a few seconds. Nothing is opened and
//! nothing is clicked. Read the result from another process:
//!
//! ```sh
//! cargo run --example menu_bar_ax &      # prints its pid, exits after 12 s
//! swift scripts/menu-bar-ax-check.swift <pid>
//! ```
//!
//! The check script reads the accessibility tree, compares it with what
//! VoiceOver should read, presses the member's item through AXPress (which
//! only reaches the handler below; no window opens), and listens for the
//! announcement.

#[cfg(target_os = "macos")]
#[allow(dead_code)]
#[path = "../src/menu_bar_access.rs"]
mod menu_bar_access;

#[cfg(target_os = "macos")]
#[allow(dead_code)]
#[path = "../src/tray_art.rs"]
mod tray_art;

#[cfg(not(target_os = "macos"))]
fn main() {}

#[cfg(target_os = "macos")]
fn main() {
    use autohand_squad_runtime::desktop_tray::menu::{
        self, EngineUsage, EngineWindow, MenuInputs, NeedsKind, NeedsYouItem, QuickChat, Row,
        RowKind,
    };
    use autohand_squad_runtime::desktop_tray::{DesktopTrayModel, TrayMember};
    use objc2::rc::Retained;
    use objc2::AnyThread;
    use objc2_app_kit::{
        NSApplication, NSApplicationActivationPolicy, NSImage, NSMenu, NSMenuItem, NSStatusBar,
    };
    use objc2_foundation::{MainThreadMarker, NSData, NSSize, NSString};
    use std::collections::{HashMap, HashSet};
    use std::io::Write;

    let mtm = MainThreadMarker::new().expect("main thread");
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);

    let now = autohand_squad_runtime::account_usage::now_unix();
    let member = |id: &str, name: &str, status: &str, working: bool| TrayMember {
        id: id.into(),
        name: name.into(),
        label: name.into(),
        status: status.into(),
        working,
        ..Default::default()
    };
    let mut noah = member("noah", "Noah", "online", true);
    noah.task = Some("Checkout tests for the new payment flow".into());
    let model = DesktopTrayModel {
        loaded: true,
        signed_in: true,
        email: Some("me@example.com".into()),
        daemon_running: true,
        running_since: Some(now - 3600),
        members: vec![
            noah,
            member("eva", "Eva", "online", true),
            member("rd", "R&D Scout", "online", false),
            member("mia", "Mia", "paused", false),
        ],
        ..Default::default()
    };
    let needs = vec![NeedsYouItem {
        member_id: "eva".into(),
        kind: NeedsKind::Approval,
        subject: "push the release branch to main and tag it v0.1.23".into(),
        at: "2026-11-18T00:00:00Z".into(),
    }];
    let harnesses = vec![EngineUsage {
        id: "codex".into(),
        name: "Codex".into(),
        heading: "Codex".into(),
        windows: vec![EngineWindow {
            label: "This week".into(),
            left: Some(82),
            resets_at: Some(now + 3 * 86_400),
        }],
        error: None,
    }];
    let (engines, breaks) = (HashMap::new(), HashSet::new());
    let inputs = MenuInputs {
        model: &model,
        engines: &engines,
        engines_known: false,
        needs: &needs,
        on_break: &breaks,
        show_usage: true,
        harnesses: Some(&harnesses),
        phone: None,
        quick_chat: QuickChat::Enabled,
        generation: "gen",
        clock: menu::Clock::system(true),
    };
    let rows = menu::plan_menu(&inputs);

    // Native items the way muda makes them: one per row, titles as given
    // (the shell doubles `&` for muda, which strips it back to one).
    fn build(rows: &[Row], mtm: MainThreadMarker) -> Retained<NSMenu> {
        let menu = NSMenu::new(mtm);
        menu.setAutoenablesItems(false);
        for row in rows {
            let item = match &row.kind {
                RowKind::Separator => NSMenuItem::separatorItem(mtm),
                _ => {
                    let item = NSMenuItem::new(mtm);
                    item.setTitle(&NSString::from_str(&row.text));
                    item.setEnabled(row.enabled);
                    if let RowKind::Submenu(children) = &row.kind {
                        item.setSubmenu(Some(&build(children, mtm)));
                    }
                    item
                }
            };
            menu.addItem(&item);
        }
        menu
    }
    let native = build(&rows, mtm);
    let described = menu_bar_access::describe_menu(&native, &rows);

    let ns_image = |icon: &tauri::image::Image<'_>, template: bool| {
        let mut png = std::io::Cursor::new(Vec::new());
        image::RgbaImage::from_raw(icon.width(), icon.height(), icon.rgba().to_vec())
            .unwrap()
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let png = png.into_inner();
        let data = NSData::with_bytes(&png);
        let image = NSImage::initWithData(NSImage::alloc(), &data).unwrap();
        image.setSize(NSSize::new(
            18.0 * icon.width() as f64 / icon.height() as f64,
            18.0,
        ));
        image.setTemplate(template);
        image
    };

    let bar = NSStatusBar::systemStatusBar();
    let squad = bar.statusItemWithLength(-1.0);
    let rows_ref = &rows;
    let dot = menu::attention_count(&inputs) > 0;
    if let Some(button) = squad.button(mtm) {
        let icon = tray_art::squad_status_icon(dot).unwrap();
        button.setImage(Some(&ns_image(&icon, true)));
        button.setToolTip(Some(&NSString::from_str("Autohand Squad")));
    }
    squad.setMenu(Some(&native));
    menu_bar_access::describe_status_item(
        &squad,
        &menu::status_item_speech(&inputs, rows_ref),
        mtm,
    );

    let noah_item = bar.statusItemWithLength(-1.0);
    if let Some(button) = noah_item.button(mtm) {
        let portrait = [120u8, 140, 160, 255].repeat(22 * 22);
        let icon = tauri::image::Image::new_owned(portrait, 22, 22);
        button.setImage(Some(&ns_image(&icon, false)));
        button.setToolTip(Some(&NSString::from_str("Noah · Working")));
    }
    menu_bar_access::describe_status_item(
        &noah_item,
        &menu::member_item_speech(&inputs, "noah").unwrap(),
        mtm,
    );
    menu_bar_access::make_pressable(&noah_item, "noah", mtm);
    menu_bar_access::on_member_press(|member| {
        println!("pressed {member}");
        let _ = std::io::stdout().flush();
    });

    // A second copy under the main menu, which the accessibility tree always
    // carries; a status item can be left out while the system hides it.
    let copy = build(&rows, mtm);
    let copy_described = menu_bar_access::describe_menu(&copy, &rows);
    let main_menu = NSMenu::new(mtm);
    let holder = NSMenuItem::new(mtm);
    holder.setTitle(&NSString::from_str("Squad menu"));
    holder.setSubmenu(Some(&copy));
    let first = NSMenuItem::new(mtm);
    first.setSubmenu(Some(&NSMenu::new(mtm)));
    main_menu.addItem(&first);
    main_menu.addItem(&holder);
    app.setMainMenu(Some(&main_menu));

    println!("{}", std::process::id());
    println!("described {described} items, {copy_described} in the main-menu copy");
    // In-process, the same getters the accessibility server answers from.
    for (name, item) in [("squad", &squad), ("noah", &noah_item)] {
        if let Some(button) = item.button(mtm) {
            use objc2_app_kit::NSAccessibility;
            let value = button.accessibilityValue()
                .and_then(|value| value.downcast::<NSString>().ok())
                .map(|value| value.to_string());
            println!(
                "{name} button: label={:?} value={:?} help={:?}",
                button.accessibilityLabel().map(|text| text.to_string()),
                value,
                button.accessibilityHelp().map(|text| text.to_string()),
            );
        }
    }
    // VoiceOver's press on the member's item: AXPress is NSButton's
    // accessibilityPerformPress, which sends the button's action.
    if let Some(button) = noah_item.button(mtm) {
        use objc2_app_kit::NSAccessibility;
        println!(
            "noah accessibilityPerformPress -> {}",
            button.accessibilityPerformPress()
        );
    }
    let _ = std::io::stdout().flush();

    // The announcement, after the checker has had time to start listening.
    let announcement = menu::announcement(&HashSet::new(), &inputs);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(4));
        dispatch_main(move || {
            if let Some(text) = &announcement {
                menu_bar_access::announce(text, unsafe { MainThreadMarker::new_unchecked() });
            }
        });
        std::thread::sleep(std::time::Duration::from_secs(8));
        std::process::exit(0);
    });
    app.run();

    fn dispatch_main(work: impl FnOnce() + Send + 'static) {
        // Run on the main queue, which `NSApplication.run` drains.
        let work: Box<dyn FnOnce() + Send> = Box::new(work);
        let context = Box::into_raw(Box::new(work)) as *mut std::ffi::c_void;
        extern "C" fn trampoline(context: *mut std::ffi::c_void) {
            let work = unsafe { Box::from_raw(context as *mut Box<dyn FnOnce() + Send>) };
            work();
        }
        unsafe extern "C" {
            static _dispatch_main_q: std::ffi::c_void;
            fn dispatch_async_f(
                queue: *const std::ffi::c_void,
                context: *mut std::ffi::c_void,
                work: extern "C" fn(*mut std::ffi::c_void),
            );
        }
        unsafe { dispatch_async_f(&raw const _dispatch_main_q, context, trampoline) };
    }
}
