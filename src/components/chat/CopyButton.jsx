import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";

/**
 * A quiet copy control for a reply or a code block. The icon turns into a
 * check for a moment when the copy worked, and the label says when it did
 * not; nothing claims "Copied" for a copy that never happened.
 */
export function CopyButton({ text, label = "Copy", className, size = "icon-sm" }) {
  const [state, setState] = useState("");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy(event) {
    event.stopPropagation();
    const ok = await copyText(typeof text === "function" ? text() : text);
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState(""), 1500);
  }

  const shown = state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : label;
  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      className={cn("size-6 text-muted-foreground hover:text-foreground", state === "failed" && "text-destructive", className)}
      aria-label={shown}
      title={shown}
      onClick={copy}
    >
      {state === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}
