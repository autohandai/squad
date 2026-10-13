import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getPageReader, resetBridgeVoiceSettings } from "@/lib/read-aloud";

const EMPTY = { provider: "elevenlabs", configured: false, ready: false, keyHint: "", voiceId: "", voiceName: "" };

function Row({ title, description, children, htmlFor }) {
  return (
    <Field orientation="horizontal" className="items-center justify-between gap-6 py-4">
      <FieldContent className="w-[220px] shrink-0 gap-1">
        <FieldTitle>{htmlFor ? <label htmlFor={htmlFor}>{title}</label> : title}</FieldTitle>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </FieldContent>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">{children}</div>
    </Field>
  );
}

/**
 * Settings → Voice (ADR-0101). The ElevenLabs key goes to the bridge and is
 * never read back: the bridge reports a four-character hint. `api` is the
 * app's JSON helper (GET/PUT/DELETE /api/voice/settings, GET /api/voice/voices).
 */
export function VoiceSettings({ api, copy = {}, className }) {
  const [config, setConfig] = useState(EMPTY);
  const [voices, setVoices] = useState([]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await api("/api/voice/settings");
        if (cancelled) return;
        setConfig({ ...EMPTY, ...current });
        if (current?.configured) {
          const list = await api("/api/voice/voices");
          if (!cancelled) setVoices(list?.voices || []);
        }
      } catch (failure) {
        if (!cancelled) setError(failure?.message || String(failure));
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  async function run(label, action) {
    setBusy(label);
    setError("");
    setNote("");
    try {
      await action();
      resetBridgeVoiceSettings();
    } catch (failure) {
      setError(failure?.message || String(failure));
    } finally {
      setBusy("");
    }
  }

  const saveKey = () => run("key", async () => {
    const saved = await api("/api/voice/settings", { method: "PUT", body: JSON.stringify({ key: key.trim() }) });
    setConfig({ ...EMPTY, ...saved });
    setVoices(saved?.voices || []);
    setKey("");
    setNote(copy.voiceKeySaved || "Key verified and stored on this machine.");
  });

  const removeKey = () => run("remove", async () => {
    setConfig({ ...EMPTY, ...(await api("/api/voice/settings", { method: "DELETE" })) });
    setVoices([]);
    setNote(copy.voiceKeyRemoved || "Key removed. Replies use the built-in voices.");
  });

  const chooseVoice = (voiceId) => run("voice", async () => {
    const voice = voices.find((item) => item.id === voiceId);
    setConfig({ ...EMPTY, ...(await api("/api/voice/settings", { method: "PUT", body: JSON.stringify({ voiceId, voiceName: voice?.name || "" }) })) });
  });

  const test = () => run("test", async () => {
    await getPageReader().speak({ id: "voice-settings-test", text: copy.voiceTestSentence || "This is how replies will sound.", provider: config.ready ? "bridge" : "browser" });
  });

  const builtIn = getPageReader().supported;
  const sentence = config.ready
    ? (copy.voiceUsesElevenLabs || "Replies read aloud use ElevenLabs voice {voice}.").replace("{voice}", config.voiceName || config.voiceId)
    : config.configured
      ? copy.voiceChooseVoice || "A key is stored. Choose a voice to use it."
      : builtIn
        ? copy.voiceUsesBuiltIn || "Replies read aloud use the voices built into this computer."
        : copy.voiceNoBuiltIn || "This browser has no built-in voices; add an ElevenLabs key to read replies aloud.";

  return (
    <div className={cn("divide-y divide-border/65", className)}>
      <Row title={copy.elevenLabsKey || "ElevenLabs key"} description={config.configured ? `${copy.voiceKeyStored || "A key is stored"} (${config.keyHint}). ${copy.voiceKeyReplace || "Enter a new one to replace it."}` : copy.elevenLabsKeyDetail || "Optional. Kept by the local bridge only; the browser never sees it."} htmlFor="voice-key">
        <Input id="voice-key" type="password" value={key} placeholder="xi-…" autoComplete="off" spellCheck={false} onChange={(event) => setKey(event.target.value)} className="max-w-xs" />
        <Button type="button" size="sm" variant="outline" disabled={!key.trim() || Boolean(busy)} onClick={saveKey}>{busy === "key" ? copy.verifying || "Verifying…" : copy.save || "Save"}</Button>
        {config.configured ? <Button type="button" size="sm" variant="ghost" disabled={Boolean(busy)} onClick={removeKey}>{copy.remove || "Remove"}</Button> : null}
      </Row>
      {config.configured ? (
        <Row title={copy.voiceChoice || "Voice"} description={copy.voiceChoiceDetail || "From your ElevenLabs library."}>
          <Select value={config.voiceId || undefined} onValueChange={chooseVoice} disabled={!voices.length || Boolean(busy)}>
            <SelectTrigger className="w-56" aria-label={copy.voiceChoice || "Voice"}>
              <SelectValue placeholder={voices.length ? copy.chooseVoice || "Choose a voice" : copy.loadingVoices || "Loading voices…"} />
            </SelectTrigger>
            <SelectContent>
              {voices.map((voice) => (
                <SelectItem key={voice.id} value={voice.id}>{voice.name}{voice.description ? ` · ${voice.description}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 py-4">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{sentence}</p>
        <Button type="button" size="sm" variant="ghost" disabled={Boolean(busy) || (!builtIn && !config.ready)} onClick={test}>
          <Volume2 data-icon="inline-start" />
          {copy.voiceTest || "Hear a sample"}
        </Button>
      </div>
      {error ? <p className="pt-3 text-sm text-destructive">{error}</p> : null}
      {note ? <p className="pt-3 text-sm text-muted-foreground">{note}</p> : null}
    </div>
  );
}
