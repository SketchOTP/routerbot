export const BUILTIN_PROVIDERS = ["claude", "codex", "cursor", "gemini"];

export const defaultConfig = {
  server: {
    host: "127.0.0.1",
    port: 4117,
    exposedModel: "routerbot-local",
    apiKey: "",
    tailscaleHost: "",
    tailscaleServePort: 9420,
    tailscaleFunnelPort: 10000,
    cursorBaseUrl: ""
  },
  providers: {
    claude: {
      type: "builtin",
      label: "Claude Code",
      icon: "🧠",
      enabled: true,
      command: "claude",
      model: "",
      models: [],
      timeoutMs: 300000
    },
    codex: {
      type: "builtin",
      label: "Codex",
      icon: "⚡",
      enabled: true,
      command: "codex",
      model: "",
      models: [],
      timeoutMs: 300000
    },
    cursor: {
      type: "builtin",
      label: "Cursor Agent",
      icon: "🖱️",
      enabled: true,
      command: "cursor-agent",
      model: "sonnet-4",
      models: [],
      timeoutMs: 300000
    },
    gemini: {
      type: "builtin",
      label: "Gemini CLI",
      icon: "✨",
      enabled: true,
      command: "gemini",
      model: "",
      models: [],
      timeoutMs: 300000
    }
  },
  routing: {
    defaultProvider: "codex",
    fallbackChain: ["codex", "cursor"],
    taskRoutes: {
      code: "codex",
      debug: "codex",
      review: "codex",
      plan: "claude",
      explain: "cursor",
      docs: "claude",
      quick: "cursor"
    }
  }
};
