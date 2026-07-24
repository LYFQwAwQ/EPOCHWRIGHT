import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = "http://127.0.0.1:4173";
const viteCli = path.join(root, "node_modules", "vite", "bin", "vite.js");
const playwrightCli = path.join(root, "node_modules", "@playwright", "test", "cli.js");

async function isServerReady() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(750) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(server) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready with code ${server.exitCode}.`);
    }
    if (await isServerReady()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for the Vite test server.");
}

function stopServer(server) {
  if (!server || server.exitCode !== null || !server.pid) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

function runPlaywright() {
  return new Promise((resolve, reject) => {
    const runner = spawn(process.execPath, [playwrightCli, "test"], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    runner.once("error", reject);
    runner.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Playwright was terminated by ${signal}.`));
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

let server;
let ownsServer = false;

try {
  if (!(await isServerReady())) {
    server = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", "4173"], {
      cwd: root,
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: true,
    });
    server.unref();
    ownsServer = true;
    await waitForServer(server);
  }
  process.exitCode = await runPlaywright();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (ownsServer) {
    stopServer(server);
  }
}

process.exit(process.exitCode ?? 1);
