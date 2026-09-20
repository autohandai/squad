import { useEffect, useState } from "react";
import { SendHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// One-prompt channel dispatch: the user submits a single prompt and every
// squad member assigned to the channel plans its own execution and replies in
// the resulting thread. Auto mode (self-judge) follows the channel default,
// which is OFF unless the channel explicitly enables it.
const FALLBACK_COPY = {
  channels: "Channels",
  channelPromptPlaceholder: "Send one prompt to the whole channel...",
  channelDispatchNote: "Each member assigned to this channel picks its own execution plan and replies in the thread.",
  channelAutoModeOn: "Auto mode on",
  channelAutoModeOff: "Auto mode off",
  channelNoMembers: "No members assigned yet.",
  sendChatMessage: "Send chat message",
};

export function ChannelComposer({ channel, copy = FALLBACK_COPY, busy = false, onDispatch }) {
  const [prompt, setPrompt] = useState("");
  const autoMode = channel?.autoModeDefault === true;
  const hasMembers = Array.isArray(channel?.memberIds) && channel.memberIds.length > 0;

  // A draft belongs to the channel it was typed in; switching channels must not
  // carry it over to a different (possibly private) member set.
  useEffect(() => {
    setPrompt("");
  }, [channel?.id]);

  async function submit() {
    const text = prompt.trim();
    if (!text || busy || !channel || !hasMembers) return;
    // Handlers are channel-first and may report a no-op with `false`; only a
    // successful dispatch clears the draft.
    const result = await onDispatch?.(channel.id, { prompt: text, autoMode, selfJudge: autoMode });
    if (result !== false) setPrompt("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <Textarea
          value={prompt}
          placeholder={copy.channelPromptPlaceholder}
          rows={2}
          className="min-h-[64px] flex-1 resize-none"
          disabled={busy}
          aria-label={copy.channelPromptPlaceholder}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Button size="icon" aria-label={copy.sendChatMessage} disabled={busy || !prompt.trim() || !hasMembers} onClick={submit}>
          <SendHorizontal />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {hasMembers ? copy.channelDispatchNote : copy.channelNoMembers} {autoMode ? copy.channelAutoModeOn : copy.channelAutoModeOff}.
      </p>
    </div>
  );
}
