use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

fn normalize_absolute(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("workspace path must be absolute".into());
    }
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => result.push(prefix.as_os_str()),
            Component::RootDir => result.push(Path::new(r"\")),
            Component::CurDir => {}
            Component::ParentDir => return Err("workspace path cannot contain '..'".into()),
            Component::Normal(part) => result.push(part),
        }
    }
    Ok(result)
}

fn validate_relative(path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path.trim());
    if path.trim().is_empty() || candidate.is_absolute() {
        return Err("workspace entry must be a relative path".into());
    }
    let mut result = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => result.push(part),
            Component::CurDir => {}
            _ => return Err("workspace entry cannot leave the workspace root".into()),
        }
    }
    if result.as_os_str().is_empty() {
        return Err("workspace entry is empty".into());
    }
    Ok(result)
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().replace('/', r"\").trim_end_matches('\').to_lowercase()
}

fn validate_descendant(root: &Path, candidate: &Path) -> Result<(), String> {
    let root = normalize_absolute(root)?;
    let candidate = normalize_absolute(candidate)?;
    let root_key = path_key(&root);
    let candidate_key = path_key(&candidate);
    if candidate_key == root_key || candidate_key.starts_with(&format!(r"{}\", root_key)) {
        Ok(())
    } else {
        Err("selected folder must be inside the Quay workspace root".into())
    }
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination).map_err(|e| format!("could not create {}: {e}", destination.display()))?;
    for entry in fs::read_dir(source).map_err(|e| format!("could not read {}: {e}", source.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path)
                .map_err(|e| format!("could not copy {}: {e}", source_path.display()))?;
        }
    }
    Ok(())
}

fn move_without_overwrite(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    if destination.exists() {
        return Err(format!("destination already exists: {}", destination.display()));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    if fs::rename(source, destination).is_ok() {
        return Ok(());
    }
    if source.is_dir() {
        copy_dir_recursive(source, destination)?;
        fs::remove_dir_all(source).map_err(|e| format!("could not remove {} after copy: {e}", source.display()))
    } else {
        fs::copy(source, destination).map_err(|e| e.to_string())?;
        fs::remove_file(source).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn workspace_default_root() -> Result<String, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "could not determine the current user profile".to_string())?;
    Ok(Path::new(&home).join("Quay").to_string_lossy().to_string())
}

#[tauri::command]
pub fn workspace_ensure(root: String) -> Result<(), String> {
    let root = normalize_absolute(Path::new(root.trim()))?;
    fs::create_dir_all(root.join("cubes")).map_err(|e| e.to_string())?;
    fs::create_dir_all(root.join("containers")).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(windows)]
fn pick_folder(current: Option<String>) -> Result<Option<String>, String> {
    let selected = current.unwrap_or_default().replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Choose Quay workspace folder'; if ('{selected}' -ne '') {{$d.SelectedPath='{selected}'}}; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{[Console]::Write($d.SelectedPath)}}"
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-STA", "-Command", &script])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("could not open folder picker: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!path.is_empty()).then_some(path))
}

#[cfg(not(windows))]
fn pick_folder(_current: Option<String>) -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
pub fn workspace_pick_root(current: Option<String>) -> Result<Option<String>, String> {
    pick_folder(current)
}

#[tauri::command]
pub fn workspace_pick_descendant(root: String, current: Option<String>) -> Result<Option<String>, String> {
    let root_path = normalize_absolute(Path::new(root.trim()))?;
    if let Some(selected) = pick_folder(current)? {
        validate_descendant(&root_path, Path::new(&selected))?;
        Ok(Some(selected))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn workspace_open(root: String, relative: Option<String>) -> Result<(), String> {
    let root_path = normalize_absolute(Path::new(root.trim()))?;
    let target = if let Some(relative) = relative {
        let target = root_path.join(validate_relative(&relative)?);
        validate_descendant(&root_path, &target)?;
        target
    } else {
        root_path
    };
    fs::create_dir_all(&target).map_err(|e| format!("could not create {}: {e}", target.display()))?;
    #[cfg(windows)]
    Command::new("explorer.exe").arg(&target).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn workspace_move_root(old_root: String, new_root: String) -> Result<(), String> {
    let old_root = normalize_absolute(Path::new(old_root.trim()))?;
    let new_root = normalize_absolute(Path::new(new_root.trim()))?;
    fs::create_dir_all(&new_root).map_err(|e| e.to_string())?;
    for managed in ["cubes", "containers"] {
        let source = old_root.join(managed);
        let destination = new_root.join(managed);
        if source.exists() && destination.exists() && fs::read_dir(&destination).map_err(|e| e.to_string())?.next().is_some() {
            return Err(format!("destination contains conflicting data: {}", destination.display()));
        }
    }
    for managed in ["cubes", "containers"] {
        let source = old_root.join(managed);
        let destination = new_root.join(managed);
        if source.exists() {
            if destination.exists() {
                fs::remove_dir(&destination).map_err(|e| format!("could not prepare {}: {e}", destination.display()))?;
            }
            move_without_overwrite(&source, &destination)?;
        } else {
            fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn workspace_move_entry(root: String, from_relative: String, to_relative: String) -> Result<(), String> {
    let root = normalize_absolute(Path::new(root.trim()))?;
    let source = root.join(validate_relative(&from_relative)?);
    let destination = root.join(validate_relative(&to_relative)?);
    validate_descendant(&root, &source)?;
    validate_descendant(&root, &destination)?;
    move_without_overwrite(&source, &destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descendant_validation_is_case_insensitive_and_rejects_escape() {
        assert!(validate_descendant(Path::new(r"C:\Quay"), Path::new(r"c:\quay\cubes\demo")).is_ok());
        assert!(validate_descendant(Path::new(r"C:\Quay"), Path::new(r"C:\Other")).is_err());
    }

    #[test]
    fn relative_validation_rejects_parent_segments() {
        assert!(validate_relative(r"cubes\demo").is_ok());
        assert!(validate_relative(r"..\other").is_err());
        assert!(validate_relative(r"C:\temp").is_err());
    }

    #[test]
    fn move_refuses_to_overwrite_destination() {
        let base = std::env::temp_dir().join(format!("quay-workspace-test-{}", std::process::id()));
        let source = base.join("source");
        let destination = base.join("destination");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&destination).unwrap();
        assert!(move_without_overwrite(&source, &destination).is_err());
        let _ = fs::remove_dir_all(&base);
    }
}
