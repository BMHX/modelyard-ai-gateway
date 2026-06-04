import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, nativeTheme } from "electron";

const nodeCommand = process.env.npm_node_execpath || "node";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const preloadPath = path.join(__dirname, "preload.mjs");
const desktopHost = process.env.TEAMOPS_DESKTOP_HOST?.trim() || "127.0.0.1";
const desktopWebAdminPort = process.env.TEAMOPS_DESKTOP_WEB_ADMIN_PORT?.trim() || "3101";
const desktopControlApiPort = process.env.TEAMOPS_DESKTOP_CONTROL_API_PORT?.trim() || "4101";
const desktopGatewayPort = process.env.TEAMOPS_DESKTOP_GATEWAY_PORT?.trim() || "4102";
const desktopExportWorkerHealthPort = process.env.TEAMOPS_DESKTOP_EXPORT_WORKER_HEALTH_PORT?.trim() || "4110";
const isProductionDesktop = process.env.NODE_ENV === "production";
const desktopNextDistDir =
  process.env.TEAMOPS_DESKTOP_NEXT_DIST_DIR?.trim() ||
  (isProductionDesktop ? ".next" : ".next-desktop");
const desktopPortSummary = `${desktopWebAdminPort}/${desktopControlApiPort}/${desktopGatewayPort}/${desktopExportWorkerHealthPort}`;
const webAdminUrl =
  process.env.TEAMOPS_DESKTOP_URL?.trim() || `http://${desktopHost}:${desktopWebAdminPort}`;
const controlApiUrl =
  process.env.TEAMOPS_DESKTOP_CONTROL_API_URL?.trim() ||
  `http://${desktopHost}:${desktopControlApiPort}/healthz`;
const gatewayUrl =
  process.env.TEAMOPS_DESKTOP_GATEWAY_URL?.trim() || `http://${desktopHost}:${desktopGatewayPort}/healthz`;
const waitTimeoutMs = 120_000;

let mainWindow = null;
let shuttingDown = false;
const childProcesses = new Set();

function writeStackLog(message) {
  const prefix = "[desktop-stack]";
  process.stdout.write(`${prefix} ${message}\n`);
}

function writeDesktopLog(message) {
  const prefix = "[desktop-main]";
  process.stdout.write(`${prefix} ${message}\n`);
}

function attachChildLogging(child) {
  child.stdout?.on("data", (chunk) => {
    const lines = chunk.toString().split(/\r?\n/u).filter(Boolean);
    for (const line of lines) {
      writeStackLog(line);
    }
  });

  child.stderr?.on("data", (chunk) => {
    const lines = chunk.toString().split(/\r?\n/u).filter(Boolean);
    for (const line of lines) {
      writeStackLog(line);
    }
  });
}

function trackChildProcess(child) {
  childProcesses.add(child);
  child.on("exit", () => {
    childProcesses.delete(child);
  });
  return child;
}

async function isUrlReachable(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent": "teamops-desktop-shell",
      },
    });

    return response.ok || response.status === 307 || response.status === 308;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isUrlReachable(url)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  return false;
}

function createLoadingWindow() {
  writeDesktopLog("creating loading window");
  const isDark = nativeTheme.shouldUseDarkColors;
  const appearance = isDark
    ? {
        colorScheme: "dark",
        windowBackground: "#161311",
        text: "#f1ece6",
        bodyGradientStart: "rgba(255, 255, 255, 0.04)",
        bodyGradientTop: "#1b1714",
        bodyGradientBottom: "#14110f",
        panelBackground: "rgba(31, 27, 24, 0.9)",
        panelBorder: "rgba(255, 255, 255, 0.08)",
        panelShadow: "0 18px 48px rgba(0, 0, 0, 0.34)",
        paragraph: "#b7aca2",
        meterTrack: "rgba(255, 255, 255, 0.12)",
        meterFill: "#f1ece6",
      }
    : {
        colorScheme: "light",
        windowBackground: "#f5f5f3",
        text: "#171717",
        bodyGradientStart: "rgba(23, 23, 23, 0.04)",
        bodyGradientTop: "#fafaf9",
        bodyGradientBottom: "#f3f3f0",
        panelBackground: "rgba(255, 255, 255, 0.88)",
        panelBorder: "rgba(23, 23, 23, 0.08)",
        panelShadow: "0 18px 48px rgba(23, 23, 23, 0.08)",
        paragraph: "#525252",
        meterTrack: "rgba(23, 23, 23, 0.08)",
        meterFill: "#171717",
      };
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    backgroundColor: appearance.windowBackground,
    title: "Modelyard Desktop",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  win.on("ready-to-show", () => {
    writeDesktopLog("loading window ready-to-show");
  });

  win.on("show", () => {
    writeDesktopLog("loading window shown");
  });

  win.on("closed", () => {
    writeDesktopLog("main window closed");
  });

  void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Modelyard Desktop</title>
        <style>
          :root {
            color-scheme: ${appearance.colorScheme};
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: ${appearance.windowBackground};
            color: ${appearance.text};
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background:
              radial-gradient(circle at top left, ${appearance.bodyGradientStart}, transparent 28%),
              linear-gradient(180deg, ${appearance.bodyGradientTop} 0%, ${appearance.bodyGradientBottom} 100%);
          }
          main {
            width: min(520px, calc(100vw - 48px));
            padding: 28px 28px 24px;
            border: 1px solid ${appearance.panelBorder};
            border-radius: 20px;
            background: ${appearance.panelBackground};
            box-shadow: ${appearance.panelShadow};
          }
          h1 {
            margin: 0 0 8px;
            font-size: 20px;
            font-weight: 600;
            letter-spacing: -0.02em;
          }
          p {
            margin: 0;
            color: ${appearance.paragraph};
            font-size: 14px;
            line-height: 1.6;
          }
          .meter {
            margin-top: 18px;
            height: 8px;
            border-radius: 999px;
            background: ${appearance.meterTrack};
            overflow: hidden;
          }
          .meter::after {
            content: "";
            display: block;
            width: 34%;
            height: 100%;
            border-radius: inherit;
            background: ${appearance.meterFill};
            animation: loading 1.25s ease-in-out infinite;
            transform-origin: left center;
          }
          @keyframes loading {
            0% { transform: translateX(-120%); }
            100% { transform: translateX(320%); }
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Launching Modelyard Desktop</h1>
          <p>Starting the local control plane and waiting for the operator console to become available.</p>
          <div class="meter"></div>
        </main>
      </body>
    </html>
  `)).then(() => {
    writeDesktopLog("loading html loaded");
  }).catch((error) => {
    writeDesktopLog(`loading html failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  win.center();
  win.show();
  win.focus();

  if (process.platform === "darwin") {
    app.dock?.show();
  }

  return win;
}

function createDesktopEnv() {
  const desktopDataDir = path.join(app.getPath("userData"), "local-data");
  const databaseUrl = `pglite://${path.join(desktopDataDir, "pgdata")}`;
  const desktopWebAdminBaseUrl = `http://${desktopHost}:${desktopWebAdminPort}`;
  const desktopControlApiBaseUrl = `http://${desktopHost}:${desktopControlApiPort}`;
  const desktopGatewayBaseUrl = `http://${desktopHost}:${desktopGatewayPort}`;

  return {
    ...process.env,
    BROWSER: "none",
    NODE_ENV: process.env.NODE_ENV || "development",
    NEXT_DIST_DIR: desktopNextDistDir,
    DATABASE_URL: databaseUrl,
    CONTROL_API_BASE_URL: desktopControlApiBaseUrl,
    NEXT_PUBLIC_CONTROL_API_BASE_URL: desktopControlApiBaseUrl,
    WEB_ADMIN_BASE_URL: desktopWebAdminBaseUrl,
    WEB_ADMIN_PUBLIC_BASE_URL: desktopWebAdminBaseUrl,
    WEB_ADMIN_AUTH_MODE: process.env.WEB_ADMIN_AUTH_MODE?.trim() || "bootstrap_admin",
    APP_BASE_URL: desktopWebAdminBaseUrl,
    PUBLIC_APP_BASE_URL: desktopWebAdminBaseUrl,
    CONTROL_API_ADMIN_TOKEN: process.env.CONTROL_API_ADMIN_TOKEN?.trim() || "demo-admin-token",
    CONTROL_API_HOST: desktopHost,
    CONTROL_API_PORT: desktopControlApiPort,
    GATEWAY_HOST: desktopHost,
    GATEWAY_PORT: desktopGatewayPort,
    GATEWAY_PUBLIC_BASE_URL: desktopGatewayBaseUrl,
    EXPORT_WORKER_HEALTH_HOST: desktopHost,
    EXPORT_WORKER_HEALTH_PORT: desktopExportWorkerHealthPort,
    DEMO_MODE: process.env.TEAMOPS_DESKTOP_DEMO_MODE?.trim() || "0",
    TEAMOPS_DESKTOP_LOCAL: "1",
  };
}

function spawnLocalServiceHost(env) {
  writeDesktopLog("spawning local service host");
  const child = spawn(
    nodeCommand,
    ["--import", "tsx", path.join(repoRoot, "apps/desktop/local-services.ts")],
    {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  attachChildLogging(child);
  trackChildProcess(child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const details = signal ? `signal ${signal}` : `exit code ${code ?? 0}`;
    dialog.showErrorBox("Modelyard Desktop", `The local desktop services stopped unexpectedly (${details}).`);
  });
}

function spawnWebAdmin(env) {
  writeDesktopLog("spawning web-admin");
  const webAdminArgs = isProductionDesktop
    ? [
        path.join(repoRoot, "tools/run-with-root-env.mjs"),
        "next",
        "start",
        "--hostname",
        desktopHost,
        "--port",
        desktopWebAdminPort,
      ]
    : [
        path.join(repoRoot, "tools/run-with-root-env.mjs"),
        "next",
        "dev",
        "--hostname",
        desktopHost,
        "--port",
        desktopWebAdminPort,
      ];
  const child = spawn(
    nodeCommand,
    webAdminArgs,
    {
      cwd: path.join(repoRoot, "apps/web-admin"),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  attachChildLogging(child);
  trackChildProcess(child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const details = signal ? `signal ${signal}` : `exit code ${code ?? 0}`;
    dialog.showErrorBox("Modelyard Desktop", `The local web admin stopped unexpectedly (${details}).`);
  });
}

async function ensureStack() {
  writeDesktopLog("checking existing local services");
  const [existingControlApi, existingGateway, existingWebAdmin] = await Promise.all([
    isUrlReachable(controlApiUrl),
    isUrlReachable(gatewayUrl),
    isUrlReachable(webAdminUrl),
  ]);

  if (existingControlApi && existingGateway && existingWebAdmin) {
    writeStackLog("reusing existing local services");
    return;
  }

  if (existingControlApi || existingGateway || existingWebAdmin) {
    throw new Error(
      `Detected a partially running desktop stack on ports ${desktopPortSummary}. Stop the existing desktop processes or start the full desktop stack before launching Modelyard Desktop.`,
    );
  }

  const env = createDesktopEnv();
  writeDesktopLog(`using local database ${env.DATABASE_URL}`);

  writeStackLog("starting local desktop services");
  spawnLocalServiceHost(env);
  spawnWebAdmin(env);

  const [controlApiReady, gatewayReady, webAdminReady] = await Promise.all([
    waitForUrl(controlApiUrl, waitTimeoutMs),
    waitForUrl(gatewayUrl, waitTimeoutMs),
    waitForUrl(webAdminUrl, waitTimeoutMs),
  ]);

  if (!controlApiReady) {
    throw new Error(`Control API did not become ready at ${controlApiUrl} within ${waitTimeoutMs / 1000}s`);
  }

  if (!gatewayReady) {
    throw new Error(`Gateway did not become ready at ${gatewayUrl} within ${waitTimeoutMs / 1000}s`);
  }

  if (!webAdminReady) {
    throw new Error(`Web admin did not become ready at ${webAdminUrl} within ${waitTimeoutMs / 1000}s`);
  }
}

async function openMainWindow() {
  writeDesktopLog("opening main window");
  mainWindow = createLoadingWindow();

  try {
    await ensureStack();
    writeDesktopLog(`loading web admin ${webAdminUrl}`);
    await mainWindow.loadURL(webAdminUrl);
    mainWindow.show();
    mainWindow.focus();
    writeDesktopLog("web admin loaded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeDesktopLog(`startup failed: ${message}`);
    await dialog.showMessageBox({
      type: "error",
      title: "Modelyard Desktop",
      message: "Unable to launch the local application stack.",
      detail: `${message}\n\nCheck for port conflicts on ${desktopPortSummary} and then try again.`,
    });
    app.quit();
  }
}

function stopStack() {
  for (const child of childProcesses) {
    child.kill("SIGTERM");
  }
}

app.on("window-all-closed", () => {
  writeDesktopLog("window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  writeDesktopLog("before-quit");
  shuttingDown = true;
  stopStack();
});

app.on("activate", () => {
  writeDesktopLog("app activate");
  if (BrowserWindow.getAllWindows().length === 0) {
    void openMainWindow();
  }
});

writeDesktopLog("waiting for electron app ready");
app.whenReady().then(async () => {
  writeDesktopLog("electron app ready");
  await openMainWindow();
}).catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  writeDesktopLog(`fatal startup error: ${message}`);
  await dialog.showMessageBox({
    type: "error",
    title: "Modelyard Desktop",
    message: "Electron failed during startup.",
    detail: message,
  });
  app.quit();
});
