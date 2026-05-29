import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const GEMINI_DIR = join(homedir(), ".gemini");

/** Fast auth check — avoids running a full `gemini -p` round-trip (~30s). */
export function checkGeminiAuthStatus() {
  const credsPath = join(GEMINI_DIR, "oauth_creds.json");
  if (!existsSync(credsPath)) {
    return {
      ok: false,
      output: "Not signed in. Click Google sign-in and complete OAuth on your PC."
    };
  }

  let creds;
  try {
    creds = JSON.parse(readFileSync(credsPath, "utf8"));
  } catch {
    return { ok: false, output: "Invalid oauth_creds.json — sign in again." };
  }

  const expiry = creds.expiry_date;
  if (!creds.access_token) {
    return { ok: false, output: "No access token — click Google sign-in." };
  }
  if (expiry != null && expiry <= Date.now()) {
    return {
      ok: false,
      output: "Google OAuth token expired — click Google sign-in to refresh."
    };
  }

  let account = "";
  const accountsPath = join(GEMINI_DIR, "google_accounts.json");
  if (existsSync(accountsPath)) {
    try {
      account = JSON.parse(readFileSync(accountsPath, "utf8")).active ?? "";
    } catch {
      // ignore
    }
  }

  const who = account ? ` (${account})` : "";
  return {
    ok: true,
    output: `Signed in with Google${who}`
  };
}

/** Same catalog the Gemini CLI `/model` picker uses (bundled modelDefinitions). */
function resolveGeminiBinary(command = "gemini") {
  if (command.includes("/")) {
    return realpathSync(command);
  }
  const pathEnv = [process.env.HOME && `${process.env.HOME}/.local/bin`, process.env.PATH]
    .filter(Boolean)
    .join(":");
  return execSync(`command -v ${command}`, {
    encoding: "utf8",
    env: { ...process.env, PATH: pathEnv }
  }).trim();
}

export function loadGeminiCliModelCatalog(command = "gemini") {
  try {
    const geminiPath = resolveGeminiBinary(command);
    if (!geminiPath) {
      return null;
    }

    const resolved = realpathSync(geminiPath);
    const pkgRoot = resolved.includes("/bundle/")
      ? dirname(dirname(resolved))
      : dirname(dirname(resolved));
    const bundleDir = join(pkgRoot, "bundle");
    let chunkFile = null;
    let src = "";
    let start = -1;
    let end = -1;
    for (const name of readdirSync(bundleDir)) {
      if (!name.startsWith("chunk-") || !name.endsWith(".js")) {
        continue;
      }
      const candidate = readFileSync(join(bundleDir, name), "utf8");
      const candidateStart = candidate.indexOf("modelDefinitions:");
      const candidateEnd = candidate.indexOf("modelIdResolutions:", candidateStart);
      if (candidateStart < 0 || candidateEnd < 0) {
        continue;
      }
      if (!candidate.includes("isVisible: true")) {
        continue;
      }
      chunkFile = name;
      src = candidate;
      start = candidateStart;
      end = candidateEnd;
      break;
    }
    if (!chunkFile) {
      return null;
    }
    const block = src.slice(start, end);
    const models = [];
    const entryPattern = /"([^"]+)":\s*\{([\s\S]*?)\n    \}/g;
    let match;
    while ((match = entryPattern.exec(block)) !== null) {
      const id = match[1];
      const body = match[2];
      if (!/isVisible:\s*true/.test(body)) {
        continue;
      }
      const displayName = body.match(/displayName:\s*"([^"]+)"/)?.[1];
      models.push({ id, name: displayName || id });
    }

    return models.length ? models : null;
  } catch {
    return null;
  }
}
