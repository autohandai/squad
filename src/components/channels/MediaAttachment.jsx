import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, FileIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { anchorLabel, formatTimestamp, normalizeAnchors, normalizeAttachment } from "@/lib/anchors";
import { cn } from "@/lib/utils";

const MIN_BOX = 0.01;

function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function pointIn(element, event) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

function boxFromPoints(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x);
  const h = Math.abs(a.y - b.y);
  if (w < MIN_BOX || h < MIN_BOX) return null;
  return [x, y, w, h].map((value) => Math.round(value * 1000) / 1000);
}

function RegionOutline({ box, emphasis = false }) {
  if (!box) return null;
  const [x, y, w, h] = box;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute rounded-[3px] border-2 border-primary",
        emphasis ? "bg-primary/10" : "bg-primary/5"
      )}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
    />
  );
}

/**
 * Slim timeline under a video: current position, existing anchors as small
 * ticks, click to seek (or to pick a timestamp while anchoring).
 */
function Scrubber({ duration, current, anchors, onPick, picked, disabled = false, labelledBy }) {
  const ratio = duration > 0 ? Math.min(1, current / duration) : 0;
  const barRef = useRef(null);
  const pick = (event) => {
    if (disabled || !barRef.current || !(duration > 0)) return;
    const { x } = pointIn(barRef.current, event);
    onPick?.(Math.round(x * duration * 100) / 100);
  };
  return (
    <div className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
      <span>{formatTimestamp(current)}</span>
      <div
        ref={barRef}
        role="slider"
        aria-label={labelledBy}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        tabIndex={disabled ? -1 : 0}
        onClick={pick}
        onKeyDown={(event) => {
          if (disabled || !(duration > 0)) return;
          if (event.key === "ArrowLeft") onPick?.(Math.max(0, current - 1));
          if (event.key === "ArrowRight") onPick?.(Math.min(duration, current + 1));
        }}
        className={cn("relative h-4 flex-1 cursor-pointer", disabled && "cursor-default")}
      >
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-border" />
        <div className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-foreground/60" style={{ width: `${ratio * 100}%` }} />
        {anchors.map((anchor, index) =>
          anchor.t !== null && duration > 0 ? (
            <span
              key={`${anchor.attachmentId}-${index}`}
              aria-hidden="true"
              className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
              style={{ left: `${Math.min(1, anchor.t / duration) * 100}%` }}
            />
          ) : null
        )}
        {picked !== null && duration > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
            style={{ left: `${Math.min(1, picked / duration) * 100}%` }}
          />
        ) : null}
      </div>
      <span>{formatTimestamp(duration)}</span>
    </div>
  );
}

/**
 * One media row in a channel message: an inline image (click to anchor) or a
 * video with native controls and a slim scrubber. Anchor mode overlays the
 * media: drag to draw a normalized rectangle; on a video, click the timeline
 * to pick a timestamp. Existing anchors render as small badges that seek the
 * video and outline the region on hover. No cards: the media sits on the page
 * with a restrained radius and a text row underneath.
 */
export function MediaAttachment({ attachment, anchors = [], onAnchor, src, maxHeight = 320, copy = {}, className }) {
  const file = useMemo(() => normalizeAttachment(attachment), [attachment]);
  const own = useMemo(() => normalizeAnchors(anchors).filter((anchor) => anchor.attachmentId === file?.id), [anchors, file?.id]);
  const mediaRef = useRef(null);
  const surfaceRef = useRef(null);
  const [anchoring, setAnchoring] = useState(false);
  const [pickedT, setPickedT] = useState(null);
  const [box, setBox] = useState(null);
  const [drag, setDrag] = useState(null);
  const [hover, setHover] = useState(null);
  const [duration, setDuration] = useState((file?.durationMs || 0) / 1000);
  const [current, setCurrent] = useState(0);

  const isVideo = file?.kind === "video";
  const isImage = file?.kind === "image";
  const source = src || file?.url;

  useEffect(() => {
    if (!anchoring) {
      setBox(null);
      setDrag(null);
      setPickedT(null);
    }
  }, [anchoring]);

  const seek = useCallback((seconds) => {
    const video = mediaRef.current;
    if (!video || !Number.isFinite(seconds)) return;
    try {
      video.currentTime = seconds;
      setCurrent(seconds);
    } catch {
      // metadata not loaded yet
    }
  }, []);

  const beginAnchoring = () => {
    if (!onAnchor || !file) return;
    if (isVideo) {
      mediaRef.current?.pause?.();
      setPickedT(Math.round((mediaRef.current?.currentTime || 0) * 100) / 100);
    }
    setAnchoring(true);
  };

  const finishAnchoring = () => {
    if (!file) return;
    const anchor = { attachmentId: file.id, t: isVideo ? pickedT ?? Math.round(current * 100) / 100 : null, box };
    if (anchor.t === null && !anchor.box) return;
    onAnchor?.(anchor);
    setAnchoring(false);
  };

  const onPointerDown = (event) => {
    if (!anchoring || !surfaceRef.current || event.button !== 0) return;
    event.preventDefault();
    surfaceRef.current.setPointerCapture?.(event.pointerId);
    const start = pointIn(surfaceRef.current, event);
    setDrag({ start, end: start });
    setBox(null);
  };
  const onPointerMove = (event) => {
    if (!drag || !surfaceRef.current) return;
    setDrag((state) => (state ? { ...state, end: pointIn(surfaceRef.current, event) } : state));
  };
  const onPointerUp = (event) => {
    if (!drag || !surfaceRef.current) return;
    const end = pointIn(surfaceRef.current, event);
    setBox(boxFromPoints(drag.start, end));
    setDrag(null);
  };

  if (!file) return null;

  if (!isVideo && !isImage) {
    return (
      <a
        href={source}
        target="_blank"
        rel="noreferrer"
        className={cn("inline-flex max-w-full items-center gap-2 py-1 text-sm text-foreground/90 underline-offset-4 hover:underline", className)}
      >
        <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate">{file.name}</span>
        <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
      </a>
    );
  }

  const liveBox = drag ? boxFromPoints(drag.start, drag.end) : box;
  const hoverBox = hover?.box || null;
  const draftLabel = anchorLabel({ t: isVideo ? pickedT ?? current : null, box }, copy.anchorRegion || "region");

  return (
    <div className={cn("my-1.5 flex max-w-full flex-col gap-1.5", className)}>
      <div
        ref={surfaceRef}
        className={cn(
          "relative inline-block max-w-full select-none overflow-hidden rounded-md",
          anchoring && "cursor-crosshair ring-1 ring-primary/60"
        )}
        style={{ width: "fit-content" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        {isImage ? (
          <img
            ref={mediaRef}
            src={source}
            alt={file.name}
            draggable={false}
            onClick={() => !anchoring && beginAnchoring()}
            className={cn("block h-auto max-w-full", onAnchor && !anchoring && "cursor-zoom-in")}
            style={{ maxHeight }}
          />
        ) : (
          <video
            ref={mediaRef}
            src={source}
            controls={!anchoring}
            preload="metadata"
            playsInline
            draggable={false}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime || 0)}
            className={cn("block h-auto max-w-full bg-black/90", anchoring && "pointer-events-none")}
            style={{ maxHeight }}
          />
        )}
        {anchoring ? <RegionOutline box={liveBox} emphasis /> : <RegionOutline box={hoverBox} />}
        {anchoring ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 px-2 py-1 text-[11px] text-white drop-shadow">
            {copy.anchorHint || (isVideo ? "Drag to outline a region; use the timeline to pick the moment." : "Drag to outline a region.")}
          </div>
        ) : null}
      </div>

      {isVideo ? (
        <Scrubber
          duration={duration}
          current={current}
          anchors={own}
          picked={anchoring ? pickedT : null}
          labelledBy={file.name}
          onPick={(seconds) => {
            seek(seconds);
            if (anchoring) setPickedT(seconds);
          }}
        />
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{file.name}</span>
        {anchoring ? (
          <span className="flex items-center gap-2">
            <span className="tabular-nums text-foreground/80">{draftLabel || (copy.anchorPickHint || "Pick a moment or a region")}</span>
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setAnchoring(false)}>
              {copy.cancel || "Cancel"}
            </Button>
            <Button size="sm" className="h-6 px-2" disabled={!draftLabel} onClick={finishAnchoring}>
              {copy.anchorUse || "Use anchor"}
            </Button>
          </span>
        ) : (
          <>
            {own.map((anchor, index) => (
              <button
                key={`${anchor.attachmentId}-${index}`}
                type="button"
                className={cn(
                  "inline-flex items-center gap-1 rounded-sm border border-border/70 px-1.5 py-px text-[11px] tabular-nums text-foreground/80 transition-colors hover:border-primary/60 hover:text-foreground"
                )}
                onMouseEnter={() => {
                  setHover(anchor);
                  if (isVideo && anchor.t !== null) seek(anchor.t);
                }}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(anchor)}
                onBlur={() => setHover(null)}
                onClick={() => isVideo && anchor.t !== null && seek(anchor.t)}
              >
                <Crosshair className="size-3" aria-hidden="true" />
                {anchorLabel(anchor, copy.anchorRegion || "region")}
              </button>
            ))}
            {onAnchor ? (
              <button
                type="button"
                onClick={beginAnchoring}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                <Crosshair className="size-3" aria-hidden="true" />
                {copy.anchorStart || (isVideo ? "Anchor a moment" : "Anchor a region")}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default MediaAttachment;
