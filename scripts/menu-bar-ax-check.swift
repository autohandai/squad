// Read-only accessibility check of Squad's menu bar (ADR-0249).
//
//   swift scripts/menu-bar-ax-check.swift <pid> [--press <member label>] [--listen <seconds>]
//
// <pid> is Autohand Squad, or `cargo run --example menu_bar_ax` from
// src-tauri. Prints what the accessibility API serves for each status item
// and every row of its menu (closed: nothing is opened), checks the rules
// below, and exits non-zero when one fails.
//
// --press sends AXPress to the status item with that AXDescription. Against
// the example it only reaches a print; against the app it opens Quick Chat,
// so leave it out there. --listen waits for an AXAnnouncementRequested.
//
// The caller needs Accessibility permission (System Settings › Privacy &
// Security › Accessibility) for the terminal it runs in.

import AppKit

let args = CommandLine.arguments
guard args.count > 1, let pid = pid_t(args[1]) else {
  print("usage: menu-bar-ax-check.swift <pid> [--press <label>] [--listen <seconds>]")
  exit(2)
}
func option(_ name: String) -> String? {
  guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
  return args[index + 1]
}
guard AXIsProcessTrusted() else {
  print("This terminal has no Accessibility permission; the tree would read empty.")
  exit(2)
}

let app = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(app, 3)
func attr(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  AXUIElementCopyAttributeValue(element, name as CFString, &value)
  return value
}
func text(_ element: AXUIElement, _ name: String) -> String {
  (attr(element, name) as? String) ?? ""
}
func children(_ element: AXUIElement) -> [AXUIElement] {
  (attr(element, "AXChildren") as? [AXUIElement]) ?? []
}
func actions(_ element: AXUIElement) -> [String] {
  var names: CFArray?
  AXUIElementCopyActionNames(element, &names)
  return (names as? [String]) ?? []
}

var failures: [String] = []
func expect(_ ok: Bool, _ message: String) {
  if !ok { failures.append(message) }
}

// macOS leaves a status item out of the tree while it is hidden, behind the
// notch of a full menu bar or switched off in Settings › Menu Bar. The
// example also installs its menu under a main-menu title "Squad menu", which
// is always in the tree, so the rows can be checked either way.
let items = attr(app, "AXExtrasMenuBar").map { children($0 as! AXUIElement) } ?? []
if items.isEmpty { print("no status item in the tree (hidden by the system, or none)") }
var squad: AXUIElement?
for item in items {
  let label = text(item, "AXDescription")
  print("status item  role=\(text(item, "AXRoleDescription"))  label=\"\(label)\"  value=\"\(text(item, "AXValue"))\"  help=\"\(text(item, "AXHelp"))\"  actions=\(actions(item))")
  expect(!label.isEmpty, "a status item has no accessibility label")
  expect(actions(item).contains("AXPress"), "status item \"\(label)\" cannot be pressed")
  if label.hasPrefix("Autohand Squad") { squad = item }
}
let fallback = attr(app, "AXMenuBar").flatMap { bar in
  children(bar as! AXUIElement).first { text($0, "AXTitle") == "Squad menu" }
}
expect(squad != nil || fallback != nil, "no status item is labelled Autohand Squad")

func walk(_ menu: AXUIElement, _ depth: Int) {
  for row in children(menu) {
    let title = text(row, "AXTitle")
    if title.isEmpty { continue }  // separators
    let help = text(row, "AXHelp")
    let enabled = (attr(row, "AXEnabled") as? Bool) ?? true
    print(String(repeating: "  ", count: depth) + "\(title)\(enabled ? "" : "  (dimmed)")\(help.isEmpty ? "" : "  — \(help)")")
    expect(!title.contains(" · "), "\"\(title)\" would make VoiceOver read the separator")
    for submenu in children(row) { walk(submenu, depth + 1) }
  }
}
// An older build has no label; read the first status item's menu anyway.
if let source = squad ?? fallback ?? items.first {
  print("\nmenu, in reading order\(squad == nil && fallback != nil ? " (from the main menu copy)" : ""):")
  for menu in children(source) { walk(menu, 1) }
}

if let label = option("--press") {
  if let target = items.first(where: { text($0, "AXDescription") == label }) {
    let result = AXUIElementPerformAction(target, "AXPress" as CFString)
    print("\nAXPress \"\(label)\": \(result == .success ? "ok" : "error \(result.rawValue)")")
    expect(result == .success, "AXPress on \"\(label)\" failed")
  } else {
    expect(false, "no status item labelled \"\(label)\" to press")
  }
}

if let seconds = option("--listen").flatMap(Double.init) {
  var heard: String?
  var observer: AXObserver?
  let callback: AXObserverCallbackWithInfo = { _, _, _, info, refcon in
    let said = (info as NSDictionary)["AXAnnouncementKey"] as? String ?? "?"
    let box = Unmanaged<NSMutableString>.fromOpaque(refcon!).takeUnretainedValue()
    box.setString(said)
  }
  let box = NSMutableString()
  AXObserverCreateWithInfoCallback(pid, callback, &observer)
  if let observer {
    AXObserverAddNotification(observer, app, "AXAnnouncementRequested" as CFString,
                              Unmanaged.passUnretained(box).toOpaque())
    CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(observer), .defaultMode)
    let deadline = Date().addingTimeInterval(seconds)
    while box.length == 0 && Date() < deadline {
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    heard = box.length > 0 ? box as String : nil
  }
  print("\nannouncement: \(heard.map { "\"\($0)\"" } ?? "none heard in \(Int(seconds)) s")")
  expect(heard != nil, "no announcement within \(Int(seconds)) s")
}

if failures.isEmpty {
  print("\nok")
} else {
  print("\nFAILED:\n- " + failures.joined(separator: "\n- "))
  exit(1)
}
