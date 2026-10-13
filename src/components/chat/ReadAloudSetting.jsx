import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { getPageReader } from "@/lib/read-aloud";

/**
 * Member profile → Voice: the per-member "Read replies aloud" switch
 * (ADR-0101). `onChange(checked)` persists `agent.readAloud`; the reply rows
 * read it through the member they render for.
 */
export function ReadAloudSetting({ agent, onChange, copy = {} }) {
  const supported = getPageReader().supported;
  const id = `read-aloud-${agent?.id || "member"}`;
  return (
    <section className="border-b border-border/75 pb-5" aria-labelledby="profile-voice">
      <h3 id="profile-voice" className="text-base font-semibold">{copy.voice || "Voice"}</h3>
      <Field orientation="horizontal" className="mt-2 items-center justify-between gap-6">
        <FieldContent className="gap-1">
          <FieldTitle><label htmlFor={id}>{copy.readRepliesAloud || "Read replies aloud"}</label></FieldTitle>
          <FieldDescription>
            {supported
              ? copy.readRepliesAloudDetail || `Each reply from ${agent?.name || "this member"} is read as it lands, with the built-in voices or ElevenLabs when a key is set in Settings → Voice. Code, paths and tables are summarised, not spelled out.`
              : copy.readRepliesAloudUnavailable || "This browser has no voices to read with."}
          </FieldDescription>
        </FieldContent>
        <Switch id={id} checked={Boolean(agent?.readAloud)} disabled={!supported} onCheckedChange={(checked) => onChange?.(Boolean(checked))} aria-label={copy.readRepliesAloud || "Read replies aloud"} />
      </Field>
    </section>
  );
}
