#![cfg(windows)]

use serde_json::{json, Value};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

pub struct CliWorker {
    tx: Sender<Request>,
}

struct Request {
    payload: Value,
    reply: Sender<Result<Value, String>>,
}

impl CliWorker {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel::<Request>();
        thread::Builder::new()
            .name("quay-wslc-cli".into())
            .spawn(move || worker_loop(rx))
            .expect("spawn Quay WSLC CLI worker");
        Self { tx }
    }

    pub fn invoke(&self, payload: Value) -> Result<Value, String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(Request { payload, reply: reply_tx })
            .map_err(|e| e.to_string())?;
        reply_rx.recv().map_err(|e| e.to_string())?
    }
}

fn worker_loop(rx: Receiver<Request>) {
    for request in rx {
        let result = handle(&request.payload);
        let _ = request.reply.send(result);
    }
}

fn handle(root: &Value) -> Result<Value, String> {
    let cmd = root
        .get("cmd")
        .and_then(Value::as_str)
        .ok_or("missing cmd")?;

    match cmd {
        "health" => {
            let result = run_wslc(&["version".into()])?;
            Ok(json!({
                "ok": result.ok,
                "wslc": result.ok,
                "session": "default",
                "output": result.output,
                "error": result.error,
                "exitCode": result.exit_code,
            }))
        }
        "run_cli" => {
            let args = root
                .get("args")
                .and_then(Value::as_array)
                .ok_or("missing args")?
                .iter()
                .map(|x| x.as_str().map(str::to_string).ok_or("args must be strings"))
                .collect::<Result<Vec<_>, _>>()?;
            let result = run_wslc(&args)?;
            Ok(result_json(result, &args))
        }
        "ensure_network" => {
            let name = root
                .get("name")
                .and_then(Value::as_str)
                .filter(|x| !x.trim().is_empty())
                .ok_or("missing network name")?;
            let list_args = vec!["network".into(), "list".into()];
            let listed = run_wslc(&list_args)?;
            if !listed.ok {
                return Ok(result_json(listed, &list_args));
            }
            if listed
                .output
                .lines()
                .any(|line| line.split_whitespace().any(|part| part.eq_ignore_ascii_case(name)))
            {
                return Ok(json!({"ok": true, "output": listed.output, "network": name}));
            }
            let create_args = vec!["network".into(), "create".into(), name.into()];
            let created = run_wslc(&create_args)?;
            Ok(result_json(created, &create_args))
        }
        _ => Err(format!("unknown command '{cmd}'")),
    }
}

struct CliResult {
    ok: bool,
    output: String,
    error: String,
    exit_code: i32,
}

fn run_wslc(args: &[String]) -> Result<CliResult, String> {
    let mut command = Command::new("wslc");
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|e| format!("failed to execute wslc: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = match (stdout.is_empty(), stderr.is_empty()) {
        (false, false) => format!("{stdout}\n{stderr}"),
        (false, true) => stdout.clone(),
        (true, false) => stderr.clone(),
        (true, true) => String::new(),
    };

    Ok(CliResult {
        ok: output.status.success(),
        output: combined,
        error: if output.status.success() { String::new() } else { stderr },
        exit_code: output.status.code().unwrap_or(-1),
    })
}

fn result_json(result: CliResult, args: &[String]) -> Value {
    json!({
        "ok": result.ok,
        "output": result.output,
        "error": result.error,
        "exitCode": result.exit_code,
        "command": format!("wslc {}", args.join(" ")),
    })
}
