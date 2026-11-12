import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { NOTIFICATION_KINDS, normalizeNotificationSettings } from "@/lib/notifications";
import { channelNotificationPreference } from "@/lib/channel-notifications";
import { isGroupChat } from "@/lib/group-chats";
import { getNativeNotificationClient, notificationTestMessage } from "@/lib/native-notifications";

/**
 * Settings → Notifications body: one divider row per event kind and a test
 * button. `onChange(nextSettings)` receives the whole settings object;
 * `onTest()` may return a promise resolving to `{ posted, method }` or
 * throwing with a message, which is shown under the button.
 */
export function NotificationSettings({ settings, channels = [], onChannelChange, onChange, onTest, copy = {}, nativeClient: suppliedNativeClient }) {
  const current = normalizeNotificationSettings(settings);
  const [testState, setTestState] = useState({ busy: false, message: "", failed: false });
  const nativeClient = useMemo(() => suppliedNativeClient === undefined ? getNativeNotificationClient() : suppliedNativeClient, [suppliedNativeClient]);
  const [permissionState, setPermissionState] = useState({ value: "unknown", busy: Boolean(nativeClient), error: "" });
  const permissionBusy = useRef(false);
  const mounted = useRef(false);
  const savingRef = useRef(false);
  const retry = useRef(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function save(operation) {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setSaveError(""); retry.current = operation;
    try { await operation(); retry.current = null; }
    catch (failure) { setSaveError(failure.message || "Could not save notification preferences. Try again."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  const refreshPermission = useCallback(async (request = false) => {
    if (!nativeClient || permissionBusy.current) return;
    permissionBusy.current = true;
    setPermissionState((state) => ({ ...state, busy: true, requesting: request, error: "" }));
    try {
      const value = await nativeClient.permission({ request });
      if (mounted.current) setPermissionState({ value, busy: false, error: "" });
    } catch (error) {
      if (mounted.current) setPermissionState({ value: "unknown", busy: false, error: error?.message || "Could not read macOS notification permission." });
    } finally {
      permissionBusy.current = false;
    }
  }, [nativeClient]);

  useEffect(() => {
    mounted.current = true;
    if (!nativeClient) return () => { mounted.current = false; };
    void refreshPermission();
    const onFocus = () => { void refreshPermission(); };
    const onVisibility = () => { if (document.visibilityState === "visible") onFocus(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [nativeClient, refreshPermission]);

  async function openSystemSettings() {
    try {
      await nativeClient.openSettings();
    } catch (error) {
      setPermissionState((state) => ({ ...state, error: error?.message || "Could not open macOS notification settings." }));
    }
  }

  function toggle(key, checked) {
    void save(() => onChange?.({ ...current, [key]: Boolean(checked) }));
  }

  async function runTest() {
    if (!onTest) return;
    setTestState({ busy: true, message: "", failed: false });
    try {
      const result = await onTest();
      setTestState({ busy: false, failed: false, message: notificationTestMessage(result) });
    } catch (error) {
      setTestState({ busy: false, failed: true, message: error?.message || (copy.notificationTestFailed || "Could not post a notification.") });
    } finally {
      await refreshPermission();
    }
  }

  return (
    <div>
      <div className="divide-y divide-border/65">
        {nativeClient ? (
          <Field orientation="horizontal" className="flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4" data-testid="native-notification-permission">
            <FieldContent className="min-w-0 gap-1">
              <FieldTitle>{copy.nativeNotificationPermission || "Notifications on this Mac"}</FieldTitle>
              <FieldDescription role="status" aria-live="polite">
                {permissionState.busy ? permissionState.requesting ? "Waiting for macOS permission…" : "Checking macOS permission…" : permissionState.value === "granted" ? "Allowed by macOS. Banner display follows System Settings and Focus mode." : permissionState.value === "denied" ? "Notifications are off for Autohand Squad. Allow them in System Settings." : permissionState.value === "not-determined" ? "Allow Autohand Squad to show notifications on this Mac." : "macOS notification permission could not be confirmed."}
              </FieldDescription>
              {permissionState.error ? <p className="text-xs text-destructive" role="alert">{permissionState.error}</p> : null}
            </FieldContent>
            {permissionState.value === "not-determined" ? <Button type="button" variant="ghost" size="sm" disabled={permissionState.busy || testState.busy} onClick={() => refreshPermission(true)}>{permissionState.requesting ? "Waiting for permission…" : "Enable notifications"}</Button>
              : permissionState.value === "denied" ? <Button type="button" variant="ghost" size="sm" disabled={permissionState.busy || testState.busy} onClick={openSystemSettings}>Open System Settings</Button>
                : permissionState.value === "unknown" && !permissionState.busy ? <Button type="button" variant="ghost" size="sm" disabled={testState.busy} onClick={() => refreshPermission()}>Check permission</Button> : null}
          </Field>
        ) : null}
        {NOTIFICATION_KINDS.map((kind) => {
          const label = copy[`notify_${kind.key}`] || kind.label;
          return (
            <Field key={kind.key} orientation="horizontal" className="items-center justify-between gap-6 py-4">
              <FieldContent className="gap-1">
                <FieldTitle>{label}</FieldTitle>
                <FieldDescription>{copy[`notify_${kind.key}Detail`] || kind.detail}</FieldDescription>
              </FieldContent>
              <Switch disabled={saving} checked={current[kind.key]} onCheckedChange={(checked) => toggle(kind.key, checked)} aria-label={label} />
            </Field>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground hover:text-foreground" disabled={testState.busy || permissionState.busy && Boolean(nativeClient) || !onTest} onClick={runTest}>
          <BellRing data-icon="inline-start" />
          {testState.busy ? "Submitting notification…" : copy.sendTestNotification || "Send test notification"}
        </Button>
        {testState.message ? (
          <span role="status" className={testState.failed ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
            {testState.message}
          </span>
        ) : null}
      </div>
      <Separator className="my-6" />
      <h3 className="text-base font-medium">Channel messages</h3>
      <Field orientation="horizontal" className="items-center justify-between gap-6 py-4">
        <FieldContent><FieldTitle>Default notifications</FieldTitle><FieldDescription>Applies to channels and groups without an override. Muting alerts keeps their work running.</FieldDescription></FieldContent>
        <Select value={current.channelDefault} disabled={saving} onValueChange={value => void save(() => onChange?.({ ...current, channelDefault: value }))}>
          <SelectTrigger aria-label="Default channel notifications" className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value="all">All new posts</SelectItem><SelectItem value="mentions">Just mentions</SelectItem><SelectItem value="muted">Muted</SelectItem></SelectGroup></SelectContent>
        </Select>
      </Field>
      {channels.length && onChannelChange ? <div className="divide-y divide-border/60 border-t border-border/60">
        {[...channels].sort((a, b) => a.name.localeCompare(b.name)).map(channel => {
          const preference = channelNotificationPreference(current, channel.id);
          return <div key={channel.id} className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 py-4">
            <span className="min-w-0 flex-1 text-sm font-medium">{isGroupChat(channel) ? channel.name : `#${channel.name}`}</span>
            <Select value={preference.inherited ? 'default' : preference.mode} disabled={saving} onValueChange={mode => void save(() => onChannelChange(channel.id, { mode }))}>
              <SelectTrigger aria-label={`Notifications for ${channel.name}`} className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="default">Use Settings default</SelectItem><SelectItem value="all">All new posts</SelectItem><SelectItem value="mentions">Just mentions</SelectItem><SelectItem value="muted">Muted</SelectItem></SelectGroup></SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch disabled={saving} checked={preference.hidden} aria-label={`Hide ${channel.name} in sidebar`} onCheckedChange={hidden => void save(() => onChannelChange(channel.id, { hidden }))} />Hide in sidebar</label>
          </div>;
        })}
        <p className="pt-3 text-xs text-muted-foreground">Hidden channels remain available under Hidden channels in the sidebar.</p>
      </div> : null}
      {saveError ? <div className="mt-3 flex items-center gap-2"><p role="alert" className="text-xs text-destructive">{saveError}</p><Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { if (retry.current) void save(retry.current); }}>Retry save</Button></div> : null}
    </div>
  );
}
