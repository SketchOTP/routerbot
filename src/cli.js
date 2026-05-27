import { spawn } from "node:child_process";
import { clearAuthSession, getAuthSession, ingestAuthOutput } from "./authSessions.js";
import { checkGeminiAuthStatus, loadGeminiCliModelCatalog } from "./geminiModels.js";
import { checkHttpStatus, listHttpModels, runHttpProvider } from "./httpProvider.js";
import { addLog } from "./logStore.js";

export { getAuthSession };

const providerSpecs = {
  claude: {
    authArgs: ["auth", "login"],
    statusArgs: ["auth", "status"],
    modelsArgs: null,
    fallbackModels: [
      { id: "sonnet", name: "Sonnet (latest alias)" },
      { id: "opus", name: "Opus (latest alias)" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-6", name: "Claude Opus 4.6" }
    ],
    runArgs: ({ model }) => [
      "-p",
      "--output-format",
      "text",
      "--permission-mode",
      "dontAsk",
      "--tools",
      "",
      ...modelArg("--model", model)
    ]
  },
  codex: {
    authArgs: ["login", "--device-auth"],
    statusArgs: ["login", "status"],
    modelsArgs: ["debug", "models"],
    runArgs: ({ model }) => [
      "--ask-for-approval",
      "never",
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      ...modelArg("--model", model),
      "-"
    ]
  },
  cursor: {
    authArgs: ["login"],
    statusArgs: ["status"],
    modelsArgs: ["models"],
    runArgs: ({ model }) => [
      "--print",
      "--trust",
      "--mode",
      "ask",
      ...modelArg("--model", model)
    ]
  },
  gemini: {
    authArgs: [],
    statusArgs: null,
    modelsArgs: null,
    fallbackModels: [
      { id: "auto", name: "Auto (recommended alias)" },
      { id: "pro", name: "Pro alias" },
      { id: "flash", name: "Flash alias" },
      { id: "flash-lite", name: "Flash Lite alias" },
      { id: "auto-gemini-3", name: "Auto (Gemini 3)" },
      { id: "auto-gemini-2.5", name: "Auto (Gemini 2.5)" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
      { id: "gemini-3-pro-preview", name: "Gemini 3 Pro (preview)" },
      { id: "gemini-3-flash-preview", name: "Gemini 3 Flash (preview)" },
      { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (preview)" },
      { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite (preview)" }
    ],
    runArgs: ({ model }) => [
      "--skip-trust",
      "--approval-mode",
      "plan",
      "-o",
      "text",
      ...modelArg("-m", model)
    ]
  }
};

function providerType(provider, providerConfig) {
  if (providerConfig?.type === "http") {
    return "http";
  }
  if (providerConfig?.type === "generic-cli") {
    return "generic-cli";
  }
  if (providerSpecs[provider]) {
    return "builtin";
  }
  throw new Error(`Unknown provider: ${provider}`);
}

function buildGenericSpec(providerConfig) {
  return {
    authArgs: providerConfig.authArgs ?? [],
    statusArgs: providerConfig.statusArgs ?? null,
    modelsArgs: providerConfig.modelsArgs ?? null,
    fallbackModels: providerConfig.fallbackModels ?? [],
    runArgs: ({ model }) => expandArgs(providerConfig.runArgs ?? ["-"], model)
  };
}

export function expandArgs(args, model) {
  return args.map((arg) => String(arg).replaceAll("{{model}}", model ?? ""));
}

function envForProvider(provider) {
  const env = { ...process.env, NO_COLOR: "1" };
  if (provider !== "gemini") {
    return env;
  }
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  delete env.GOOGLE_GENAI_USE_VERTEXAI;
  delete env.GOOGLE_GENAI_USE_GCA;
  env.GEMINI_DEFAULT_AUTH_TYPE = "oauth-personal";
  return env;
}

/** Let CLIs open a browser on the host when a display exists; dashboard also opens the login URL on your PC. */
function authEnvForProvider(provider) {
  const env = envForProvider(provider);
  delete env.NO_BROWSER;
  delete env.NO_OPEN_BROWSER;
  return env;
}

function modelArg(flag, model) {
  return model ? [flag, model] : [];
}

export function getProviderSpec(provider, providerConfig) {
  const type = providerType(provider, providerConfig);
  if (type === "http") {
    return null;
  }
  if (type === "generic-cli") {
    return buildGenericSpec(providerConfig);
  }
  const spec = providerSpecs[provider];
  if (!spec) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return spec;
}

export async function runStatus(provider, providerConfig) {
  const type = providerType(provider, providerConfig);

  if (type === "http") {
    return checkHttpStatus(provider, providerConfig);
  }

  if (provider === "gemini") {
    const result = checkGeminiAuthStatus();
    addLog({
      type: "status",
      provider,
      level: result.ok ? "info" : "warn",
      message: result.output
    });
    if (result.ok) {
      return { stdout: result.output, stderr: "", code: 0 };
    }
    const error = new Error(result.output);
    error.stderr = result.output;
    throw error;
  }

  const spec = getProviderSpec(provider, providerConfig);
  if (!spec.statusArgs?.length) {
    return { stdout: "No status command configured", stderr: "", code: 0 };
  }

  return runProcess({
    provider,
    command: providerConfig.command,
    args: spec.statusArgs,
    timeoutMs: 30000,
    logType: "status"
  });
}

export async function listModels(provider, providerConfig) {
  const type = providerType(provider, providerConfig);

  if (type === "http") {
    return listHttpModels(provider, providerConfig);
  }

  const spec = getProviderSpec(provider, providerConfig);

  if (provider === "gemini") {
    const models = includeSelectedModel(
      loadGeminiCliModelCatalog(providerConfig.command) ?? spec.fallbackModels ?? [],
      providerConfig.model
    );
    addLog({
      type: "models",
      provider,
      level: "info",
      message: `Loaded ${models.length} models from Gemini CLI catalog`
    });
    return models;
  }

  if (!spec.modelsArgs) {
    const models = includeSelectedModel(spec.fallbackModels ?? [], providerConfig.model);
    addLog({
      type: "models",
      provider,
      level: "info",
      message: `Using fallback model list (${models.length} models)`
    });
    return models;
  }

  const result = await runProcess({
    provider,
    command: providerConfig.command,
    args: spec.modelsArgs,
    timeoutMs: 60000,
    logType: "models"
  });

  const models = includeSelectedModel(parseModels(provider, result.stdout), providerConfig.model);
  addLog({
    type: "models",
    provider,
    level: "info",
    message: `Loaded ${models.length} models`
  });
  return models;
}

let geminiAuthSession = null;

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

function stopGeminiAuthSession(reason) {
  if (!geminiAuthSession) {
    return;
  }
  const { child } = geminiAuthSession;
  geminiAuthSession = null;
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  if (reason) {
    addLog({ type: "auth", provider: "gemini", level: "info", message: reason });
  }
}

function startGeminiAuth(providerConfig) {
  stopGeminiAuthSession("Replacing pending Gemini login");
  clearAuthSession("gemini");

  const child = spawn("script", ["-qfec", providerConfig.command, "/dev/null"], {
    cwd: process.cwd(),
    env: { ...authEnvForProvider("gemini"), NO_BROWSER: "true" },
    stdio: ["pipe", "pipe", "pipe"]
  });

  let buffer = "";
  let urlLogged = false;

  const handleChunk = (chunk, level) => {
    const raw = chunk.toString();
    buffer += raw;
    const plain = stripAnsi(raw).trim();
    if (plain) {
      addLog({ type: "auth", provider: "gemini", level, message: plain });
    }
    const session = ingestAuthOutput("gemini", buffer);
    if (session?.url && !urlLogged) {
      urlLogged = true;
      addLog({
        type: "auth",
        provider: "gemini",
        level: "info",
        message: `Open Google sign-in in your browser: ${session.url}`
      });
    }
  };

  child.stdout.on("data", (chunk) => handleChunk(chunk, "info"));
  child.stderr.on("data", (chunk) => handleChunk(chunk, "warn"));
  child.on("error", (error) => {
    geminiAuthSession = null;
    addLog({ type: "auth", provider: "gemini", level: "error", message: error.message });
  });
  child.on("exit", (code, signal) => {
    geminiAuthSession = null;
    addLog({
      type: "auth",
      provider: "gemini",
      level: code === 0 ? "info" : "warn",
      message: `Gemini login finished with code ${code ?? "null"} signal ${signal ?? "none"}`
    });
  });

  geminiAuthSession = { child };

  addLog({
    type: "auth",
    provider: "gemini",
    level: "info",
    message:
      "Gemini login started (manual OAuth). Watch Recent Activity for the Google link, sign in on your PC, then paste the authorization code in the dashboard."
  });

  return { pid: child.pid, mode: "oauth-code" };
}

export function submitGeminiAuthCode(code) {
  const trimmed = String(code ?? "").trim();
  if (!trimmed) {
    throw new Error("Authorization code is required");
  }
  if (!geminiAuthSession?.child?.stdin?.writable) {
    throw new Error("No Gemini login in progress. Click Google sign-in first.");
  }
  geminiAuthSession.child.stdin.write(`${trimmed}\n`);
  addLog({
    type: "auth",
    provider: "gemini",
    level: "info",
    message: "Authorization code submitted — waiting for Gemini to finish login."
  });
  return { ok: true };
}

export function startAuth(provider, providerConfig) {
  const type = providerType(provider, providerConfig);

  if (type === "http") {
    throw new Error("HTTP providers do not use CLI auth — configure baseUrl and apiKey instead");
  }

  if (provider === "gemini") {
    return startGeminiAuth(providerConfig);
  }

  const spec = getProviderSpec(provider, providerConfig);
  if (!spec.authArgs?.length) {
    throw new Error("No auth command configured for this provider");
  }

  clearAuthSession(provider);

  const child = spawn(providerConfig.command, spec.authArgs, {
    cwd: process.cwd(),
    env: authEnvForProvider(provider),
    stdio: ["ignore", "pipe", "pipe"]
  });

  addLog({
    type: "auth",
    provider,
    level: "info",
    message: `Started: ${providerConfig.command} ${spec.authArgs.join(" ")}`
  });

  let loginUrlLogged = false;
  let deviceCodeLogged = false;

  const handleAuthChunk = (chunk, level) => {
    const text = chunk.toString();
    addLog({ type: "auth", provider, level, message: text });
    const session = ingestAuthOutput(provider, text);
    if (session?.url && !loginUrlLogged) {
      loginUrlLogged = true;
      addLog({
        type: "auth",
        provider,
        level: "info",
        message: `Open login in your browser: ${session.url}`
      });
    }
    if (session?.deviceCode && !deviceCodeLogged) {
      deviceCodeLogged = true;
      addLog({
        type: "auth",
        provider,
        level: "info",
        message: `Device code: ${session.deviceCode}`
      });
    }
  };

  child.stdout.on("data", (chunk) => handleAuthChunk(chunk, "info"));
  child.stderr.on("data", (chunk) => handleAuthChunk(chunk, "warn"));
  child.on("error", (error) => {
    addLog({ type: "auth", provider, level: "error", message: error.message });
  });
  child.on("exit", (code, signal) => {
    addLog({
      type: "auth",
      provider,
      level: code === 0 ? "info" : "warn",
      message: `Auth process exited with code ${code ?? "null"} signal ${signal ?? "none"}`
    });
  });

  return { pid: child.pid };
}

function parseModels(provider, stdout) {
  if (provider === "codex") {
    const body = JSON.parse(stdout);
    return (body.models ?? [])
      .filter((model) => model.visibility !== "hidden")
      .map((model) => ({
        id: model.slug,
        name: model.display_name || model.slug
      }));
  }

  if (provider === "cursor") {
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(" - "))
      .map((line) => {
        const [id, ...nameParts] = line.split(" - ");
        return {
          id: id.trim(),
          name: nameParts.join(" - ").replace(/\s+\((current|default)\)$/i, "").trim()
        };
      });
  }

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ id: line, name: line }));
}

function includeSelectedModel(models, selectedModel) {
  if (!selectedModel || models.some((model) => model.id === selectedModel)) {
    return models;
  }
  return [{ id: selectedModel, name: `${selectedModel} (selected)` }, ...models];
}

export async function runProvider(provider, providerConfig, prompt, onChunk) {
  const type = providerType(provider, providerConfig);

  if (type === "http") {
    return runHttpProvider(provider, providerConfig, prompt, onChunk);
  }

  const spec = getProviderSpec(provider, providerConfig);
  const stdinMode = providerConfig.stdinMode ?? "prompt";
  return runProcess({
    provider,
    command: providerConfig.command,
    args: spec.runArgs({ model: providerConfig.model }),
    stdinText: stdinMode === "none" ? undefined : prompt,
    timeoutMs: providerConfig.timeoutMs,
    logType: "completion",
    onChunk
  });
}

function runProcess({ provider, command, args, stdinText, timeoutMs, logType, onChunk }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: envForProvider(provider),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      const error = new Error(`${provider} timed out after ${timeoutMs}ms`);
      if (!settled) {
        settled = true;
        reject(error);
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onChunk?.(text);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    if (stdinText) {
      child.stdin.end(stdinText);
    } else {
      child.stdin.end();
    }

    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      addLog({
        type: logType,
        provider,
        level: code === 0 ? "info" : "error",
        message: `${command} exited ${code}; stdout ${stdout.length} chars; stderr ${stderr.length} chars`
      });
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
      } else {
        const error = new Error(stderr.trim() || `${command} exited with code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });
  });
}
