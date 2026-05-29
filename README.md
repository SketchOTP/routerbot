<p align="center">
  <img src="public/routerbot.png" alt="RouterBot" width="120" />
</p>

<h1 align="center">RouterBot</h1>

<p align="center">
  <strong>One local OpenAI-compatible endpoint — route to every AI backend you run.</strong>
</p>

<p align="center">
  Claude Code · Codex · Cursor Agent · Gemini CLI · Ollama · vLLM · custom CLIs
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-green.svg" alt="Node 20+" /></a>
</p>

---

RouterBot is a self-hosted **routing proxy** for [Cursor](https://cursor.com). Point Cursor at a single model (`routerbot-local`); RouterBot classifies each request, picks a provider, runs your configured CLIs or HTTP APIs, and falls back automatically when something fails.

No vendor lock-in to one CLI — mix Anthropic, OpenAI, Google, and local models behind one dashboard and one API key.

## Why RouterBot?

| Problem | RouterBot |
|---------|-----------|
| Cursor only talks to one custom model at a time | One base URL, many backends |
| Switching between Claude / Codex / Gemini is manual | Task-based routing (`code` → Codex, `plan` → Claude, …) |
| Remote server has no browser for CLI login | Dashboard opens OAuth/device-login URLs **on your PC** |
| Homelab needs Tailscale + tunnels for Agent mode | Built-in Serve/Funnel helpers and URL preview |
| Want Ollama or vLLM beside cloud CLIs | HTTP providers + generic CLI adapters |

## Features

- **Web dashboard** — enable providers, pick models, authenticate CLIs, live activity log
- **Task routing** — keyword classifier sends `code`, `debug`, `plan`, etc. to different backends
- **Fallback chain** — configurable order when the primary provider errors out
- **Built-in providers** — Claude Code, Codex, Cursor Agent, Gemini CLI
- **Bring your own** — OpenAI-compatible HTTP (Ollama, LM Studio, vLLM) or any stdin CLI
- **Emoji provider icons** — click to customize; set when adding a provider
- **Security** — one API key for `/v1` and admin `/api`; auto-generated on first run
- **Production helpers** — systemd units, Tailscale setup script, health checks

## Quick start

**Requirements:** Node.js 20+, and whichever CLIs you enable on your `PATH`.

```bash
git clone git@github.com:SketchOTP/routerbot.git
cd routerbot
npm install
npm start
```

Open the dashboard: **http://127.0.0.1:4117**

On first run, RouterBot prints a generated API key — save it for Cursor and remote dashboard access.

Optional: seed config from the example:

```bash
mkdir -p data
cp config.example.json data/config.json
# edit tailscaleHost, providers, routing…
```

## Use with Cursor

| Cursor setting | Value |
|----------------|-------|
| **Override OpenAI Base URL** | RouterBot base URL from the dashboard (must end with `/v1`) |
| **API key** | Your RouterBot API key |
| **Model** | `routerbot-local` (or your `server.exposedModel`) |

**Local chat only:** `http://127.0.0.1:4117/v1`

**Cursor Agent mode** needs a public HTTPS URL (Tailscale Funnel, cloudflared, or ngrok) — see [Public access](#public-access-for-cursor-agent).

## Dashboard tour

Sign-in is unified across providers:

| Provider | Flow |
|----------|------|
| Claude / Cursor | Browser link (opens on your PC) |
| Codex | Device URL + one-time code |
| Gemini | Google link + paste authorization code |

- If already signed in, the dashboard shows **Already signed in** (no blank popup).
- Click **Re-sign in** to force a fresh login.
- Health dots refresh automatically after sign-in completes.

```
┌─────────────────────────────────────────────────────────┐
│  Metrics: Base URL · Model · API key · Provider health  │
├─────────────────────────────────────────────────────────┤
│  Providers (cards)     │  Routing · Fallback chain     │
│  · toggle / model      │  · task → provider map        │
│  · sign-in buttons     │  · default provider           │
│  · emoji icons         │                               │
├────────────────────────┴───────────────────────────────┤
│  Activity log (routes, fallbacks, auth)                   │
└─────────────────────────────────────────────────────────┘
```

- **Server settings** (gear) — Tailscale host, funnel ports, API key, exposed model name
- **Add provider** — HTTP API or generic CLI, with icon picker
- **Fallback chain** — reorder providers tried after a failure

## API key

One key protects both the OpenAI API (`/v1`) and the admin API (`/api`).

| How | Steps |
|-----|--------|
| **First startup** | Printed in the terminal when `data/config.json` has no key |
| **Dashboard** | `http://127.0.0.1:4117` → Server settings → API key |
| **Config file** | `grep apiKey data/config.json` |
| **Environment** | `ROUTERBOT_API_KEY=…` (overrides file) |

Rotate anytime in Server settings → **Save** → update Cursor.

If port `4117` is in use, RouterBot is already running (e.g. systemd) — use `sudo systemctl restart routerbot` instead of a second `npm start`.

## Providers

### Built-in CLI backends

| Provider | CLI | Auth |
|----------|-----|------|
| Claude Code | `claude` | Browser sign-in (opens on your PC) |
| Codex | `codex` | Device login + one-time code |
| Cursor Agent | `cursor-agent` | Browser sign-in |
| Gemini CLI | `gemini` | Google OAuth + paste auth code |

### Custom backends

**HTTP** (Ollama, vLLM, LM Studio, any OpenAI-compatible server):

```json
"ollama": {
  "type": "http",
  "label": "Ollama",
  "icon": "🦙",
  "enabled": true,
  "baseUrl": "http://127.0.0.1:11434/v1",
  "model": "llama3.2"
}
```

**Generic CLI** (any tool that reads a prompt on stdin):

```json
"my-cli": {
  "type": "generic-cli",
  "label": "My Tool",
  "icon": "🔧",
  "command": "my-cli",
  "runArgs": ["-m", "{{model}}", "-"],
  "model": "default"
}
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to extend built-in adapters.

## Routing & fallback

1. RouterBot classifies the prompt (`code`, `debug`, `plan`, …).
2. It uses the mapped provider from the dashboard (or `routing.defaultProvider`).
3. On failure, it walks `routing.fallbackChain` (default: `codex` → `cursor`).

Configure both in the **Routing** panel; new providers appear in dropdowns automatically.

## Public access for Cursor Agent

Cursor Agent calls your base URL from the cloud — `localhost` will not work.

### Tailscale (recommended)

```bash
./scripts/tailscale-setup.sh   # once, requires sudo
```

| Port | Use |
|------|-----|
| `9420` | Tailnet dashboard (private) |
| `10000` | Public Funnel → use in Cursor as `https://YOUR_HOST:10000/v1` |

Set `server.tailscaleHost` in the dashboard, then **Save**.

### Quick tunnels

```bash
# cloudflared
cloudflared tunnel --url http://127.0.0.1:4117

# ngrok
ngrok http 4117
```

Use the HTTPS URL + `/v1` in Cursor.

## Run at boot (systemd)

```bash
chmod +x scripts/install-systemd.sh scripts/tailscale-setup.sh scripts/check-routerbot.sh
./scripts/install-systemd.sh
```

```bash
ROUTERBOT_USER=your-user ./scripts/install-systemd.sh
sudo systemctl status routerbot
./scripts/check-routerbot.sh
```

## Configuration

| Source | Purpose |
|--------|---------|
| `data/config.json` | Main config (created at runtime, **not** committed) |
| `config.example.json` | Starter template |
| `.env.example` | Environment variable reference |

| Variable | Description |
|----------|-------------|
| `ROUTERBOT_HOST` | Bind address (default `127.0.0.1`) |
| `ROUTERBOT_PORT` | Port (default `4117`) |
| `ROUTERBOT_API_KEY` | API key override |

## Security

Read **[SECURITY.md](SECURITY.md)** before exposing RouterBot on the public internet.

- Use a strong, unique API key when using Tailscale Funnel or tunnels.
- Never commit `data/config.json` (contains keys and hostnames).
- Tailscale Funnel exposes the full app — protect with key + ACLs.

Built-in CLIs run in read-only / ask modes where supported; custom CLIs run whatever you configure.

## Development

```bash
npm run dev      # watch mode
npm test         # unit tests
npm run check    # tests + release scan
```

## License

MIT © [Tym Huseby](LICENSE)
