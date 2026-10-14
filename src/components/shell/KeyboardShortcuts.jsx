import { useEffect, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
const MOD = isMac ? "⌘" : "Ctrl";

// What the app answers to, in one place. Before this, ⌘K was mentioned on
// the search field and everything else had to be found by accident.
const GROUPS = [
  {
    title: "Anywhere",
    rows: [
      [`${MOD} K`, "Search everything"],
      [`${MOD} 1 – 9`, "Open a direct message, in sidebar order"],
      ["?", "Show these shortcuts"],
    ],
  },
  {
    title: "In a chat",
    rows: [
      ["Enter", "Send"],
      ["Shift Enter", "New line"],
      [`${MOD} Enter`, "Send now, interrupting the running reply"],
      ["↑", "In an empty composer, bring back your last message"],
      ["@", "Mention a file or skill"],
      ["/", "Commands, at the start of a message"],
    ],
  },
  {
    title: "On the Squad page",
    rows: [
      ["/", "Search members"],
      ["Esc", "Clear the search"],
    ],
  },
];

function typing(target) {
  const tag = target?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;
}

/**
 * Global shortcuts: "?" opens the list, ⌘/Ctrl 1–9 opens the nth direct
 * message. `members` is the sidebar's order; `onMember(id)` opens a chat.
 */
export function KeyboardShortcuts({ members = [], onMember }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(event) {
      if (event.defaultPrevented) return;
      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing(event.target)) {
        event.preventDefault();
        setOpen(true);
        return;
      }
      const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (mod && !event.altKey && !event.shiftKey && /^Digit[1-9]$/.test(event.code)) {
        const member = members[Number(event.code.slice(5)) - 1];
        if (!member) return;
        event.preventDefault();
        onMember?.(member.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [members, onMember]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press ? anywhere outside a text field to see this again.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {GROUPS.map((group) => (
            <section key={group.title} className="grid gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{group.title}</h3>
              <dl className="divide-y divide-border/60">
                {group.rows.map(([keys, label]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
                    <dt>{label}</dt>
                    <dd className="shrink-0"><kbd className="rounded border border-border/80 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{keys}</kbd></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
