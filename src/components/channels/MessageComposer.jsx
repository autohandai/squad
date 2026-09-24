import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, AtSign, Paperclip, Smile, Square, Type } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const EMOJI_SET = ["👍", "👀", "✅", "🎉", "🚀", "🐝", "✨", "❤️", "🙏", "🔥", "💡", "🧠", "🛠️", "📎", "🗓️", "😄"];

function mentionQuery(text, caret) {
  const before = text.slice(0, caret);
  const match = before.match(/(?:^|\s)@([\w-]*)$/);
  if (!match) return null;
  return { query: match[1].toLowerCase(), start: caret - match[1].length - 1 };
}

/**
 * Buzz-style composer: single calm bordered field, @ / attach / emoji /
 * format actions on the left, a round send button on the right, Enter to
 * send, Shift+Enter for a newline, and an @mention picker with keyboard
 * selection for `@here` and member handles.
 */
export function MessageComposer({
  placeholder = "Message",
  mentionItems = [],
  busy = false,
  disabled = false,
  value,
  onValueChange,
  onSubmit,
  onStop,
  onAttach,
  attachLabel = "Attach",
  hint = "",
  autoFocus = false,
}) {
  const [internal, setInternal] = useState("");
  const text = value === undefined ? internal : value;
  const setText = (next) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };
  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  const [mention, setMention] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    const items = [{ id: "here", handle: "here", label: "@here", detail: "Everyone in this channel" }, ...mentionItems];
    return items.filter((item) => `${item.handle} ${item.label}`.toLowerCase().includes(mention.query)).slice(0, 8);
  }, [mention, mentionItems]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mention?.query]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 40), 220)}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  function submit() {
    const body = text.trim();
    if (!body || busy || disabled) return;
    onSubmit?.(body);
    setText("");
    setMention(null);
  }

  function insertAtCaret(snippet, { replaceFrom = null } = {}) {
    const element = textareaRef.current;
    const caret = element?.selectionStart ?? text.length;
    const from = replaceFrom ?? caret;
    const next = `${text.slice(0, from)}${snippet}${text.slice(caret)}`;
    setText(next);
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      const position = from + snippet.length;
      element.setSelectionRange(position, position);
    });
  }

  function selectMention(item) {
    if (!mention) return;
    insertAtCaret(`@${item.handle} `, { replaceFrom: mention.start });
    setMention(null);
  }

  function onChange(event) {
    const next = event.target.value;
    setText(next);
    setMention(mentionQuery(next, event.target.selectionStart ?? next.length));
  }

  function onKeyDown(event) {
    if (mention && mentionMatches.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((index) => (index + 1) % mentionMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((index) => (index - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectMention(mentionMatches[mentionIndex]);
        return;
      }
      if (event.key === "Escape") {
        setMention(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function wrapSelection(marker) {
    const element = textareaRef.current;
    if (!element) return;
    const start = element.selectionStart ?? text.length;
    const end = element.selectionEnd ?? start;
    const selected = text.slice(start, end) || "text";
    const next = `${text.slice(0, start)}${marker}${selected}${marker}${text.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + marker.length, start + marker.length + selected.length);
    });
  }

  const canSend = text.trim().length > 0 && !busy && !disabled;

  return (
    <div className={cn("relative rounded-md border border-border/80 bg-background transition-colors focus-within:border-foreground/40", disabled && "opacity-60")}>
      {mention && mentionMatches.length ? (
        <div role="listbox" aria-label="Mention" className="absolute bottom-full left-2 z-20 mb-1 w-64 rounded-md border border-border/80 bg-popover p-1 shadow-md">
          {mentionMatches.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === mentionIndex}
              className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm", index === mentionIndex ? "bg-muted" : "hover:bg-muted/60")}
              onMouseEnter={() => setMentionIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                selectMention(item);
              }}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
              {item.detail ? <span className="truncate text-xs text-muted-foreground">{item.detail}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={text}
        rows={1}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={placeholder}
        className="block w-full resize-none bg-transparent px-3 pb-1 pt-3 text-sm leading-6 outline-none placeholder:text-muted-foreground"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setMention(null), 120)}
      />
      <div className="flex items-center gap-0.5 px-2 pb-2">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Mention" disabled={disabled} onClick={() => { insertAtCaret("@"); setMention({ query: "", start: (textareaRef.current?.selectionStart ?? text.length) }); }}>
          <AtSign className="size-4" />
        </Button>
        {onAttach ? (
          <>
            <input ref={fileRef} type="file" multiple className="sr-only" onChange={(event) => { onAttach(Array.from(event.target.files || [])); event.target.value = ""; }} />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={attachLabel} disabled={disabled} onClick={() => fileRef.current?.click()}>
              <Paperclip className="size-4" />
            </Button>
          </>
        ) : null}
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Emoji" disabled={disabled}>
              <Smile className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2">
            <div className="grid grid-cols-8 gap-1">
              {EMOJI_SET.map((emoji) => (
                <button key={emoji} type="button" className="grid size-6 place-items-center rounded text-base hover:bg-muted" onClick={() => { insertAtCaret(emoji); setEmojiOpen(false); }}>
                  {emoji}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Format bold" disabled={disabled} onClick={() => wrapSelection("**")}>
          <Type className="size-4" />
        </Button>
        {hint ? <span className="ml-2 hidden truncate text-xs text-muted-foreground sm:inline">{hint}</span> : null}
        <span className="flex-1" />
        {busy && onStop ? (
          <Button type="button" variant="outline" size="icon-sm" className="rounded-full" aria-label="Stop" onClick={onStop}>
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button type="button" size="icon-sm" className="rounded-full" aria-label="Send" disabled={!canSend} onClick={submit}>
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
