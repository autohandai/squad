import { useEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { getPageReader } from "@/lib/read-aloud";
import { getKaleVoice } from "@/lib/kale-voice";
import { useMemberVoice } from "@/lib/member-voice-context";

function finished(message) {
  return message?.status !== "loading" && message?.status !== "error" && message?.status !== "stopped";
}

/**
 * The speaker on a member reply (ADR-0101). One reader serves the page, so
 * starting this reply stops any other. Props:
 *   text     the reply as markdown; rewritten to the spoken register before it is read
 *   message  { id, status } for identity and for the auto-read transition
 *   memberId whose reply it is: its reading voice comes from the squad's voices (ADR-0276)
 *   voice    an explicit voice instead (Settings samples)
 *   auto     the member's "Read replies aloud" switch: a reply this component saw
 *            arrive is read when it lands; replies already on screen are not
 */
export function ReadAloudButton({ text = "", message, memberId = "", voice: explicitVoice = "", auto = false, lang, className, compact = false, copy = {} }) {
  const reader = getPageReader();
  const memberVoice = useMemberVoice(memberId);
  const voice = explicitVoice || memberVoice;
  const [state, setState] = useState(() => reader.snapshot());
  const requested = useRef(false);
  const sawLoading = useRef(message?.status === "loading");

  useEffect(() => reader.subscribe((next) => {
    // Another reply taking the reader means this button's request is over.
    if (next.id && next.id !== message?.id) requested.current = false;
    setState(next);
  }), [reader, message?.id]);

  function speak() {
    requested.current = true;
    reader.speak({ id: message?.id || "", text, voice, lang: lang || globalThis.navigator?.language || "en-US" });
  }

  // A member that reads its replies aloud loads the model while the reply is
  // being written, so the first sentence does not wait for it (ADR-0276).
  useEffect(() => { if (auto && voice) getKaleVoice().warm(voice); }, [auto, voice]);

  useEffect(() => {
    if (message?.status === "loading") {
      sawLoading.current = true;
      return;
    }
    if (auto && sawLoading.current && finished(message) && String(text || "").trim()) {
      sawLoading.current = false;
      speak();
    }
    // Only the status transition matters; `speak` reads the latest text when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.status, auto]);

  if (!reader.supported || !String(text || "").trim() || !finished(message)) return null;

  const mine = state.id && state.id === message?.id;
  const loading = mine && state.status === "loading";
  const speaking = mine && state.status === "speaking";
  const error = requested.current && state.error && (mine || !state.id) ? state.error : "";
  const label = speaking || loading ? copy.stopReading || "Stop reading" : copy.readAloud || "Read aloud";

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        title={label}
        aria-pressed={speaking}
        className={cn("rounded-md text-muted-foreground/80 hover:text-foreground", (speaking || loading) && "text-primary hover:text-primary")}
        onClick={() => { if (mine) { requested.current = false; reader.stop(); } else speak(); }}
        data-read-aloud={loading ? "loading" : speaking ? "speaking" : "idle"}
      >
        {loading ? <Spinner className="size-3" /> : speaking ? <Square className="size-2.5 fill-current" /> : <Volume2 className="size-3.5" />}
      </Button>
      {error ? <span className="min-w-0 truncate text-xs text-muted-foreground" role="status" title={error}>{error}</span> : null}
    </span>
  );
}
