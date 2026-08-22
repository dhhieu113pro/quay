using System.Text;
using Microsoft.WSL.Containers;

const string marker = "QUAY_WSLC_SMOKE_OK";
var sessionName = $"Quay-CI-{Environment.ProcessId}-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";
var dataPath = Path.Combine(Path.GetTempPath(), "quay-wslc-smoke", sessionName);
Directory.CreateDirectory(dataPath);

Session? session = null;
Container? container = null;

try
{
    var missing = WslcService.GetMissingComponents();
    if (missing.Count > 0)
    {
        throw new InvalidOperationException($"WSLC runtime prerequisites are missing: {missing}");
    }

    Console.WriteLine($"WSLC version: {WslcService.GetVersion()}");
    Console.WriteLine($"Creating session: {sessionName}");

    session = new Session(new SessionSettings(sessionName, dataPath)
    {
        CpuCount = 2,
        MemorySizeInMB = 2048
    });
    session.Start();

    const string image = "docker.io/library/alpine:latest";
    Console.WriteLine($"Pulling {image}");
    await session.PullImageAsync(new PullImageOptions(image));

    var exited = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
    var output = new StringBuilder();

    var settings = new ContainerSettings(image)
    {
        Name = "quay-wslc-smoke",
        InitProcess = new ProcessSettings
        {
            CommandLine = new[] { "/bin/sh", "-c", $"echo {marker}; sleep 30" },
            OutputMode = ProcessOutputMode.Event
        }
    };

    container = session.CreateContainer(settings);
    container.InitProcess.OutputReceived += data =>
    {
        var text = Encoding.UTF8.GetString(data);
        lock (output) output.Append(text);
        Console.Write(text);
    };
    container.InitProcess.ErrorReceived += data => Console.Error.Write(Encoding.UTF8.GetString(data));
    container.InitProcess.Exited += code => exited.TrySetResult(code);

    container.Start();

    var deadline = DateTimeOffset.UtcNow.AddSeconds(20);
    while (DateTimeOffset.UtcNow < deadline)
    {
        string current;
        lock (output) current = output.ToString();
        if (container.State == ContainerState.Running && current.Contains(marker, StringComparison.Ordinal))
        {
            Console.WriteLine("WSLC smoke test passed: container is running and emitted expected output.");
            return 0;
        }
        await Task.Delay(250);
    }

    string finalOutput;
    lock (output) finalOutput = output.ToString();
    throw new InvalidOperationException(
        $"WSLC smoke test timed out. State={container.State}; Output={finalOutput}");
}
finally
{
    if (container is not null)
    {
        try
        {
            if (container.State == ContainerState.Running)
                container.Stop(Signal.SIGTERM, TimeSpan.FromSeconds(5));
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Stop cleanup warning: {ex.Message}");
        }

        try
        {
            container.Delete(DeleteContainerOption.Force);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Delete cleanup warning: {ex.Message}");
        }

        container.Dispose();
    }

    if (session is not null)
    {
        try
        {
            session.Terminate();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Session cleanup warning: {ex.Message}");
        }

        session.Dispose();
    }

    try
    {
        if (Directory.Exists(dataPath)) Directory.Delete(dataPath, recursive: true);
    }
    catch
    {
        // Session VHD cleanup can lag briefly on Windows; do not hide the test result.
    }
}
