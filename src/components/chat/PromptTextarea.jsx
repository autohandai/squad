import { forwardRef, startTransition, useEffect, useImperativeHandle, useRef, useState } from "react";

import { Textarea } from "@/components/ui/textarea";

/**
 * A textarea whose keystrokes never wait on the conversation.
 *
 * The visible value lives in local state, so each key press re-renders only
 * this component. The parent receives the draft through `onDraft` inside a
 * React transition, which keeps the expensive conversation render off the
 * input's critical path. When the parent changes the value itself (suggestion,
 * mention insert, clear on send) it passes a new `value`; the field adopts it
 * whenever it differs from what the field last reported.
 */
export const PromptTextarea = forwardRef(function PromptTextarea({ value = "", onDraft, onKeyDown, onSelect, onClick, onKeyUp, ...props }, ref) {
  const [local, setLocal] = useState(value);
  const lastReported = useRef(value);
  const innerRef = useRef(null);
  useImperativeHandle(ref, () => innerRef.current);

  useEffect(() => {
    if (value !== lastReported.current) {
      lastReported.current = value;
      setLocal(value);
    }
  }, [value]);

  function report(target) {
    const next = target.value;
    const caret = target.selectionStart ?? next.length;
    lastReported.current = next;
    startTransition(() => onDraft?.(next, caret));
  }

  return (
    <Textarea
      ref={innerRef}
      value={local}
      onChange={(event) => {
        setLocal(event.target.value);
        report(event.target);
      }}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        onKeyUp?.(event);
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) report(event.currentTarget);
      }}
      onClick={(event) => {
        onClick?.(event);
        report(event.currentTarget);
      }}
      onSelect={onSelect}
      {...props}
    />
  );
});
