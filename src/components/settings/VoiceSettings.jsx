import { useEffect, useState } from "react";
import { ArrowRight, Square, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cachedMemberVoices, voiceById } from "@/lib/member-voice";
import { getPageReader } from "@/lib/read-aloud";
import { cn } from "@/lib/utils";

/**
 * Settings → Voice (ADR-0276): replies are read by kale-tts-1, a speech model
 * that runs on this computer; each member has its own voice, chosen from its
 * name and role and changed in its profile. No key, no account, nothing sent
 * anywhere. Lists the squad with each member's voice and a sample.
 */
export function VoiceSettings({ api, agents = [], navigate, copy = {}, className }) {
  const reader = getPageReader();
  const [engine, setEngine] = useState(null);
  const [state, setState] = useState(() => reader.snapshot());
  useEffect(() => reader.subscribe(setState), [reader]);
  useEffect(() => { api?.("/api/voice/settings").then(setEngine).catch(() => setEngine({ available: false })); }, [api]);
  const members = agents.filter((agent) => agent?.id && !agent.removed);
  const voices = cachedMemberVoices(agents);

  function play(member, voice) {
    const id = `settings-voice-${member.id}`;
    if (state.id === id) { reader.stop(); return; }
    reader.speak({ id, text: `Hi, I'm ${member.name}. This is how I'll sound when I read my replies to you.`, voice: voice.id });
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} data-testid="voice-settings">
      <p className="text-sm text-muted-foreground">
        {engine === null ? "Checking the voice…"
          : engine?.available ? "Replies are read by a speech model that runs on this computer. Nothing you read aloud leaves it, and it works offline."
            : "The voice model is missing from this copy of Squad, so replies use this computer's built-in voice. Reinstall Squad to get it back."}
      </p>
      <section aria-labelledby="squad-voices">
        <h3 id="squad-voices" className="text-sm font-semibold">{copy.squadVoices || "Your squad's voices"}</h3>
        <p className="mt-1 text-sm text-muted-foreground">Each member has its own voice, picked from its name and role. Change it in the member's profile.</p>
        <div className="mt-3 divide-y divide-border/70 border-y border-border/70">
          {members.length ? members.map((member) => {
            const voice = voiceById(voices.get(member.id));
            const playing = state.id === `settings-voice-${member.id}` && state.status !== "idle";
            return (
              <div key={member.id} className="flex items-center gap-3 py-2.5" data-testid="voice-settings-member">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{member.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{voice ? `${voice.name} · ${voice.description}` : "No voice"}</p>
                </div>
                {voice ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={playing ? "Stop" : `Hear ${member.name}`} onClick={() => play(member, voice)}>
                    {playing ? <Square className="size-3 fill-current" /> : <Volume2 />}
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" size="sm" onClick={() => navigate?.(`/squad-members/${encodeURIComponent(member.id)}/voice`)}>
                  Change<ArrowRight data-icon="inline-end" />
                </Button>
              </div>
            );
          }) : <p className="py-3 text-sm text-muted-foreground">Add a member to hear its voice.</p>}
        </div>
      </section>
      <p className="text-xs text-muted-foreground">Voices by kale-tts-1 (Kale, Apache-2.0). They are synthetic and belong to no real person.</p>
    </div>
  );
}
