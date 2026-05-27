import fs from "node:fs/promises";
import path from "node:path";
import { generateApiKey } from "./auth.js";
import { BUILTIN_PROVIDERS, defaultConfig } from "./defaultConfig.js";

const dataDir = path.resolve(process.cwd(), "data");
const configPath = path.join(dataDir, "config.json");

function mergeProviders(baseProviders, incomingProviders) {
  const merged = {};
  const keys = new Set([...Object.keys(baseProviders ?? {}), ...Object.keys(incomingProviders ?? {})]);

  for (const key of keys) {
    merged[key] = {
      ...(baseProviders?.[key] ?? {}),
      ...(incomingProviders?.[key] ?? {})
    };
  }
  return merged;
}

export function mergeConfig(base, incoming) {
  return {
    ...base,
    ...incoming,
    server: { ...base.server, ...incoming?.server },
    providers: mergeProviders(base.providers, incoming?.providers),
    routing: {
      ...base.routing,
      ...incoming?.routing,
      taskRoutes: { ...base.routing.taskRoutes, ...incoming?.routing?.taskRoutes },
      fallbackChain: incoming?.routing?.fallbackChain ?? base.routing.fallbackChain
    }
  };
}

function applyEnvOverrides(config) {
  if (process.env.ROUTERBOT_API_KEY) {
    config.server.apiKey = process.env.ROUTERBOT_API_KEY;
  }
  if (process.env.ROUTERBOT_HOST) {
    config.server.host = process.env.ROUTERBOT_HOST;
  }
  if (process.env.ROUTERBOT_PORT) {
    config.server.port = Number(process.env.ROUTERBOT_PORT);
  }
  return config;
}

async function ensureApiKey(config, persist) {
  if (process.env.ROUTERBOT_API_KEY || config.server.apiKey) {
    return config;
  }
  const next = {
    ...config,
    server: { ...config.server, apiKey: generateApiKey() }
  };
  if (persist) {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    console.log("Generated RouterBot API key (saved to data/config.json)");
    console.log(`  ${next.server.apiKey}`);
  }
  return next;
}

export async function readConfig() {
  let config;
  try {
    const raw = await fs.readFile(configPath, "utf8");
    config = mergeConfig(defaultConfig, JSON.parse(raw));
    config = await ensureApiKey(config, false);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not read config, using defaults: ${error.message}`);
    }
    config = mergeConfig(defaultConfig, {});
    config = await ensureApiKey(config, true);
  }
  return applyEnvOverrides(config);
}

export async function writeConfig(nextConfig) {
  const merged = mergeConfig(defaultConfig, nextConfig);
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return applyEnvOverrides(merged);
}

export { BUILTIN_PROVIDERS, configPath, dataDir };
