import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyScheme,
  loadMode,
  nextSunEvent,
  requestGeo,
  resolveScheme,
  saveMode,
  type AppearanceMode,
  type ResolvedScheme,
} from "@/lib/appearance";

type SunEvent = { kind: "sunrise" | "sunset"; at: Date } | null;

type Ctx = {
  mode: AppearanceMode;
  scheme: ResolvedScheme;
  sun: SunEvent;
  setMode: (mode: AppearanceMode) => void;
};

const AppearanceContext = createContext<Ctx | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppearanceMode>(loadMode);
  const [scheme, setScheme] = useState<ResolvedScheme>(() => resolveScheme(loadMode()));
  const [sun, setSun] = useState<SunEvent>(() => nextSunEvent());

  const refresh = useCallback((nextMode: AppearanceMode) => {
    const next = resolveScheme(nextMode);
    setScheme(next);
    applyScheme(next);
    setSun(nextSunEvent());
  }, []);

  useLayoutEffect(() => {
    refresh(mode);
  }, [mode, refresh]);

  useEffect(() => {
    const id = window.setInterval(() => refresh(mode), 30_000);
    if (mode === "auto") requestGeo(() => refresh(mode));
    return () => window.clearInterval(id);
  }, [mode, refresh]);

  const setMode = useCallback(
    (next: AppearanceMode) => {
      saveMode(next);
      setModeState(next);
    },
    [],
  );

  const value = useMemo(
    () => ({ mode, scheme, sun, setMode }),
    [mode, scheme, sun, setMode],
  );

  return (
    <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance must be used within AppearanceProvider");
  return ctx;
}
