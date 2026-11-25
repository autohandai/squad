import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

const ACTIVE_MS = 5 * 60_000;
const dateLabel = (value) => {
  const at = Date.parse(value || "");
  return Number.isFinite(at) ? new Date(at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
};
const ago = (value, now) => {
  const minutes = Math.max(0, Math.round((now - Date.parse(value)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : dateLabel(value);
};

/** "Active now on Wi-Fi", "Last seen 2 h ago from anywhere", or nothing known yet. */
export function phonePresence(device, now = Date.now()) {
  if (!device?.lastSeenAt || !Number.isFinite(Date.parse(device.lastSeenAt))) return { active: false, text: "Not seen since Squad started" };
  const via = device.lastSeenVia === "relay" ? "from anywhere" : device.lastSeenVia === "icloud" ? "through iCloud" : "on this Wi-Fi";
  return now - Date.parse(device.lastSeenAt) < ACTIVE_MS
    ? { active: true, text: `Active now ${via}` }
    : { active: false, text: `Last seen ${ago(device.lastSeenAt, now)} ${via}` };
}

/**
 * The phones paired with this computer, newest first: name, when it was paired
 * (which tells two "iPhone"s apart, since iOS gives apps only the model name)
 * and whether it is reaching this computer now. Disconnect is optional.
 */
export function PairedPhones({ devices = [], onDisconnect, busy = false, now = Date.now() }) {
  if (!devices.length) return null;
  const rows = [...devices].sort((a, b) => String(b.pairedAt || "").localeCompare(String(a.pairedAt || "")));
  return (
    <ul className="divide-y divide-border/60" aria-label="Paired phones" data-testid="paired-phones">
      {rows.map((device) => {
        const presence = phonePresence(device, now);
        return (
          <li key={device.id} className="flex items-center gap-3 py-2.5">
            <span className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60">
              <Smartphone className="size-4 text-muted-foreground" aria-hidden="true" />
              {presence.active ? <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500" aria-hidden="true" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{device.name || "iPhone"}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {presence.text}{device.pairedAt ? ` · paired ${dateLabel(device.pairedAt)}` : ""}
              </span>
            </span>
            {onDisconnect ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => onDisconnect(device)}>Disconnect</Button> : null}
          </li>
        );
      })}
    </ul>
  );
}
