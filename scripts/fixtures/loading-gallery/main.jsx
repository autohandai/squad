// The six loading patterns on one canvas, for check-loading-states-browser
// (ADR-0284). Uses only the app's own components and stylesheet; layout here
// is inline so Tailwind's source list stays the app's.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/styles.css";
import { IndeterminateBar, LoadingProgress, ProgressChecklist, SaveStatus, TextShimmer } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { AgentTaskChecklist } from "@/components/chat/AgentTaskChecklist";

const params = new URLSearchParams(location.search);
document.documentElement.classList.add(params.get("theme") === "dark" ? "dark" : "light");
const frozen = params.get("step");

const tile = { display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: 240 };
const card = { position: "relative", width: 220, padding: 14, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)", boxShadow: "0 1px 2px rgb(0 0 0 / .04)", overflow: "hidden" };
const caption = { fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "var(--muted)", color: "var(--muted-foreground)" };
const pill = { display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--card)" };

function Tile({ name, children }) {
  return <section data-pattern={name} style={tile}>{children}<span style={caption}>{name}</span></section>;
}

function Gallery() {
  const [tick, setTick] = useState(frozen ? Number(frozen) : 0);
  useEffect(() => { if (frozen) return undefined; const id = setInterval(() => setTick(value => value + 1), 700); return () => clearInterval(id); }, []);
  const percent = Math.min(100, (tick * 9) % 110);
  const step = tick % 5;
  const steps = ["Reading files", "Searching", "Writing"].map((title, index) => ({ id: title, title, status: index < step - 1 ? "completed" : index === step - 1 ? "in_progress" : "pending" }));
  const message = { id: "m", status: "loading", taskProgress: { items: steps.map(item => ({ ...item })) } };
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--background)", color: "var(--foreground)", fontFamily: "var(--font-sans)", padding: 40 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 240px)", gap: "48px 24px" }}>
        <Tile name="Progress bar"><div style={{ ...pill, width: 200 }}><LoadingProgress value={percent} label="Upload" style={{ flex: 1 }} /></div></Tile>
        <Tile name="Spinner"><div style={pill}><SaveStatus state={percent >= 100 ? "saved" : "saving"} className="text-foreground" /></div></Tile>
        <Tile name="Text shimmer"><div style={pill}><TextShimmer className="text-xs">Thinking…</TextShimmer></div></Tile>
        <Tile name="Skeleton"><div style={card}><div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}><Skeleton className="size-7 rounded-full" /><div style={{ flex: 1, display: "grid", gap: 6 }}><Skeleton className="h-2.5 w-3/5" /><Skeleton className="h-2 w-2/5" /></div></div><div style={{ display: "grid", gap: 6 }}><Skeleton className="h-2 w-full" /><Skeleton className="h-2 w-4/5" /></div></div></Tile>
        <Tile name="Indeterminate bar"><div style={{ ...card, paddingTop: 18 }}><IndeterminateBar style={{ position: "absolute", top: 0, left: 0 }} /><div style={{ display: "grid", gap: 8 }}><div style={{ height: 8, width: "55%", borderRadius: 4, background: "var(--muted)" }} /><div style={{ height: 6, width: "90%", borderRadius: 4, background: "var(--muted)" }} /><div style={{ height: 6, width: "70%", borderRadius: 4, background: "var(--muted)" }} /></div></div></Tile>
        <Tile name="Progress checklist"><div style={card}><ProgressChecklist steps={steps} live label="Member progress" /></div></Tile>
      </div>
      <div style={{ marginTop: 48, width: 520 }} data-pattern="Member task checklist">
        <AgentTaskChecklist message={message} progress={message.taskProgress} isLoading />
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}><Spinner className="size-3.5" aria-label="Working" /><span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Spinner alone</span></div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<Gallery />);
