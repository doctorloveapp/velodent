const { execFileSync } = require("node:child_process");
const path = require("node:path");

if (process.platform !== "win32") {
  process.exit(0);
}

const expectedExe = path
  .resolve(__dirname, "..", "src-tauri", "target", "debug", "velodent.exe")
  .toLowerCase();

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

const command = [
  "Get-CimInstance Win32_Process -Filter \"Name = 'velodent.exe'\" -ErrorAction SilentlyContinue",
  "| Select-Object ProcessId,ExecutablePath",
  "| ConvertTo-Json -Compress"
].join(" ");
const output = powershell(command);
const records = output ? JSON.parse(output) : [];
const processes = Array.isArray(records) ? records : [records];

for (const processInfo of processes) {
  const executablePath = String(processInfo.ExecutablePath ?? "").toLowerCase();
  if (executablePath !== expectedExe) {
    continue;
  }
  const pid = Number.parseInt(String(processInfo.ProcessId), 10);
  if (!Number.isInteger(pid)) {
    continue;
  }
  console.log(`[tauri-dev] Chiudo velodent.exe dev ancora aperto: PID ${pid}`);
  powershell(`Stop-Process -Id ${pid} -Force`);
}
