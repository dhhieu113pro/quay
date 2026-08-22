using System.Diagnostics;
using System.Text.Json;
using Microsoft.WSL.Containers;

var name = args.Length > 0 ? args[0] : "Quay";
var dataPath = args.Length > 1 ? args[1] : @"C:\WslcData";
var cpu = args.Length > 2 && uint.TryParse(args[2], out var c) ? c : 4u;
var memoryMb = args.Length > 3 && uint.TryParse(args[3], out var m) ? m : 4096u;

var host = new QuayHost(name, dataPath, cpu, memoryMb);
host.TryStart();

while (await Console.In.ReadLineAsync() is string line)
{
    if (string.IsNullOrWhiteSpace(line)) continue;
    var reply = await host.Invoke(line);
    Console.WriteLine(reply);
}

public sealed class QuayHost
{
    private readonly string _name;
    private readonly string _dataPath;
    private readonly uint _cpu;
    private readonly uint _memoryMb;
    private readonly string _missing;
    private Session? _session;
    private readonly Dictionary<string, Container> _containers = new();

    public QuayHost(string name, string dataPath, uint cpu, uint memoryMb)
    {
        _name = name;
        _dataPath = dataPath;
        _cpu = cpu;
        _memoryMb = memoryMb;
        try
        {
            var missing = WslcService.GetMissingComponents();
            _missing = missing is { Count: > 0 } ? missing.ToString() ?? "wslc" : "";
        }
        catch (Exception ex)
        {
            _missing = ex.Message;
        }
    }

    public void TryStart()
    {
        if (!string.IsNullOrEmpty(_missing)) return;
        _session = new Session(new SessionSettings(_name, _dataPath)
        {
            CpuCount = _cpu,
            MemorySizeInMB = _memoryMb
        });
        _session.Start();
    }

    public async Task<string> Invoke(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var cmd = root.GetProperty("cmd").GetString();
        try
        {
            return cmd switch
            {
                "health" => Health(),
                "pull" => await Pull(root.GetProperty("image").GetString()!),
                "run" => Run(root),
                "stop" => Stop(root.GetProperty("id").GetString()!),
                "rm" => Delete(root.GetProperty("id").GetString()!),
                "ps" => ListContainers(),
                "ensure_network" => await EnsureNetwork(root.GetProperty("name").GetString()!),
                "run_cli" => await RunCli(root.GetProperty("args")),
                _ => """{"ok":false,"error":"unknown command"}"""
            };
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { ok = false, error = ex.ToString() });
        }
    }

    private string Health()
    {
        var ok = string.IsNullOrEmpty(_missing) && _session is not null;
        return JsonSerializer.Serialize(new
        {
            ok,
            wslc = ok,
            session = _name,
            missing = string.IsNullOrEmpty(_missing) ? Array.Empty<string>() : new[] { _missing },
            error = ok ? null : _missing
        });
    }

    private Session RequireSession() =>
        _session ?? throw new InvalidOperationException(
            string.IsNullOrEmpty(_missing) ? "session is not started" : $"wslc missing: {_missing}");

    private async Task<string> Pull(string image)
    {
        var pull = RequireSession().PullImageAsync(new PullImageOptions(image));
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
        var container = RequireSession().CreateContainer(settings);
        container.Start();
        var id = container.Id;
        _containers[id] = container;
        return JsonSerializer.Serialize(new { ok = true, id });
    }

    private async Task<string> EnsureNetwork(string name)
    {
        var list = await ExecWslc(["network", "list"]);
        if (list.Ok && list.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries)
                .Any(line => line.Contains(name, StringComparison.OrdinalIgnoreCase)))
        {
            return JsonSerializer.Serialize(new
            {
                ok = true,
                output = $"network {name} exists",
                command = list.Command,
                exitCode = list.ExitCode,
                stdout = list.Stdout,
                stderr = list.Stderr
            });
        }

        var create = await ExecWslc(["network", "create", name]);
        return SerializeCliResult(create);
    }

    private async Task<string> RunCli(JsonElement argsElement)
    {
        var args = argsElement.EnumerateArray().Select(x => x.GetString() ?? "").ToArray();
        var result = await ExecWslc(args);
        return SerializeCliResult(result);
    }

    private static string SerializeCliResult(WslcCliResult result) =>
        JsonSerializer.Serialize(new
        {
            ok = result.Ok,
            output = result.Output,
            error = result.Ok ? null : result.Output,
            command = result.Command,
            exitCode = result.ExitCode,
            stdout = result.Stdout,
            stderr = result.Stderr
        });

    private async Task<WslcCliResult> ExecWslc(IEnumerable<string> args)
    {
        var fullArgs = new List<string> { "--session", _name };
        fullArgs.AddRange(args);

        using var process = new System.Diagnostics.Process();
        process.StartInfo = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "wslc",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        foreach (var arg in fullArgs) process.StartInfo.ArgumentList.Add(arg);

        process.Start();

        // Read both redirected streams concurrently. `wslc run` can emit a lot of
        // image-pull progress on stderr; reading stdout to EOF first can fill the
        // stderr pipe and deadlock Quay.Host before the container is created.
        var stdoutTask = process.StandardOutput.ReadToEndAsync();
        var stderrTask = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        var stdout = (await stdoutTask).Trim();
        var stderr = (await stderrTask).Trim();

        var output = string.Join(
            Environment.NewLine,
            new[] { stdout, stderr }.Where(x => x.Length > 0));
        var command = "wslc " + string.Join(" ", fullArgs.Select(QuoteArg));

        return new WslcCliResult(
            process.ExitCode == 0,
            process.ExitCode,
            stdout,
            stderr,
            output,
            command);
    }

    private static string QuoteArg(string value)
    {
        if (value.Length == 0) return "\"\"";
        if (!value.Any(char.IsWhiteSpace) && !value.Contains('"')) return value;
        return $"\"{value.Replace("\"", "\\\"")}\"";
    }

    private string Stop(string id)
    {
        _containers[id].Stop(Signal.SIGTERM, TimeSpan.FromSeconds(10));
        return """{"ok":true}""";
    }

    private string Delete(string id)
    {
        _containers[id].Delete(DeleteContainerOption.None);
        _containers.Remove(id);
        return """{"ok":true}""";
    }

    private string ListContainers() =>
        JsonSerializer.Serialize(new { ok = true, ids = _containers.Keys.ToArray() });

    private sealed record WslcCliResult(
        bool Ok,
        int ExitCode,
        string Stdout,
        string Stderr,
        string Output,
        string Command);
}
