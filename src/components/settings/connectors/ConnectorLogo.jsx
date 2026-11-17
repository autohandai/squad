import { useState } from "react";

import { connectorLogo } from "@/lib/connector-logos";
import { cn } from "@/lib/utils";

/**
 * A connector's mark on a small neutral tile: the bundled brand path when
 * Squad has one, the registry's own icon otherwise (loaded without a
 * referrer), and the first letter when neither is available or the icon
 * fails to load. Decorative: the name beside it carries the meaning.
 */
export function ConnectorLogo({ logo = "", icon = "", iconDark = "", name = "", size = 28, className }) {
  const [broken, setBroken] = useState(false);
  const mark = connectorLogo(logo);
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const source = !broken ? (dark && iconDark ? iconDark : icon) : "";
  return (
    <span
      aria-hidden="true"
      data-connector-logo={mark ? logo : source ? "registry" : "letter"}
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-background text-muted-foreground", className)}
      style={{ width: size, height: size }}
    >
      {mark ? (
        <svg viewBox="0 0 24 24" width={Math.round(size * 0.58)} height={Math.round(size * 0.58)} fill={mark.color} className="text-foreground">
          <path d={mark.path} />
        </svg>
      ) : source ? (
        <img src={source} alt="" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} referrerPolicy="no-referrer" loading="lazy" draggable={false} onError={() => setBroken(true)} className="object-contain" />
      ) : (
        <span className="text-xs font-semibold uppercase" style={{ fontSize: Math.round(size * 0.42) }}>{String(name || "?").trim().charAt(0) || "?"}</span>
      )}
    </span>
  );
}
