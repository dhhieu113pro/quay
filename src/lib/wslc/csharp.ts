import type { Container, RunSpec, SessionInfo } from "./types";

export function csharpSessionStart(session: SessionInfo) {
  return `using Microsoft.WSL.Containers;

ComponentFlags missing = WslcService.GetMissingComponents();
if (missing != ComponentFlags.None)
{
    Console.WriteLine($"Missing WSL components: {missing}");
    return;
}

var settings = new SessionSettings("${session.name}", @"${session.dataPath}")
{
    CpuCount = ${session.cpuCount},
    MemoryMB = ${session.memoryMB}
};

var session = new Session(settings);
session.Start();`;
}

export function csharpPull(reference: string) {
  const ref = reference.includes("/") ? reference : `docker.io/library/${reference}`;
  return `var pull = session.PullImageAsync(new PullImageOptions("${ref}"));
pull.Progress = (op, progress) =>
    Console.WriteLine($"Pull: {progress.Status} {progress.CurrentBytes}/{progress.TotalBytes}");
await pull;`;
}

export function csharpCreateAndStart(spec: RunSpec) {
  const cmd = spec.command.trim()
    ? spec.command
        .split(/\s+/)
        .filter(Boolean)
        .map((c) => `"${c}"`)
        .join(", ")
    : "";
  const cmdLine = cmd
    ? `    CmdLine = new[] { ${cmd} },`
    : `    CmdLine = Array.Empty<string>(),`;
  return `var init = new ProcessSettings
{
${cmdLine}
    OutputMode = ProcessOutputMode.Event,
    WorkingDirectory = "${spec.workdir || "/"}"
};

var settings = new ContainerSettings("${spec.image}")
{
    Name = "${spec.name || "anonymous"}",
    InitProcess = init,
    GpuAccess = ${spec.gpu ? "GpuAccess.All" : "GpuAccess.None"}
};

var container = session.CreateContainer(settings);
container.InitProcess.OutputReceived += data =>
    Console.Write(Encoding.UTF8.GetString(data));
container.Start();`;
}

export function csharpStop(container: Pick<Container, "name">) {
  return `container.Stop(Signal.SIGTERM, TimeSpan.FromSeconds(10));
// wslc container stop ${container.name}`;
}

export function csharpDelete(container: Pick<Container, "name">) {
  return `container.Delete(DeleteContainerFlags.None);
// wslc container rm ${container.name}`;
}

export function csharpExec(name: string, command: string) {
  const parts = command
    .split(/\s+/)
    .filter(Boolean)
    .map((c) => `"${c}"`)
    .join(", ");
  return `var exec = container.CreateProcess(new ProcessSettings
{
    CmdLine = new[] { ${parts || `"/bin/bash"`} },
    OutputMode = ProcessOutputMode.Event
});
exec.OutputReceived += data => Console.Write(Encoding.UTF8.GetString(data));
exec.Start();`;
}

export function csharpHostProgram(session: SessionInfo) {
  return `// Quay.Host — C# sidecar for a Tauri WebView
// dotnet add package Microsoft.WSL.Containers
using System.Text;
using System.Text.Json;
using Microsoft.WSL.Containers;

var host = new QuayHost("${session.name}", @"${session.dataPath}", ${session.cpuCount}, ${session.memoryMB});
host.Start();

while (await Console.In.ReadLineAsync() is string line)
{
    var reply = await host.Invoke(line);
    Console.WriteLine(reply);
}

public sealed class QuayHost
{
    private readonly Session _session;

    public QuayHost(string name, string dataPath, int cpu, int memoryMb)
    {
        var missing = WslcService.GetMissingComponents();
        if (missing != ComponentFlags.None)
            throw new InvalidOperationException($"WSL missing: {missing}");

        _session = new Session(new SessionSettings(name, dataPath)
        {
            CpuCount = cpu,
            MemoryMB = memoryMb
        });
    }

    public void Start() => _session.Start();

    public async Task<string> Invoke(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var cmd = doc.RootElement.GetProperty("cmd").GetString();
        return cmd switch
        {
            "pull" => await Pull(doc.RootElement.GetProperty("image").GetString()!),
            "run" => Run(doc.RootElement),
            "stop" => Stop(doc.RootElement.GetProperty("id").GetString()!),
            "rm" => Delete(doc.RootElement.GetProperty("id").GetString()!),
            "ps" => ListContainers(),
            _ => """{"ok":false,"error":"unknown command"}"""
        };
    }

    private async Task<string> Pull(string image)
    {
        var pull = _session.PullImageAsync(new PullImageOptions(image));
        await pull;
        return """{"ok":true}""";
    }

    private string Run(JsonElement spec)
    {
        var settings = new ContainerSettings(spec.GetProperty("image").GetString()!)
        {
            Name = spec.GetProperty("name").GetString(),
            InitProcess = new ProcessSettings { OutputMode = ProcessOutputMode.Event }
        };
        var container = _session.CreateContainer(settings);
        container.Start();
        return $$"""{"ok":true,"id":"{{container.Id}}"}""";
    }

    private string Stop(string id)
    {
        var container = _session.GetContainer(id);
        container.Stop(Signal.SIGTERM, TimeSpan.FromSeconds(10));
        return """{"ok":true}""";
    }

    private string Delete(string id)
    {
        _session.GetContainer(id).Delete(DeleteContainerFlags.None);
        return """{"ok":true}""";
    }

    private string ListContainers() => """{"ok":true}""";
}`;
}

export function csharpCsproj() {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0-windows10.0.22621.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RootNamespace>Quay.Host</RootNamespace>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.WSL.Containers" Version="1.0.0-preview" />
  </ItemGroup>
</Project>`;
}

export function tauriSidecarNote() {
  return `// src-tauri/src/lib.rs — thin bridge to the C# sidecar
#[tauri::command]
async fn wslc_invoke(cmd: String, payload: serde_json::Value) -> Result<serde_json::Value, String> {
    let sidecar = tauri::api::process::Command::new_sidecar("quay-host")
        .map_err(|e| e.to_string())?
        .stdin(true)
        .stdout(true);
    // Each UI action is JSON over stdin to Quay.Host
    // which calls Microsoft.WSL.Containers.
    let _ = (cmd, payload, sidecar);
    Ok(serde_json::json!({ "ok": true }))
}`;
}

export function cliForRun(spec: RunSpec) {
  const parts = ["wslc run"];
  if (spec.detach) parts.push("-d");
  if (spec.remove) parts.push("--rm");
  if (spec.gpu) parts.push("--gpus all");
  if (spec.name) parts.push(`--name ${spec.name}`);
  if (spec.workdir) parts.push(`-w ${spec.workdir}`);
  for (const p of spec.ports.split(",").map((s) => s.trim()).filter(Boolean)) {
    parts.push(`-p ${p}`);
  }
  for (const e of spec.env.split("\n").map((s) => s.trim()).filter(Boolean)) {
    parts.push(`-e ${e}`);
  }
  for (const m of spec.mounts.split("\n").map((s) => s.trim()).filter(Boolean)) {
    parts.push(`-v ${m}`);
  }
  parts.push(spec.image);
  if (spec.command.trim()) parts.push(spec.command.trim());
  return parts.join(" ");
}
