import { useEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { bridgeVoiceSettings, getPageReader } from "@/lib/read-aloud";

function finished(message) {
  return message?.status !== "loading" && message?.status !== "error" && message?.status !== "stopped";
}

/**
 * The speaker on a member reply (ADR-0101). One reader serves the page, so
 * starting this reply stops any other. Props:
 *   text     the reply as markdown; rewritten to the spoken register before it is read
 *   message  { id, status } for identity and for the auto-read transition
 *   api      the app's JSON helper, used once a minute to ask whether the bridge holds an ElevenLabs key
 *   auto     the member's "Read replies aloud" switch: a reply this component saw
 *            arrive is read when it lands; replies already on screen are not
 */
export function ReadAloudButton({ text = "", message, api, auto = false, lang, className, compact = false, copy = {} }) {
  const reader = getPageReader();
  const [state, setState] = useState(() => reader.snapshot());
  const requested = useRef(false);
  const sawLoading = useRef(message?.status === "loading");

  useEffect(() => reader.subscribe((next) => {
    // Another reply taking the reader means this button's request is over.
    if (next.id && next.id !== message?.id) requested.current = false;
    setState(next);
  }), [reader, message?.id]);

  async function speak() {
    requested.current = true;
    const settings = await bridgeVoiceSettings(api);
    reader.speak({ id: message?.id || "", text, provider: settings?.ready ? "bridge" : "browser", lang: lang || globalThis.navigator?.language || "en-US" });
  }

  useEffect(() => {
    if (message?.status === "loading") {
      sawLoading.current = true;
      return;
    }
    if (auto && sawLoading.current && finished(message) && String(text || "").trim()) {
      sawLoading.current = false;
      void speak();
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
        className={cn("rounded-md text-muted-foreground hover:text-foreground", (speaking || loading) && "text-primary hover:text-primary", !compact && !mine && "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100")}
        onClick={() => { if (mine) { requested.current = false; reader.stop(); } else void speak(); }}
        data-read-aloud={loading ? "loading" : speaking ? "speaking" : "idle"}
      >
        {loading ? <Spinner className="size-3" /> : speaking ? <Square className="size-2.5 fill-current" /> : <Volume2 className="size-3.5" />}
      </Button>
      {speaking && state.provider === "bridge" ? <span className="text-[11px] text-muted-foreground">ElevenLabs</span> : null}
      {error ? <span className="min-w-0 truncate text-xs text-muted-foreground" role="status" title={error}>{error}</span> : null}
    </span>
  );
}
