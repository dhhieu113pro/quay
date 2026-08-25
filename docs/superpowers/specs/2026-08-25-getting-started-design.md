# Quay Getting Started Design

## Goal

Give first-time Quay users a short, useful setup experience that establishes the Quay workspace root, verifies WSLC readiness, and captures only essential preferences before entering the main application.

## Principles

- Keep onboarding short and non-technical.
- Require only decisions that affect Quay's basic storage/runtime behavior.
- Prefer automatic detection over user configuration.
- Keep advanced container, Cube, network, mount, registry, and environment configuration out of onboarding.
- Make onboarding safely repeatable from Settings.

## Experience

Use one Getting Started page with three vertically stacked sections rather than a multi-page wizard.

### 1. Quay Workspace

The workspace root is required.

On first run, default it to Quay's existing application-data-managed location rather than `%USERPROFILE%\\Quay`. This keeps Quay data in the same application-owned location users already expect unless they explicitly choose another folder.

Show:

- the resolved absolute workspace path;
- a **Choose folder** action;
- an **Open folder** action;
- short helper copy: `Quay stores Cube and container workspace files here.`

When onboarding completes, ensure the workspace root exists and ensure its `cubes/` and `containers/` directories exist.

The selected value becomes the same persisted workspace root used by Settings and all relative Cube/container workspace paths.

### 2. WSLC readiness

Quay automatically checks the local runtime. This is primarily a status section, not a configuration form.

Show the information already available to Quay where possible:

- installed / missing;
- runtime running / stopped;
- WSLC version;
- architecture.

When WSLC is installed but stopped, expose a **Start WSLC** action. When WSLC is unavailable, show the existing install/help path rather than inventing runtime configuration inside onboarding.

The user should be able to see what is wrong without understanding Quay internals.

### 3. Preferences

Only expose low-risk first-use preferences:

- **Open Quay at Windows sign-in**, default off;
- theme, default **System**.

Do not ask about default networks, Cube defaults, container environment variables, registries, ordinary mounts, or the managed workspace mount destination. Those remain in their existing configuration surfaces.

## Completion

The primary action is **Start using Quay**.

Completion must:

1. validate/create the selected workspace root;
2. create `cubes/` and `containers/` when missing;
3. persist the workspace root;
4. persist the chosen first-use preferences;
5. persist `onboardingCompleted: true` only after required setup succeeds;
6. enter the normal Quay application.

If required workspace setup fails, remain on Getting Started and show the failure. Do not mark onboarding complete.

## Returning and upgrading users

Onboarding is automatically shown only when `onboardingCompleted` is not true.

For existing installations, the initial workspace value should resolve to Quay's current AppData-managed storage location. Existing persisted workspace-root data remains authoritative when present.

Settings gets a **Run Getting Started again** action. Re-running onboarding edits the same settings; it does not erase Cubes, containers, images, or other data.

Changing an already-configured workspace root during a re-run must reuse the existing workspace migration behavior (Move / Keep / Cancel) rather than creating a second migration implementation.

## Default AppData path

The frontend must not synthesize `%APPDATA%` or hard-code a Windows username path. The native Tauri layer should expose Quay's application-data directory/default workspace path, using the platform application-data API already associated with Quay.

This native value is the source of truth for the first-run default. The workspace store may continue to persist an explicit root after onboarding.

## UI

The page should visually belong to the current Quay shell but remove normal navigation distractions until onboarding is complete.

Suggested hierarchy:

```text
Welcome to Quay
Set up the essentials before your first Cube.

1  Workspace
   <resolved AppData Quay path>       [Choose folder] [Open]
   Quay stores Cube and container workspace files here.

2  WSLC
   ● Ready
   WSLC <version> · <architecture>

3  Preferences
   [ ] Open Quay at Windows sign-in
   Theme  System

                                      [Start using Quay]
```

Use the same design tokens, controls, spacing, and status language as the rest of Quay. Avoid modal-on-modal setup and avoid a long wizard.

## State model

Extend persisted application settings with an onboarding-completion flag. Workspace root remains the single existing workspace-root setting rather than being duplicated into onboarding state.

Transient onboarding UI state may hold an unsaved workspace choice and preferences until completion.

## Routing / startup gate

At application startup, load persisted settings before selecting the normal main view. If onboarding has not completed, render/route to Getting Started. Once completion succeeds, continue into the normal dashboard.

A user explicitly invoking **Run Getting Started again** from Settings enters the same screen in re-run mode. In re-run mode, cancellation/back to Settings is allowed; first-run mode has no skip action because a workspace root is required.

## Error handling

- Folder picker cancellation leaves the current selection unchanged.
- Invalid/unusable workspace folders block completion with actionable inline feedback.
- WSLC missing/stopped does not corrupt settings. The readiness section should guide the user; workspace persistence remains transactional.
- Failure to persist required settings must not set `onboardingCompleted`.

## Testing

Add regression coverage for:

- AppData-derived default workspace root;
- onboarding gate for a fresh settings state;
- completed onboarding bypassing the gate;
- successful completion persisting root and completion flag;
- failed workspace creation not marking onboarding complete;
- `cubes/` and `containers/` creation;
- re-run action from Settings;
- re-run workspace changes reusing Move / Keep / Cancel behavior;
- WSLC readiness states;
- Windows sign-in default off;
- System theme default.

CI continues to require TypeScript, Rust adapter tests, and Windows x64/ARM64 installer builds.