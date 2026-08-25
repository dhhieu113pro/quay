# Quay Workspace Root Design

## Goal

Add a first-class Quay workspace root that owns all Quay-managed Cube and container folders. The root is configured in Settings and all managed paths are stored relative to it so the workspace can be relocated without rewriting every Cube or container definition.

## Workspace layout

Default layout:

```text
<Quay Workspace>/
  cubes/
    <cube-folder>/
      <container-folder>/
  containers/
    <container-folder>/
```

Examples with `D:\Quay` as the root:

```text
D:\Quay\cubes\local-coding\api
D:\Quay\containers\postgres
```

Quay stores only relative managed paths such as `cubes/local-coding`, `cubes/local-coding/api`, and `containers/postgres`. Absolute Windows paths are resolved from the current workspace root at runtime.

## Persisted model

Add a persisted Quay setting:

```text
workspaceRoot: string
```

Add managed relative workspace fields:

```text
ContainerGroup.workspacePath?: string
RunSpec.workspacePath?: string
RunSpec.workspaceTarget?: string
```

`workspaceTarget` defaults to `/workspace` and is the destination mounted inside the container.

For backward compatibility, missing `workspacePath` values are derived lazily from existing names:

- Cube: `cubes/<slug(cube.name)>`
- Container inside Cube: `<cube.workspacePath>/<slug(container.name)>`
- Standalone container: `containers/<slug(container.name)>`

The derived path becomes persisted when the configuration is next saved.

## Path rules and safety

All Cube/container workspace paths are relative to the Quay workspace root. Quay must normalize separators and reject paths that are absolute, contain traversal outside the root, or resolve outside the configured root.

Examples rejected:

```text
C:\temp
..\..\other
../../other
```

Folder selection for Cube/container workspaces is constrained to descendants of the configured Quay workspace root. The UI may display an absolute resolved path for clarity, but persistence remains relative.

## Settings UI

Add a **Workspace** section to Settings containing:

- Current Quay workspace root.
- `Choose folder` action using a native Windows folder picker.
- `Open folder` action.
- Resolved root path shown clearly.

If the configured root does not exist, Quay creates it together with `cubes/` and `containers/`.

### Changing the root

When the user selects a different workspace root, Quay prompts:

1. **Move existing data** — move Quay-managed `cubes/` and `containers/` content from the old root into the new root, then switch the configured root.
2. **Keep existing data** — switch the configured root without moving the old files. Existing relative configuration now resolves under the new root. The old files remain untouched and Quay warns the user accordingly.
3. **Cancel** — keep the existing root unchanged.

The move operation must avoid silent overwrite. If the destination contains a conflicting file or directory, stop and report the conflict rather than replacing user data.

## Cube configuration

Each Cube has a **Workspace folder** field.

Default:

```text
cubes/<cube-name>
```

The Cube editor shows:

- Relative workspace path.
- Resolved absolute Windows path in muted text.
- `Choose folder` constrained to the Quay root.
- `Open` action.

On Cube rename, if the workspace path still matches the previous generated default, Quay prompts:

- **Rename folder** — move the existing folder to the newly generated default and update `workspacePath`.
- **Keep existing folder** — keep the current workspace path.
- **Cancel** — cancel the rename/save operation.

If the workspace path has already been customized, renaming the Cube does not automatically suggest changing it unless the user explicitly edits the workspace field.

## Container configuration

Each container has a managed workspace folder and mount destination.

Default for a Cube member:

```text
<cube.workspacePath>/<container-name>
```

Default for a standalone container:

```text
containers/<container-name>
```

The container editor shows:

- Relative workspace path.
- Resolved absolute Windows path.
- `Choose folder` constrained to the Quay root.
- `Open` action.
- Editable container destination, default `/workspace`.

On container rename, apply the same prompt rule used for Cubes when the path still matches its generated default: **Rename folder / Keep existing folder / Cancel**.

## Workspace mount

The managed workspace is a dedicated mount, not an ordinary mount row. Quay automatically resolves the Windows source path and mounts it into `workspaceTarget`.

Example:

```text
D:\Quay\cubes\local-coding\api -> /workspace
```

The workspace mount cannot be deleted through the general Mounts editor. Users can change its container destination, but disabling the managed workspace mount is out of scope for this feature.

Additional user-defined mounts continue to work independently.

For Cubes, the Cube root itself is not mounted into every member. Each member gets its own child workspace folder by default, which avoids accidental cross-container writes.

## Native bridge

The Tauri native layer needs commands for:

- Selecting a workspace root folder.
- Selecting a descendant folder inside the configured root.
- Opening a folder in Windows Explorer.
- Ensuring required directories exist.
- Moving Quay-managed workspace data.
- Renaming/moving an individual Cube or container workspace folder.

All move/open/select operations validate resolved paths against the current root before execution.

## Data movement semantics

Directory moves are explicit user actions only. Quay never silently moves files because of a settings or name change.

When moving the workspace root or renaming an individual managed folder:

1. Validate source and destination.
2. Ensure destination remains inside the target Quay root.
3. Reject conflicts rather than overwriting.
4. Perform the move.
5. Persist the new root/path only after the move succeeds.
6. Leave configuration unchanged if the move fails.

This ordering prevents configuration from pointing at a location that was not successfully created or moved.

## Store and runtime integration

Introduce centralized path helpers rather than concatenating paths in components. Responsibilities:

- Normalize relative workspace paths.
- Generate default Cube/container paths.
- Validate paths stay under the root.
- Resolve relative path to absolute Windows path.
- Compute whether a current path is still the generated default for rename prompts.

The WSLC run-spec assembly resolves the managed workspace path at the final boundary and appends the dedicated workspace mount before invoking `wslc.exe`. Persisted RunSpecs remain portable and root-relative.

## Error handling

User-facing errors should be specific:

- Workspace root unavailable.
- Selected folder is outside the Quay workspace.
- Destination already contains conflicting files.
- Workspace move failed.
- Folder could not be created or opened.

Failures must not partially update persisted settings or paths.

## Migration and compatibility

Existing Quay installs have no workspace root and may have arbitrary absolute mounts. Those mounts remain untouched.

On first use after upgrade:

- Quay initializes a default workspace root using an appropriate per-user Windows data/workspace location.
- Existing Cube/container definitions receive generated workspace paths lazily.
- Existing ordinary mounts are not converted automatically.
- The new managed workspace mount is added when a container is next run from a Quay-managed RunSpec.

This avoids destructive migration of current data.

## Testing

Add unit/regression coverage for:

- Default Cube and standalone container workspace paths.
- Cube-member path derivation.
- Relative path normalization and traversal rejection.
- Absolute path rejection.
- Root resolution.
- Workspace root change with Move, Keep, and Cancel outcomes.
- Conflict handling during moves.
- Rename-folder versus keep-folder behavior.
- Customized paths not being silently renamed.
- Managed workspace mount generation and editable destination.
- Ordinary mounts remaining intact.
- Folder selection constrained to root.
- Persistence only after successful native move operations.

CI should continue to validate both Windows x64 and Windows ARM64 builds.

## Out of scope

- Sharing one writable workspace folder automatically across all Cube members.
- Workspace synchronization or backup.
- Network/cloud workspace roots.
- Automatic migration of arbitrary existing absolute mounts.
- Multiple global Quay workspace roots.
- Disabling the managed workspace mount per container.
