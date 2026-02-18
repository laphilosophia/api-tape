# API Tape

**Record and Replay HTTP API responses for offline development.**

API Tape is a zero-config CLI tool that acts as a transparent HTTP proxy. It records API responses to local JSON files ("tapes") and replays them instantly—perfect for offline development, flaky API testing, and reproducible demos.

## Features

- **Record Mode** — Proxies requests to your target API and saves responses
- **Replay Mode** — Serves cached responses instantly from disk
- **Hybrid Mode** — Replays cached tapes, falls back to upstream on cache miss
- **Tape Management Commands** — List, inspect, clear, and prune tapes from CLI
- **Header Redaction** — Mask sensitive response headers before writing tapes
- **JSON Body Redaction** — Redact selected JSON paths before persisting response bodies
- **Runtime Metrics** — Periodic and shutdown stats for replay hit/miss, upstream calls, and latency
- **Zero Config** — Works out of the box with sensible defaults
- **Binary Safe** — Handles images, compressed responses, and any content type
- **Replay Header** — Responses include `X-Api-Tape: Replayed` for easy debugging
- **Versioned Tape Schema** — Each tape includes `schemaVersion` for compatibility checks
- **Match Strategies** — `exact` and `normalized` matching for better replay hit rates

---

## Installation

```bash
npm install -g api-tape
```

Or use it directly with npx:

```bash
npx api-tape --target "https://api.example.com" --mode record
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
| `--redact-header <headers>`   | Comma-separated response header names to redact in saved tapes | —         |
| `--redact-json-path <paths>`  | Comma-separated JSON paths to redact in JSON response bodies   | —         |
| `--stats-interval <seconds>`  | Emit runtime metrics every N seconds (`0` disables)            | `0`       |
| `--stats-json`                | Emit metrics as JSON lines                                     | `false`   |
| `--match-strategy <strategy>` | Tape matching strategy: `exact` or `normalized`                | `exact`   |

### Runtime stats

```bash
tape serve --target "https://jsonplaceholder.typicode.com" --mode hybrid --stats-interval 10
```

For machine-readable output:

```bash
tape serve --target "https://jsonplaceholder.typicode.com" --stats-interval 10 --stats-json
```

On shutdown, API Tape always prints a final summary (`FINAL_STATS`).

### Redaction options

```bash
tape serve --target "https://api.example.com" --mode record \
  --redact-header authorization,cookie \
  --redact-json-path user.profile.email,token
```

`--redact-json-path` applies only when response `content-type` is JSON.

### Match strategy

- `exact` (default): hashes `METHOD|URL` as-is.
- `normalized`: sorts query params before hashing, so `/search?a=1&b=2` and `/search?b=2&a=1` map to the same tape.

### Tape management commands

```bash
tape tape list --dir ./tapes
tape tape inspect <hash> --dir ./tapes
tape tape clear --yes --dir ./tapes
tape tape prune --older-than 30 --dir ./tapes
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
