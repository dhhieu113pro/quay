const KEY = "quay.prefs";

export type QuayPrefs = {
  launchAtSignIn: boolean;
  groupAuto: Record<string, boolean>;
  workspaceRoot?: string;
  onboardingCompleted?: boolean;
};

const fallback: QuayPrefs = { launchAtSignIn: false, groupAuto: {}, onboardingCompleted: false };

export function loadPrefs(): QuayPrefs {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<QuayPrefs>;
    return {
      launchAtSignIn: Boolean(parsed.launchAtSignIn),
      groupAuto: parsed.groupAuto && typeof parsed.groupAuto === "object" ? parsed.groupAuto : {},
      workspaceRoot: typeof parsed.workspaceRoot === "string" && parsed.workspaceRoot.trim()
        ? parsed.workspaceRoot.trim()
        : undefined,
      onboardingCompleted: parsed.onboardingCompleted === true,
    };
  } catch {
    return fallback;
  }
}

export function savePrefs(prefs: QuayPrefs) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(prefs));
}
