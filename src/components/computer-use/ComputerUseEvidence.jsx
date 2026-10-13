import { MediaAttachment } from "@/components/channels/MediaAttachment";

export function ComputerUseEvidence({ files = [], compact = false }) {
  if (!files.length) return null;
  const images = files.filter((file) => file.kind === "image");
  const documents = files.filter((file) => file.kind !== "image");
  // The latest annotated action and resulting screen are visible; the complete
  // sequence stays available without turning a long run into a wall of images.
  const preview = images.slice(-2);
  const remaining = [...images.slice(0, -2), ...documents];
  return (
    <div className="mt-3 flex min-w-0 flex-col gap-1" data-testid="computer-use-evidence">
      {preview.map((file) => <MediaAttachment key={file.url} attachment={file} maxHeight={compact ? 180 : 320} />)}
      {remaining.length ? (
        <details className="text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer py-1 underline-offset-4 hover:text-foreground hover:underline">{remaining.length} more evidence {remaining.length === 1 ? "file" : "files"}</summary>
          <div className="flex flex-col gap-1 pt-1">{remaining.map((file) => <MediaAttachment key={file.url} attachment={file} maxHeight={compact ? 180 : 320} />)}</div>
        </details>
      ) : null}
    </div>
  );
}
