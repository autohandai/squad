import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { VoicePicker } from "@/components/members/VoicePicker";
import { useMemberVoice } from "@/lib/member-voice-context";
import { getPageReader } from "@/lib/read-aloud";

/**
 * Member profile → Voice (ADR-0101, ADR-0276): the member's own reading voice,
 * and the "Read replies aloud" switch. `onChange(checked)` persists
 * `agent.readAloud`; `onVoiceChange(id)` persists `agent.voice`.
 */
export function ReadAloudSetting({ agent, onChange, onVoiceChange, copy = {} }) {
  const supported = getPageReader().supported;
  const voice = useMemberVoice(agent?.id);
  const id = `read-aloud-${agent?.id || "member"}`;
  return (
    <section id="profile-voice" className="border-b border-border/75 pb-5" aria-labelledby="profile-voice-heading">
      <h3 id="profile-voice-heading" className="text-base font-semibold">{copy.voice || "Voice"}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {`How ${agent?.name || "this member"} sounds when replies are read aloud, on this computer and your iPhone. Made on the device; nothing is sent anywhere.`}
      </p>
      <VoicePicker className="mt-3" value={agent?.voice || voice} onChange={(next) => onVoiceChange?.(next)} memberName={agent?.name} />
      <Field orientation="horizontal" className="mt-4 items-center justify-between gap-6">
        <FieldContent className="gap-1">
          <FieldTitle><label htmlFor={id}>{copy.readRepliesAloud || "Read replies aloud"}</label></FieldTitle>
          <FieldDescription>
            {supported
              ? copy.readRepliesAloudDetail || `Each reply from ${agent?.name || "this member"} is read as it lands. Code, paths and tables are summarised, not spelled out.`
              : copy.readRepliesAloudUnavailable || "This browser cannot play audio."}
          </FieldDescription>
        </FieldContent>
        <Switch id={id} checked={Boolean(agent?.readAloud)} disabled={!supported} onCheckedChange={(checked) => onChange?.(Boolean(checked))} aria-label={copy.readRepliesAloud || "Read replies aloud"} />
      </Field>
    </section>
  );
}
