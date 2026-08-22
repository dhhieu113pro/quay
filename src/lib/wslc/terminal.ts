import type { Container } from "./types";

export function execCommand(container: Container, raw: string): string {
  const line = raw.trim();
  if (!line) return "";
  const [cmd, ...args] = line.split(/\s+/);
  const gpu = container.gpu;

  switch (cmd) {
    case "help":
      return "help  ls  ps  env  uname  hostname  whoami  df  cat  nvidia-smi  echo  clear";
    case "ls":
      return container.mounts.length
        ? ["bin  etc  home  usr  var", ...container.mounts.map((m) => m.destination)].join("\n")
        : "bin  etc  home  proc  sys  tmp  usr  var";
    case "ps":
      return [
        "PID   CMD",
        `  1   ${container.command.join(" ")}`,
        "  14  /usr/sbin/sshd",
      ].join("\n");
    case "env":
      return Object.entries(container.env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") || "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin";
    case "uname":
      return args.includes("-a")
        ? "Linux " + container.name + " 6.6.87.2-microsoft-wslc #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux"
        : "Linux";
    case "hostname":
      return container.name;
    case "whoami":
      return container.user;
    case "pwd":
      return container.workdir;
    case "df":
      return "Filesystem      Size  Used  Avail\nvirtiofs         32G  6.1G   26G";
    case "cat":
      if (args[0] === "/etc/os-release" || args[0] === "os-release") {
        if (container.image.includes("alpine"))
          return 'NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.21.0';
        if (container.image.includes("ubuntu") || container.image.includes("webtop"))
          return 'NAME="Ubuntu"\nVERSION="24.04 LTS"\nID=ubuntu';
        return 'NAME="Linux"\nID=linux';
      }
      return `cat: ${args[0] ?? ""}: No such file or directory`;
    case "nvidia-smi":
      if (!gpu) return "nvidia-smi: command not found  (no GPU access on this container)";
      return [
        "NVIDIA-SMI 560.35.03    Driver Version: 560.35.03    CUDA Version: 12.6",
        "GPU 0  NVIDIA GeForce RTX 4080  42%   6120MiB / 16376MiB",
      ].join("\n");
    case "echo":
      return args.join(" ");
    case "clear":
      return "__CLEAR__";
    default:
      return `${cmd}: command not found`;
  }
}
