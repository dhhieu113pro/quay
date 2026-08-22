using System.Text.Json;
using Microsoft.WSL.Containers;

var name = args.Length > 0 ? args[0] : "Quay";
var dataPath = args.Length > 1 ? args[1] : @"C:\WslcData";
var cpu = args.Length > 2 && uint.TryParse(args[2], out var c) ? c : 4u;
var memoryMb = args.Length > 3 && uint.TryParse(args[3], out var m) ? m : 4096u;

var host = new QuayHost(name, dataPath, cpu, memoryMb);
host.Start();

while (await Console.In.ReadLineAsync() is string line)
{
    if (string.IsNullOrWhiteSpace(line)) continue;
    var reply = await host.Invoke(line);
    Console.WriteLine(reply);
}

public sealed class QuayHost
{
    private readonly Session _session;
    private readonly Dictionary<string, Container> _containers = new();

    public QuayHost(string name, string dataPath, uint cpu, uint memoryMb)
    {
        var missing = WslcService.GetMissingComponents();
        if (missing is { Count: > 0 })
            throw new InvalidOperationException($"WSL missing: {missing}");

        _session = new Session(new SessionSettings(name, dataPath)
        {
            CpuCount = cpu,
            MemorySizeInMB = memoryMb
        });
    }

    public void Start() => _session.Start();

    public async Task<string> Invoke(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var cmd = doc.RootElement.GetProperty("cmd").GetString();
        try
        {
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
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { ok = false, error = ex.Message });
        }
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
        var id = container.GetHashCode().ToString("x");
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
