import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

const services = [
  { name: "web", command: npm, args: ["run", "dev"], required: true },
  { name: "ocr", command: npm, args: ["run", "ocr"], required: true },
  {
    name: "omni",
    command: isWindows ? "omniroute.cmd" : "omniroute",
    args: ["--no-open"],
    required: false,
  },
];

const children = new Map();
let stopping = false;

function prefix(name, stream) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      process.stdout.write(`[${name}] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (pending) process.stdout.write(`[${name}] ${pending}\n`);
  });
}

function stopChild(child) {
  if (!child?.pid) return;
  if (isWindows) {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

function stopAll(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) stopChild(child);
  setTimeout(() => process.exit(exitCode), 300);
}

function start(service) {
  const stdio = ["inherit", "pipe", "pipe"];
  // On Windows, .cmd shims need a shell. Pass one command string so Node does
  // not hit DEP0190 (args are not escaped when shell is true).
  if (isWindows) {
    return spawn([service.command, ...service.args].join(" "), {
      stdio,
      shell: true,
      env: process.env,
      windowsHide: true,
    });
  }
  return spawn(service.command, service.args, { stdio, env: process.env });
}

for (const service of services) {
  const child = start(service);
  children.set(service.name, child);
  prefix(service.name, child.stdout);
  prefix(service.name, child.stderr);
  child.on("error", (error) => {
    process.stderr.write(`[${service.name}] ${error.message}\n`);
    if (service.name === "omni") {
      process.stderr.write(
        "[omni] Install OmniRoute once with: npm install -g omniroute\n",
      );
    }
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    const status = signal ? 1 : (code ?? 1);
    process.stderr.write(`[${service.name}] exited (${signal ?? code})\n`);
    if (!service.required && status !== 0) {
      process.stderr.write(
        "[omni] OmniRoute did not start. Install it with: npm install -g omniroute\n" +
          "[omni] The dashboard is http://127.0.0.1:20128 and the API is http://127.0.0.1:20128/v1\n",
      );
      return;
    }
    stopAll(status);
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
