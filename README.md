# API Tape

**High-integrity HTTP proxy for deterministic API record & replay.**

API Tape is a zero-config CLI tool that acts as a transparent HTTP proxy. It records API responses to local JSON files ("tapes") and replays them instantly—perfect for offline development, flaky API testing, and reproducible demos.

> [!NOTE]
> **v1.6.1 Highlights**: Now includes a full CLI management suite (`tape`), advanced Match Strategies for non-deterministic APIs, and deep JSON/Header redaction for security compliance.

## Features

- **Record Mode** — Proxies requests to your target API and saves responses
- **Replay Mode** — Serves cached responses instantly from disk
- **Hybrid Mode** — Replays cached tapes, falls back to upstream on cache miss
- **Forensic CLI** — List, inspect, clear, and prune tapes with `tape`
- **Security Redaction** — Mask sensitive response headers and JSON body paths
- **Non-Deterministic Matching** — Handle shifting query params and unstable JSON bodies
- **Runtime Metrics** — Real-time and shutdown stats for hit rates and latency
- **Binary Safe** — Handles images, compressed payloads, and any content type
- **Replay Header** — Responses include `X-Api-Tape: Replayed` for easy debugging

---

## Installation

```bash
npm install -g @laphilosophia/api-tape
```

Or use it directly with npx:

```bash
npx @laphilosophia/api-tape --target "https://api.example.com" --mode record
```

---

## Quick Start

### Step 1: Record API Responses

```bash
tape --target "https://jsonplaceholder.typicode.com" --mode record
```

In another terminal:

```bash
curl http://localhost:8080/todos/1
```

You'll see `● RECORD GET /todos/1` in the terminal and a new tape file in `./tapes/`.

### Step 2: Replay Offline

Stop the server and restart in replay mode:

```bash
tape --target "https://jsonplaceholder.typicode.com" --mode replay
```

```bash
curl http://localhost:8080/todos/1
```

You'll see `↺ REPLAY_HIT GET /todos/1` — the response comes from disk, no network needed!

### Step 3: Hybrid Mode (Replay + Fallback)

Run in hybrid mode to replay from disk and fallback to upstream when a tape is missing:

```bash
tape --target "https://jsonplaceholder.typicode.com" --mode hybrid --record-on-miss true
```

- If a tape exists → replayed instantly.
- If tape is missing → upstream request is proxied.
- With `--record-on-miss true`, miss responses are automatically saved as new tapes.

---

## CLI Options

### Serve command

Both legacy mode (`tape --target ...`) and explicit serve command (`tape serve --target ...`) are supported.

| Option                        | Description                                                    | Default   |
| ----------------------------- | -------------------------------------------------------------- | --------- |
| `-t, --target <url>`          | Target API URL **(required)**                                  | —         |
| `-m, --mode <mode>`           | Operation mode: `record`, `replay`, or `hybrid`                | `replay`  |
| `-p, --port <number>`         | Local server port                                              | `8080`    |
| `-d, --dir <path>`            | Directory to save tapes                                        | `./tapes` |
| `--record-on-miss <boolean>`  | In hybrid mode, save upstream response when tape is missing    | `true`    |
| `--redact-header <headers>`   | Comma-separated **response** header names to redact            | —         |
| `--redact-json-path <paths>`  | Comma-separated JSON paths to redact in response bodies        | —         |
| `--stats-interval <seconds>`  | Emit runtime metrics every N seconds (`0` disables)            | `0`       |
| `--stats-json`                | Emit metrics as JSON lines                                     | `false`   |
| `--match-strategy <strategy>` | Tape matching strategy: `exact`, `normalized`, or `body-aware` | `exact`   |

### Runtime stats

```bash
tape serve --target "https://jsonplaceholder.typicode.com" --mode hybrid --stats-interval 10
```

For machine-readable output:

```bash
tape serve --target "https://jsonplaceholder.typicode.com" --stats-interval 10 --stats-json
```

On shutdown, API Tape flushes one immediate `STATS` snapshot (if interval is enabled) and always prints a final summary (`FINAL_STATS`).

### Redaction options

```bash
tape serve --target "https://api.example.com" --mode record \
  --redact-header authorization,cookie \
  --redact-json-path user.profile.email,token
```

`--redact-json-path` applies only when response `content-type` is JSON.

### Match Strategies

Use these strategies to handle non-deterministic API behaviors and improve replay hit rates:

- **`exact`** (default): Hashes the literal `METHOD|URL`. Use for simple, static APIs.
- **`normalized`**: Canonicalizes query parameters by sorting them alphabetically.
  - Transforms: `/search?page=1&q=test` → `/search?q=test&page=1`
  - _Benefit_: Drastically improves hit rates for clients that send query params in varying orders.
- **`body-aware`**: Combines the normalized URL with a canonicalized request body signature.
  - Handles: Differences in JSON key order or spacing in POST/PUT requests.
  - _Benefit_: Essential for GraphQL or complex REST APIs where the same URL is used for different operations based on the body payload.

### Tape management commands

Manage your forensic substrate with built-in tape utilities:

```bash
# List all recorded tapes with their method, route, and timestamp
tape list --dir ./tapes

# Inspect a specific tape's metadata, status, and headers
tape inspect <hash> --dir ./tapes

# Clear all tapes from a directory (requires --yes confirmation)
tape clear --yes --dir ./tapes

# Prune tapes older than N days to keep your local environment clean
tape prune --older-than 30 --dir ./tapes
```

---

## Tape Format

Each tape is a JSON file named with an MD5 hash of `METHOD|URL`:

```json
{
  "schemaVersion": 1,
  "meta": {
    "url": "/todos/1",
    "method": "GET",
    "timestamp": "2026-01-14T19:12:39.000Z",
    "matchStrategy": "normalized"
  },
  "statusCode": 200,
  "headers": { ... },
  "body": "eyJ1c2VySWQiOjEsImlkIjoxLC..."
}
```

The body is base64-encoded for binary safety.

---

## Development

```bash
npm run build
npm test
```

---

## CI

A GitHub Actions workflow runs `npm test` on both Linux and Windows for pushes and pull requests.

---

## Use Cases

- **Offline Development** — Work without internet or VPN
- **Flaky API Testing** — Eliminate network inconsistencies in tests
- **Demo Environments** — Reproducible API responses for presentations
- **Rate Limit Bypass** — Develop against recorded responses

---

## License

MIT © [Erdem Arslan](https://github.com/laphilosophia)
