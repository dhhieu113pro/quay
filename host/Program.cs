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
        var cmd = doc.RootElement.GetProperty("cmd").GetString();
        try
        {
            return cmd switch
            {
                "health" => Health(),
                "pull" => await Pull(doc.RootElement.GetProperty("image").GetString()!),
                "run" => Run(doc.RootElement),
                "stop" => Stop(doc.RootElement.GetProperty("id").GetString()!),
                "rm" => Delete(doc.RootElement.GetProperty("id").GetString()!),
                "ps" => ListContainers(),
                _ => """{"ok":false,"error":"unknown command"}"""
            };
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { ok = false, error = ex.Message });
        }
    }

    private string Health()
    {
        var ok = string.IsNullOrEmpty(_missing) && _session is not null;
        return JsonSerializer.Serialize(new
        {
            ok,
            wslc = ok,
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
}
