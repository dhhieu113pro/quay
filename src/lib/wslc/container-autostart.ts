const KEY = "quay.container-autostart.v1";

export type ContainerAutoStartPrefs = Record<string, boolean>;

export function loadContainerAutoStart(): ContainerAutoStartPrefs {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([name, enabled]) => name.trim() && enabled === true)
        .map(([name]) => [name, true]),
    );
  } catch {
    return {};
  }
}

export function setContainerAutoStart(rawName: string, enabled: boolean): ContainerAutoStartPrefs {
  const name = rawName.trim();
  const next = loadContainerAutoStart();
  if (!name) return next;
  if (enabled) next[name] = true;
  else delete next[name];
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
