import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthMiddleware } from "./auth.js";
import { readConfig, writeConfig } from "./configStore.js";
import { getLogs, subscribeLogs } from "./logStore.js";
import { registerOpenAiRoutes } from "./openaiApi.js";
import { getAuthSession, listModels, runStatus, startAuth, submitGeminiAuthCode } from "./cli.js";
import { tailscaleUrls } from "./tailscaleUrls.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let cachedConfig = await readConfig();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.resolve(__dirname, "../public")));

const getConfig = async () => cachedConfig;
const adminAuth = createAuthMiddleware(getConfig, { allowLocalhost: true });

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", adminAuth);

app.get("/api/config", async (_req, res) => {
  res.json(await getConfig());
});

app.put("/api/config", async (req, res) => {
  cachedConfig = await writeConfig(req.body);
  res.json(cachedConfig);
});

app.get("/api/status", async (_req, res) => {
  const config = await getConfig();
  const statuses = await Promise.all(
    Object.entries(config.providers).map(async ([provider, providerConfig]) => {
      try {
        const result = await runStatus(provider, providerConfig);
        return {
          provider,
          ok: true,
          output: result.stdout || result.stderr
        };
      } catch (error) {
        return {
          provider,
          ok: false,
          output: error.stderr || error.message
        };
      }
    })
  );
  res.json({ statuses });
});

app.get("/api/auth/:provider/session", async (req, res) => {
  const session = getAuthSession(req.params.provider);
  if (!session?.url && !session?.deviceCode) {
    res.status(404).json({ error: "No pending login session" });
    return;
  }
  res.json(session);
});

app.post("/api/auth/:provider/start", async (req, res) => {
  const config = await getConfig();
  const providerConfig = config.providers[req.params.provider];
  if (!providerConfig) {
    res.status(404).json({ error: "Unknown provider" });
    return;
  }
  try {
    res.json(startAuth(req.params.provider, providerConfig));
  } catch (error) {
    res.status(400).json({ error: { message: error.message } });
  }
});

app.post("/api/auth/gemini/code", async (req, res) => {
  try {
    res.json(submitGeminiAuthCode(req.body?.code));
  } catch (error) {
    res.status(400).json({
      error: { message: error.message, type: "routerbot_gemini_auth_code_error" }
    });
  }
});

app.post("/api/providers/:provider/models", async (req, res) => {
  const config = await getConfig();
  const provider = req.params.provider;
  const providerConfig = config.providers[provider];
  if (!providerConfig) {
    res.status(404).json({ error: "Unknown provider" });
    return;
  }

  try {
    const models = await listModels(provider, providerConfig);
    cachedConfig = await writeConfig({
      ...config,
      providers: {
        ...config.providers,
        [provider]: {
          ...providerConfig,
          models
        }
      }
    });
    res.json({ provider, models });
  } catch (error) {
    res.status(500).json({
      error: {
        message: error.message,
        type: "routerbot_model_list_error",
        provider
      }
    });
  }
});

app.get("/api/logs", (_req, res) => {
  res.json({ logs: getLogs() });
});

app.get("/api/logs/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  for (const entry of getLogs().slice().reverse()) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
  const unsubscribe = subscribeLogs((entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });
  req.on("close", unsubscribe);
});

registerOpenAiRoutes(app, getConfig);

const host = process.env.ROUTERBOT_HOST ?? cachedConfig.server.host;
const port = Number(process.env.ROUTERBOT_PORT ?? cachedConfig.server.port);

app.listen(port, host, () => {
  console.log(`RouterBot dashboard: http://${host}:${port}`);
  console.log(`Cursor model:        ${cachedConfig.server.exposedModel}`);
  console.log(`API key:             ${cachedConfig.server.apiKey ? "(configured)" : "(missing — set ROUTERBOT_API_KEY)"}`);
  const ts = tailscaleUrls(cachedConfig.server);
  if (ts) {
    console.log(`Tailnet dashboard:   ${ts.tailnetDashboard}`);
    console.log(`RouterBot base URL:  ${ts.cursorBaseUrl}`);
    console.log(`Run: ./scripts/tailscale-setup.sh (once) to bind Tailscale ports`);
  } else {
    console.log(`RouterBot base URL:  http://${host}:${port}/v1`);
    console.log(`Set server.tailscaleHost in config for Tailscale URLs`);
  }
});
