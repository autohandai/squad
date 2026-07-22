import { useState } from "react";
import { SendHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// One-prompt channel dispatch: the user submits a single prompt and every
// squad member assigned to the channel plans its own execution and replies in
// the resulting thread. Auto mode (self-judge) follows the channel default,
// which is OFF unless the channel explicitly enables it.
export function ChannelComposer({ channel, copy, busy = false, onDispatch }) {
  const [prompt, setPrompt] = useState("");
  const autoMode = channel?.autoModeDefault === true;

  function submit() {
    const text = prompt.trim();
    if (!text || busy) return;
    onDispatch?.({ prompt: text, autoMode, selfJudge: autoMode });
    setPrompt("");
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
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Button size="icon" aria-label={copy.channels} disabled={busy || !prompt.trim()} onClick={submit}>
          <SendHorizontal />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {copy.channelDispatchNote} {autoMode ? copy.channelAutoModeOn : copy.channelAutoModeOff}.
      </p>
    </div>
  );
}
