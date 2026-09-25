# Autohand Squad relay

A small self-hosted service that lets two or more people share channels.
Each person's Squad bridge keeps its own `channels.json`; the relay stores the
shared copy and fans out changes over a WebSocket. Members (agents) still run
on the machine of whoever owns them; only channel and message records travel.

No npm dependencies: `node:http`, `node:crypto`, and a hand-rolled RFC 6455
framer (`ws.mjs`). Node 20 or newer.

## Run

```sh
RELAY_TOKENS="igor:s3cret-igor,noah:s3cret-noah" \
node relay/server.mjs --port 8787 --data ./relay-data --host 0.0.0.0
```

| Flag / env | Meaning |
| --- | --- |
| `--port` / `RELAY_PORT` | TCP port (default 8787) |
| `--host` / `RELAY_HOST` | bind address (default 127.0.0.1; use 0.0.0.0 behind a reverse proxy) |
| `--data` / `RELAY_DATA` | data directory (default `./relay-data`) |
| `RELAY_TOKENS` | comma-separated `name:token` (or bare tokens) accepted as people |
| `RELAY_VERIFY_ACCOUNTS=1` | instead of `RELAY_TOKENS`, treat each bearer as an Autohand account token and verify it against `https://api.autohand.ai/v1/profile` (cached five minutes) |
| `RELAY_ACCOUNT_API` | override the profile URL (tests, staging) |

The relay refuses to start with neither `RELAY_TOKENS` nor
`RELAY_VERIFY_ACCOUNTS=1`. Put TLS in front of it (Caddy, nginx, a tunnel);
tokens travel as bearer headers.

Each person configures the same relay URL and workspace name in Squad →
Settings → Relay, with their own token.

## API

Every response is `{ success: true, data }` or `{ success: false, error }`.
Every request needs `Authorization: Bearer <token>` (WebSocket clients may use
`?token=` instead). Workspace ids are lowercase `[a-z0-9._-]`, up to 64 chars.

| Method | Path | Body / query | Notes |
| --- | --- | --- | --- |
| GET | `/v1/health` | | no auth |
| GET | `/v1/workspaces/:ws/channels` | | `{ channels, updatedAt }` |
| PUT | `/v1/workspaces/:ws/channels` | `{ channels: [...] }` | merge, last-writer-wins per `id` by `updatedAt`; changed channels are broadcast |
| GET | `/v1/workspaces/:ws/channels/:id/messages` | `?since=<ISO>&limit=` | messages with `updatedAt >= since`, oldest first |
| POST | `/v1/workspaces/:ws/channels/:id/messages` | one message `{ id, body, updatedAt, ... }` | LWW per `id`; 201 when stored, 200 when the stored copy was newer; `origin` is stamped with the poster when absent |
| GET | `/v1/workspaces/:ws/messages` | `?since=&limit=` | all channels |
| GET | `/v1/workspaces/:ws/presence` | | `{ people: [{ id, name, connections, since }] }` |
| WS | `/v1/workspaces/:ws/stream` | | see below |

Stream events (JSON text frames, each with `workspace` and `at`):

```
{ type: "hello",    person, people }   once, right after connecting
{ type: "message",  message, by }      a message was stored or replaced
{ type: "channel",  channel, by }      a channel was stored or replaced
{ type: "presence", people }           someone joined or left
```

Send `{ "type": "ping" }` to get `{ "type": "pong" }`; the relay also pings
every 30 s at the protocol level.

## Storage

`store.mjs` keeps one JSON document per workspace at
`<data>/workspaces/<ws>.json`, written atomically (temp file + rename) and
capped at 20 000 messages per workspace (oldest by `updatedAt` are dropped).
`server.mjs` only calls `listChannels`, `putChannels`, `putMessage`,
`listMessages`, and `workspaces`, so a Postgres store is a drop-in: implement
those five methods with the same last-writer-wins semantics and pass it as
`startRelay({ store })`. Suggested schema: `channels(workspace, id, doc jsonb,
updated_at)` and `messages(workspace, id, channel_id, doc jsonb, updated_at)`
with `(workspace, updated_at)` indexed for the `since` query.

## Deploy

### systemd

```ini
# /etc/systemd/system/autohand-relay.service
[Unit]
Description=Autohand Squad relay
After=network-online.target

[Service]
User=relay
WorkingDirectory=/opt/autohand-relay
Environment=RELAY_HOST=127.0.0.1
Environment=RELAY_PORT=8787
Environment=RELAY_DATA=/var/lib/autohand-relay
EnvironmentFile=/etc/autohand-relay.env   # RELAY_TOKENS=... (mode 0600)
ExecStart=/usr/bin/node /opt/autohand-relay/relay/server.mjs
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Copy the `relay/` folder to `/opt/autohand-relay/relay`, create the data
directory owned by `relay`, then `systemctl enable --now autohand-relay`. Put
Caddy or nginx in front for TLS and WebSocket pass-through (`Upgrade` and
`Connection` headers must be forwarded).

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY relay ./relay
ENV RELAY_HOST=0.0.0.0 RELAY_PORT=8787 RELAY_DATA=/data
VOLUME /data
EXPOSE 8787
CMD ["node", "relay/server.mjs"]
```

```sh
docker build -t autohand-relay .
docker run -d --name relay -p 8787:8787 -v relay-data:/data \
  -e RELAY_TOKENS="igor:s3cret-igor,noah:s3cret-noah" autohand-relay
```

## Check

`node scripts/check-relay.mjs` starts a relay on a random port, connects two
bridge clients, and asserts sync under one second, last-writer-wins,
presence, reconnect, and offline behaviour.
