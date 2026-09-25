import { useState } from "react";
import { BellRing } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { NOTIFICATION_KINDS, normalizeNotificationSettings } from "@/lib/notifications";

/**
 * Settings → Notifications body: one divider row per event kind and a test
 * button. `onChange(nextSettings)` receives the whole settings object;
 * `onTest()` may return a promise resolving to `{ posted, method }` or
 * throwing with a message, which is shown under the button.
 */
export function NotificationSettings({ settings, onChange, onTest, copy = {} }) {
  const current = normalizeNotificationSettings(settings);
  const [testState, setTestState] = useState({ busy: false, message: "", failed: false });

  function toggle(key, checked) {
    onChange?.({ ...current, [key]: Boolean(checked) });
  }

  async function runTest() {
    if (!onTest) return;
    setTestState({ busy: true, message: "", failed: false });
    try {
      const result = await onTest();
      const method = result?.method ? ` (${result.method})` : "";
      setTestState({ busy: false, failed: false, message: `${copy.notificationTestSent || "Sent."}${method}` });
    } catch (error) {
      setTestState({ busy: false, failed: true, message: error?.message || (copy.notificationTestFailed || "Could not post a notification.") });
    }
  }

  return (
    <div>
      <div className="divide-y divide-border/65">
        {NOTIFICATION_KINDS.map((kind) => {
          const label = copy[`notify_${kind.key}`] || kind.label;
          return (
            <Field key={kind.key} orientation="horizontal" className="items-center justify-between gap-6 py-4">
              <FieldContent className="gap-1">
                <FieldTitle>{label}</FieldTitle>
                <FieldDescription>{copy[`notify_${kind.key}Detail`] || kind.detail}</FieldDescription>
              </FieldContent>
              <Switch checked={current[kind.key]} onCheckedChange={(checked) => toggle(kind.key, checked)} aria-label={label} />
            </Field>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground hover:text-foreground" disabled={testState.busy || !onTest} onClick={runTest}>
          <BellRing data-icon="inline-start" />
          {copy.sendTestNotification || "Send test notification"}
        </Button>
        {testState.message ? (
          <span role="status" className={testState.failed ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
            {testState.message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
