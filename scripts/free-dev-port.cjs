const { execFileSync } = require("node:child_process");
const path = require("node:path");

const port = Number.parseInt(process.argv[2] ?? "1420", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("[dev-port] Porta non valida.");
  process.exit(1);
}

const workspace = path.resolve(__dirname, "..").toLowerCase();

function powershell(command) {
  try {
    return execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
  } catch (error) {
    return String(error.stdout ?? "").trim();
  }
}

function listeningPids(targetPort) {
  if (process.platform !== "win32") {
    return [];
  }
  const output = powershell(
    `Get-NetTCPConnection -LocalPort ${targetPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`
  );
  return [...new Set(output.split(/\r?\n/).map((line) => Number.parseInt(line.trim(), 10)).filter(Number.isInteger))];
}

function processInfo(pid) {
  const command = [
    `$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue`,
    "if ($process) {",
    "  [pscustomobject]@{ Name = $process.Name; CommandLine = $process.CommandLine } | ConvertTo-Json -Compress",
    "}"
  ].join("; ");
  const output = powershell(command);
  return output ? JSON.parse(output) : null;
}

function isSafeDevProcess(info) {
  const name = String(info?.Name ?? "").toLowerCase();
  const commandLine = String(info?.CommandLine ?? "").toLowerCase();
  if (!name.includes("node") && !name.includes("npm") && !name.includes("vite")) {
    return false;
  }
  return commandLine.includes(workspace) || commandLine.includes("node_modules\\vite") || commandLine.includes("node_modules/vite");
}

if (process.platform !== "win32") {
  process.exit(0);
}

for (const pid of listeningPids(port)) {
  if (pid === process.pid) {
    continue;
  }
  const info = processInfo(pid);
  if (!info) {
    continue;
  }
  if (!isSafeDevProcess(info)) {
    console.error(`[dev-port] Porta ${port} occupata dal PID ${pid}: ${info.Name}`);
    console.error(`[dev-port] CommandLine: ${info.CommandLine ?? "(non disponibile)"}`);
    console.error("[dev-port] Processo non terminato automaticamente per sicurezza.");
    process.exit(1);
  }
  console.log(`[dev-port] Chiudo processo dev stale sulla porta ${port}: PID ${pid}`);
  powershell(`Stop-Process -Id ${pid} -Force`);
}
