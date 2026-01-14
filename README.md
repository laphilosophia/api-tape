# 📼 API Tape

**Record and Replay HTTP API responses for offline development.**

API Tape is a zero-config CLI tool that acts as a transparent HTTP proxy. It records API responses to local JSON files ("tapes") and replays them instantly—perfect for offline development, flaky API testing, and reproducible demos.

## ✨ Features

- 🎬 **Record Mode** — Proxies requests to your target API and saves responses
- 🔄 **Replay Mode** — Serves cached responses instantly from disk
- 📦 **Zero Config** — Works out of the box with sensible defaults
- 🔒 **Binary Safe** — Handles images, compressed responses, and any content type
- 🏷️ **Replay Header** — Responses include `X-Api-Tape: Replayed` for easy debugging

## 📦 Installation

```bash
npm install -g api-tape
```

Or use it directly with npx:

```bash
npx api-tape --target "https://api.example.com" --mode record
```

## 🚀 Quick Start

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

You'll see `↺ REPLAY GET /todos/1` — the response comes from disk, no network needed!

## ⚙️ CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --target <url>` | Target API URL **(required)** | — |
| `-m, --mode <mode>` | Operation mode: `record` or `replay` | `replay` |
| `-p, --port <number>` | Local server port | `8080` |
| `-d, --dir <path>` | Directory to save tapes | `./tapes` |

## 📁 Tape Format

Each tape is a JSON file named with an MD5 hash of `METHOD|URL`:

```json
{
  "meta": {
    "url": "/todos/1",
    "method": "GET",
    "timestamp": "2026-01-14T19:12:39.000Z"
  },
  "statusCode": 200,
  "headers": { ... },
  "body": "eyJ1c2VySWQiOjEsImlkIjoxLC..."
}
```

The body is base64-encoded for binary safety.

## 🎯 Use Cases

- **Offline Development** — Work without internet or VPN
- **Flaky API Testing** — Eliminate network inconsistencies in tests
- **Demo Environments** — Reproducible API responses for presentations
- **Rate Limit Bypass** — Develop against recorded responses

## 📄 License

MIT © [Erdem Arslan](https://github.com/laphilosophia)
