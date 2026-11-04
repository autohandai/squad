# ADR-0176: Member artifacts share the knowledge library

Date: 2026-11-04
Status: Accepted

## Context and evidence

The requested examples show a generated deliverable in chat, a member's Library and a large interactive preview. Squad already has canonical member identities, durable chat receipts and a collected memory library with ownership and source links, but no registry of agent-created files. Treating a promise in a reply as a file, or recursively scanning all project files, would create false artifacts and lose the creating member's provenance.

Inspection of Tauri 2.11.6 and Wry 0.55.1 established a native-specific constraint. Tauri's invoke initialization and secret key are injected in the main frame only. Raw WebKit IPC is reachable from frames but rejects calls without that key. Generated HTML must remain an opaque subframe and must never become a native main-frame page. This is stronger than simply putting an HTTP file URL in an iframe and hoping links stay there.

## Decision

Members publish a completed workspace file with `squad_publish_artifact`, available through the same managed MCP connection on every engine. The active turn supplies the owner, workspace and work/thread provenance; tool arguments cannot choose another member. Resolve and validate paths, reject workspace/symlink escapes and changing files, bound file size, and save a hashed snapshot. Serving verifies that hash. Updating the same member/workspace/path keeps its identity and increments its revision; later workspace edits do not silently replace the snapshot.

Append the successful publication's durable link to the reply. Render that link as an artifact document control, opening the same preview as the member's Library. The Library uses existing member navigation and a dated, searchable divider list. Download returns the original saved bytes. An explicit Open in browser command validates the main window, exact bridge origin and saved ID before using the system browser.

Collect artifact titles/descriptions into the existing memory library as member-owned artifact sources with a link back to the saved file. Search, groups, curation and existing memory access rules remain in one service. Do not index arbitrary file contents or script text. A collection-source setting can exclude artifacts without deleting files. Library records remain attributed to their creator rather than becoming unowned team notes.

HTML preview is fetched as text and mounted as `srcdoc` with a first-in-document resource policy, in an iframe allowing scripts but not same-origin access. Inline interaction works while parent DOM/storage and ordinary bridge fetches are blocked. Native navigation to artifact HTTP bodies is denied, including information windows; previews use srcdoc/blob frames instead. PDF is a sandboxed blob frame, images render as images, text/Markdown stay readable, and other formats offer download. Browser opening is explicit, not a native main-frame navigation.

## Consequences and limits

An artifact exists only after a real file was published successfully. Existing arbitrary workspace files are not silently imported; a member can publish an existing deliverable when asked. The UI lists the current published revision, not a complete revision-history editor. Saved blobs are retained; lifecycle/storage collection is not implemented here. A file can be up to 20 MB and the registry holds up to 5,000 current entries.

Knowledge collection stores the artifact's description and provenance, not its entire binary or HTML body. Sharing a memory source does not implicitly grant another member tool access to private artifact bytes. Missing or removed members' files are not reassigned to someone else. Preview resource connections are restricted; external libraries/assets may need a standalone export. Arbitrary HTML network/navigation capabilities are not a general browser sandbox guarantee. No live provider success is inferred from mock engine tests.

## Verification

`check-artifacts.mjs` exercises authenticated managed-tool publication, saved snapshots and revisions, persistence, original-byte export, ownership, path escapes, inactive turns, hash failures, knowledge search and collection exclusions. Playwright runs an isolated fixture engine through the actual bridge and managed stdio MCP, creates a report, and opens it from chat, member Library and knowledge links. It checks inline interaction and attempted parent/storage/bridge access. Early first-click checks failed during the preview entrance; the preview now mounts after file loading and opens without zoom. Its regression clicks the embedded control immediately, without a settling timer. Rust tests verify native document-navigation guards.

A separate macOS fixture with its own app identifier, home/data folders and loopback ports verified the native Library, interactive HTML, blocked parent DOM/storage, absent Tauri bootstrap, exact original-byte download and system-browser opening in Chrome. Its knowledge entry appeared with the member filter and local TurboVec indexing. The test binary was locally ad-hoc signed; this establishes native behavior, not published-release notarization. No real provider requests or production profile resets were used.
