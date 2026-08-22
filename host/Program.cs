using System.Text;
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
    private readonly Dictionary<string, ManagedContainer> _containers =
        new(StringComparer.OrdinalIgnoreCase);

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
                "run" => await Run(root),
                "stop" => Stop(root.GetProperty("id").GetString()!),
                "rm" => Delete(root.GetProperty("id").GetString()!),
                "ps" => ListContainers(),
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
        await EnsureImage(image);
        return JsonSerializer.Serialize(new { ok = true, image });
    }

    private async Task EnsureImage(string image)
    {
        var session = RequireSession();
        var exists = session.GetImages().Any(x => ImageMatches(x.Name, image));
        if (exists) return;

        var pull = session.PullImageAsync(new PullImageOptions(image));
        await pull;
    }

    private static bool ImageMatches(string actual, string requested)
    {
        if (string.Equals(actual, requested, StringComparison.OrdinalIgnoreCase)) return true;
        if (string.Equals(actual, $"docker.io/library/{requested}", StringComparison.OrdinalIgnoreCase)) return true;
        return actual.EndsWith("/" + requested, StringComparison.OrdinalIgnoreCase);
    }

    private async Task<string> Run(JsonElement spec)
    {
        var session = RequireSession();
        var image = RequiredString(spec, "image");
        var name = RequiredString(spec, "name");

        RemoveExisting(name);
        await EnsureImage(image);

        var command = ResolveCommand(image, spec.TryGetProperty("command", out var cmd) ? cmd.GetString() ?? "" : "");
        var env = ParseEnv(spec.TryGetProperty("env", out var envEl) ? envEl.GetString() ?? "" : "");
        var workdir = spec.TryGetProperty("workdir", out var wdEl) ? wdEl.GetString() ?? "" : "";
        var gpu = spec.TryGetProperty("gpu", out var gpuEl) && gpuEl.ValueKind == JsonValueKind.True;
        var remove = spec.TryGetProperty("remove", out var rmEl) && rmEl.ValueKind == JsonValueKind.True;

        ProcessSettings? init = null;
        if (command.Count > 0 || env.Count > 0 || !string.IsNullOrWhiteSpace(workdir))
        {
            if (command.Count == 0)
            {
                throw new InvalidOperationException(
                    $"Container '{name}' needs an explicit command when environment or working-directory overrides are used.");
            }

            command = ResolveManagedContainerReferences(command);
            init = new ProcessSettings
            {
                CommandLine = command,
                EnvironmentVariables = env,
                WorkingDirectory = string.IsNullOrWhiteSpace(workdir) ? "/" : workdir,
                OutputMode = ProcessOutputMode.Event
            };
        }

        var settings = new ContainerSettings(image)
        {
            Name = name,
            InitProcess = init,
            NetworkingMode = ContainerNetworkingMode.Bridged,
            EnableAutoRemove = remove,
            EnableGpu = gpu,
            PortMappings = ParsePorts(spec.TryGetProperty("ports", out var portsEl) ? portsEl.GetString() ?? "" : ""),
            Volumes = ParseVolumes(spec.TryGetProperty("mounts", out var mountsEl) ? mountsEl.GetString() ?? "" : "")
        };

        var container = session.CreateContainer(settings);
        var managed = new ManagedContainer(name, image, container)
        {
            Ports = spec.TryGetProperty("ports", out portsEl) ? portsEl.GetString() ?? "" : "",
            Mounts = spec.TryGetProperty("mounts", out mountsEl) ? mountsEl.GetString() ?? "" : "",
            Env = spec.TryGetProperty("env", out envEl) ? envEl.GetString() ?? "" : "",
            Command = command,
            Workdir = string.IsNullOrWhiteSpace(workdir) ? "/" : workdir,
            Gpu = gpu
        };

        if (init is not null)
        {
            var process = container.InitProcess;
            process.OutputReceived += data => managed.AddLog("stdout", Encoding.UTF8.GetString(data));
            process.ErrorReceived += data => managed.AddLog("stderr", Encoding.UTF8.GetString(data));
            process.Exited += code =>
            {
                managed.ExitCode = code;
                managed.FinishedAt = DateTimeOffset.UtcNow;
            };
        }

        _containers[name] = managed;

        try
        {
            container.Start();
            managed.StartedAt = DateTimeOffset.UtcNow;
            managed.BridgeIp = TryGetBridgeIp(container);
        }
        catch
        {
            _containers.Remove(name);
            container.Dispose();
            throw;
        }

        return JsonSerializer.Serialize(new { ok = true, container = Snapshot(managed) });
    }

    private List<string> ResolveManagedContainerReferences(List<string> command)
    {
        var resolved = new List<string>(command.Count);
        foreach (var arg in command)
        {
            var value = arg;
            foreach (var managed in _containers.Values)
            {
                var ip = managed.BridgeIp ?? TryGetBridgeIp(managed.Container);
                if (string.IsNullOrWhiteSpace(ip)) continue;
                managed.BridgeIp = ip;
                value = value.Replace(managed.Name, ip, StringComparison.OrdinalIgnoreCase);
            }
            resolved.Add(value);
        }
        return resolved;
    }

    private static List<string> ResolveCommand(string image, string command)
    {
        var args = SplitCommandLine(command);

        if (args.Count == 0 && image.StartsWith("ghcr.io/dhhieu113pro/local-coding-mcp", StringComparison.OrdinalIgnoreCase))
        {
            return new List<string> { "/usr/bin/dotnet", "/app/LocalCodingMcp.dll" };
        }

        if (args.Count > 0 && image.StartsWith("ngrok/ngrok", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(args[0], "http", StringComparison.OrdinalIgnoreCase))
        {
            args.Insert(0, "ngrok");
        }

        return args;
    }

    private static List<string> SplitCommandLine(string value)
    {
        var result = new List<string>();
        var current = new StringBuilder();
        char quote = '\0';

        for (var i = 0; i < value.Length; i++)
        {
            var ch = value[i];
            if (quote != '\0')
            {
                if (ch == quote)
                {
                    quote = '\0';
                }
                else if (ch == '\\' && i + 1 < value.Length && value[i + 1] == quote)
                {
                    current.Append(value[++i]);
                }
                else
                {
                    current.Append(ch);
                }
                continue;
            }

            if (ch is '\'' or '"')
            {
                quote = ch;
                continue;
            }

            if (char.IsWhiteSpace(ch))
            {
                if (current.Length > 0)
                {
                    result.Add(current.ToString());
                    current.Clear();
                }
                continue;
            }

            current.Append(ch);
        }

        if (current.Length > 0) result.Add(current.ToString());
        return result;
    }

    private static Dictionary<string, string> ParseEnv(string value)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var line in value.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var i = line.IndexOf('=');
            if (i < 0) result[line] = "";
            else result[line[..i]] = line[(i + 1)..];
        }
        return result;
    }

    private static List<ContainerPortMapping> ParsePorts(string value)
    {
        var result = new List<ContainerPortMapping>();
        foreach (var item in value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = item.Split(':', StringSplitOptions.TrimEntries);
            if (parts.Length != 2 || !ushort.TryParse(parts[0], out var windowsPort) || !ushort.TryParse(parts[1], out var containerPort))
            {
                throw new ArgumentException($"Invalid port mapping '{item}'. Expected host:container.");
            }
            result.Add(new ContainerPortMapping(windowsPort, containerPort, PortProtocol.TCP));
        }
        return result;
    }

    private static List<ContainerVolume> ParseVolumes(string value)
    {
        var result = new List<ContainerVolume>();
        foreach (var item in value.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var modeSeparator = item.LastIndexOf(':');
            if (modeSeparator <= 0) throw new ArgumentException($"Invalid mount '{item}'.");
            var mode = item[(modeSeparator + 1)..];
            var pathPart = item[..modeSeparator];
            var destinationSeparator = pathPart.LastIndexOf(':');
            if (destinationSeparator <= 0) throw new ArgumentException($"Invalid mount '{item}'.");

            var source = pathPart[..destinationSeparator];
            var destination = pathPart[(destinationSeparator + 1)..];
            if (!Path.IsPathFullyQualified(source))
            {
                throw new NotSupportedException($"Named volume '{source}' is not yet supported by Quay's SDK runner.");
            }

            result.Add(new ContainerVolume(source, destination, string.Equals(mode, "ro", StringComparison.OrdinalIgnoreCase)));
        }
        return result;
    }

    private static string? TryGetBridgeIp(Container container)
    {
        try
        {
            using var doc = JsonDocument.Parse(container.Inspect());
            return FindIpAddress(doc.RootElement);
        }
        catch
        {
            return null;
        }
    }

    private static string? FindIpAddress(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (property.NameEquals("IPAddress") && property.Value.ValueKind == JsonValueKind.String)
                {
                    var value = property.Value.GetString();
                    if (!string.IsNullOrWhiteSpace(value) && value != "0.0.0.0") return value;
                }
                var nested = FindIpAddress(property.Value);
                if (!string.IsNullOrWhiteSpace(nested)) return nested;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                var nested = FindIpAddress(item);
                if (!string.IsNullOrWhiteSpace(nested)) return nested;
            }
        }
        return null;
    }

    private void RemoveExisting(string name)
    {
        if (!_containers.TryGetValue(name, out var managed)) return;

        try
        {
            if (IsRunning(managed.Container))
                managed.Container.Stop(Signal.SIGTERM, TimeSpan.FromSeconds(10));
        }
        catch
        {
            // Delete below is authoritative for a stale managed container.
        }

        managed.Container.Delete(DeleteContainerOption.Force);
        managed.Container.Dispose();
        _containers.Remove(name);
    }

    private string Stop(string id)
    {
        var managed = FindContainer(id);
        if (IsRunning(managed.Container))
            managed.Container.Stop(Signal.SIGTERM, TimeSpan.FromSeconds(10));
        managed.FinishedAt ??= DateTimeOffset.UtcNow;
        return JsonSerializer.Serialize(new { ok = true, container = Snapshot(managed) });
    }

    private string Delete(string id)
    {
        var managed = FindContainer(id);
        if (IsRunning(managed.Container))
            managed.Container.Stop(Signal.SIGTERM, TimeSpan.FromSeconds(10));
        managed.Container.Delete(DeleteContainerOption.Force);
        managed.Container.Dispose();
        _containers.Remove(managed.Name);
        return JsonSerializer.Serialize(new { ok = true });
    }

    private ManagedContainer FindContainer(string id)
    {
        if (_containers.TryGetValue(id, out var byName)) return byName;
        return _containers.Values.FirstOrDefault(x => string.Equals(x.Container.Id, id, StringComparison.OrdinalIgnoreCase))
            ?? throw new KeyNotFoundException($"Container '{id}' is not managed by this Quay session.");
    }

    private static bool IsRunning(Container container) =>
        string.Equals(container.State.ToString(), "Running", StringComparison.OrdinalIgnoreCase);

    private string ListContainers() =>
        JsonSerializer.Serialize(new
        {
            ok = true,
            containers = _containers.Values.Select(Snapshot).ToArray()
        });

    private static object Snapshot(ManagedContainer managed)
    {
        var status = managed.Container.State.ToString().ToLowerInvariant();
        return new
        {
            id = managed.Container.Id,
            name = managed.Name,
            image = managed.Image,
            status,
            createdAt = managed.CreatedAt.ToUnixTimeMilliseconds(),
            startedAt = managed.StartedAt?.ToUnixTimeMilliseconds(),
            finishedAt = managed.FinishedAt?.ToUnixTimeMilliseconds(),
            exitCode = managed.ExitCode,
            ports = managed.Ports,
            mounts = managed.Mounts,
            env = managed.Env,
            gpu = managed.Gpu,
            command = managed.Command,
            workdir = managed.Workdir,
            bridgeIp = managed.BridgeIp,
            logs = managed.GetLogs()
        };
    }

    private static string RequiredString(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var element)) throw new ArgumentException($"Missing '{name}'.");
        var value = element.GetString();
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"'{name}' cannot be empty.");
        return value;
    }

    private sealed class ManagedContainer(string name, string image, Container container)
    {
        private readonly object _logLock = new();
        private readonly List<ManagedLog> _logs = new();

        public string Name { get; } = name;
        public string Image { get; } = image;
        public Container Container { get; } = container;
        public DateTimeOffset CreatedAt { get; } = DateTimeOffset.UtcNow;
        public DateTimeOffset? StartedAt { get; set; }
        public DateTimeOffset? FinishedAt { get; set; }
        public int? ExitCode { get; set; }
        public string Ports { get; set; } = "";
        public string Mounts { get; set; } = "";
        public string Env { get; set; } = "";
        public bool Gpu { get; set; }
        public List<string> Command { get; set; } = new();
        public string Workdir { get; set; } = "/";
        public string? BridgeIp { get; set; }

        public void AddLog(string stream, string text)
        {
            lock (_logLock)
            {
                foreach (var line in text.Replace("\r\n", "\n").Split('\n'))
                {
                    if (line.Length == 0) continue;
                    _logs.Add(new ManagedLog(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), stream, line));
                }
                if (_logs.Count > 500) _logs.RemoveRange(0, _logs.Count - 500);
            }
        }

        public ManagedLog[] GetLogs()
        {
            lock (_logLock) return _logs.ToArray();
        }
    }

    private sealed record ManagedLog(long Ts, string Stream, string Text);
}
