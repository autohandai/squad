import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DESKTOP_DICTATION_HINT, composeDictation, createDictation, dictationSupport, recognitionClass } from "@/lib/voice-input";

const NOTICE_MS = 8000;

/**
 * The mic in a composer (ADR-0087). Speech lands in the draft through
 * `onValueChange(nextText)` for review; nothing is sent. Props:
 *   value          the current draft, so dictation appends to what was typed
 *   onValueChange  receives the full next draft while listening
 *   control        the button primitive (Button, or InputGroupButton in quick chat)
 *   copy           locale strings with inline fallbacks
 * In the macOS shell the button explains the Mac's own dictation instead of
 * listening, because WKWebView never starts recognition there.
 */
export function VoiceInputButton({ value = "", onValueChange, disabled = false, control: Control = Button, size = "icon-sm", className, lang, copy = {}, noticeClassName }) {
  const support = useMemo(() => dictationSupport(), []);
  const [state, setState] = useState("idle");
  const [notice, setNotice] = useState(null);
  const dictation = useRef(null);
  const base = useRef("");
  const latest = useRef({ value, onValueChange });
  latest.current = { value, onValueChange };

  useEffect(() => {
    if (support !== "browser") return undefined;
    dictation.current = createDictation({
      Recognition: recognitionClass(),
      lang: lang || globalThis.navigator?.language || "en-US",
      onState: setState,
      onText: (final, interim) => latest.current.onValueChange?.(composeDictation(base.current, final, interim)),
      onProblem: (text) => setNotice({ text, tone: "error" }),
    });
    return () => dictation.current?.abort();
  }, [support, lang]);

  useEffect(() => {
    if (!notice || notice.sticky) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (support === "none") return null;

  const listening = state === "listening";
  const starting = state === "starting";
  const startLabel = copy.dictate || "Dictate";
  const stopLabel = copy.stopDictation || "Stop dictation";

  function toggle() {
    if (support === "desktop") {
      setNotice({ text: DESKTOP_DICTATION_HINT, tone: "muted" });
      return;
    }
    if (listening || starting) {
      dictation.current?.stop();
      return;
    }
    setNotice(null);
    base.current = latest.current.value || "";
    dictation.current?.start();
  }

  const statusText = listening ? copy.listening || "Listening…" : starting ? copy.startingDictation || "Starting…" : "";

  return (
    <>
      <Control
        type="button"
        variant="ghost"
        size={size}
        disabled={disabled}
        aria-label={listening || starting ? stopLabel : startLabel}
        aria-pressed={listening}
        title={listening || starting ? stopLabel : startLabel}
        className={cn("rounded-full", listening && "text-primary hover:text-primary", className)}
        onClick={toggle}
        data-dictation-state={support === "desktop" ? "desktop" : state}
      >
        {listening ? <Square className="size-3.5 fill-current" /> : <Mic className={cn("size-4", starting && "animate-pulse")} />}
      </Control>
      {statusText ? (
        <span className={cn("inline-flex items-center gap-1.5 text-xs text-primary", noticeClassName)} aria-live="polite">
          <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
          {statusText}
        </span>
      ) : notice ? (
        <span className={cn("min-w-0 truncate text-xs", notice.tone === "error" ? "text-destructive" : "text-muted-foreground", noticeClassName)} role={notice.tone === "error" ? "alert" : "status"} title={notice.text}>
          {notice.text}
        </span>
      ) : null}
    </>
  );
}
