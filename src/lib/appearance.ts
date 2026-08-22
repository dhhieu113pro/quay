export type AppearanceMode = "auto" | "light" | "dark";
export type ResolvedScheme = "light" | "dark";

export const APPEARANCE_KEY = "quay-appearance";
const GEO_KEY = "quay-geo";

type Geo = { lat: number; lon: number };

export function loadMode(): AppearanceMode {
  if (typeof localStorage === "undefined") return "auto";
  const raw = localStorage.getItem(APPEARANCE_KEY);
  if (raw === "light" || raw === "dark" || raw === "auto") return raw;
  return "auto";
}

export function saveMode(mode: AppearanceMode) {
  try {
    localStorage.setItem(APPEARANCE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function loadGeo(): Geo | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(GEO_KEY);
    if (!raw || raw === "denied") return null;
    const g = JSON.parse(raw) as Geo;
    if (typeof g.lat === "number" && typeof g.lon === "number") return g;
  } catch {
    /* ignore */
  }
  return null;
}

export function geoDenied(): boolean {
  try {
    return localStorage.getItem(GEO_KEY) === "denied";
  } catch {
    return true;
  }
}

export function requestGeo(onUpdate?: () => void) {
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  if (geoDenied() || loadGeo()) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      try {
        localStorage.setItem(
          GEO_KEY,
          JSON.stringify({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          }),
        );
      } catch {
        /* ignore */
      }
      onUpdate?.();
    },
    () => {
      try {
        localStorage.setItem(GEO_KEY, "denied");
      } catch {
        /* ignore */
      }
    },
    { maximumAge: 86_400_000, timeout: 5_000, enableHighAccuracy: false },
  );
}

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const OBLIQUITY = RAD * 23.4397;

function toJulian(date: Date) {
  return date.valueOf() / DAY_MS - 0.5 + J1970;
}
function fromJulian(j: number) {
  return new Date((j + 0.5 - J1970) * DAY_MS);
}
function toDays(date: Date) {
  return toJulian(date) - J2000;
}
function solarMeanAnomaly(d: number) {
  return RAD * (357.5291 + 0.98560028 * d);
}
function eclipticLongitude(M: number) {
  const C =
    RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + RAD * 102.9372 + Math.PI;
}
function declination(l: number) {
  return Math.asin(Math.sin(l) * Math.sin(OBLIQUITY));
}
function julianCycle(d: number, lw: number) {
  return Math.round(d - 0.0009 - lw / (2 * Math.PI));
}
function approxTransit(Ht: number, lw: number, n: number) {
  return 0.0009 + (Ht + lw) / (2 * Math.PI) + n;
}
function solarTransitJ(ds: number, M: number, L: number) {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
}
function hourAngle(h: number, phi: number, d: number) {
  const x =
    (Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d));
  if (x < -1) return Math.PI;
  if (x > 1) return 0;
  return Math.acos(x);
}

export function sunTimes(date: Date, lat: number, lon: number) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const Jnoon = solarTransitJ(ds, M, L);
  const w = hourAngle(-0.833 * RAD, phi, dec);
  const a = approxTransit(w, lw, n);
  const Jset = solarTransitJ(a, M, L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
}

function clockFallback(now: Date): boolean {
  const h = now.getHours() + now.getMinutes() / 60;
  return h >= 6.5 && h < 18.5;
}

export function isDaylight(now = new Date(), geo = loadGeo()): boolean {
  if (!geo) return clockFallback(now);
  const { sunrise, sunset } = sunTimes(now, geo.lat, geo.lon);
  return now >= sunrise && now < sunset;
}

export function resolveScheme(
  mode: AppearanceMode,
  now = new Date(),
): ResolvedScheme {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  return isDaylight(now) ? "light" : "dark";
}

export function nextSunEvent(
  now = new Date(),
  geo = loadGeo(),
): { kind: "sunrise" | "sunset"; at: Date } | null {
  if (!geo) return null;
  const { sunrise, sunset } = sunTimes(now, geo.lat, geo.lon);
  if (now < sunrise) return { kind: "sunrise", at: sunrise };
  if (now < sunset) return { kind: "sunset", at: sunset };
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const next = sunTimes(tomorrow, geo.lat, geo.lon);
  return { kind: "sunrise", at: next.sunrise };
}

export function applyScheme(scheme: ResolvedScheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", scheme === "dark");
  root.classList.toggle("light", scheme === "light");
  root.style.colorScheme = scheme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", scheme === "dark" ? "#0c0d10" : "#f2f3f6");
}

export const APPEARANCE_BOOT = `(function(){try{var m=localStorage.getItem("${APPEARANCE_KEY}")||"auto";var dark=m==="dark";if(m==="light")dark=false;if(m==="auto"){var h=new Date().getHours()+new Date().getMinutes()/60;dark=h<6.5||h>=18.5}var r=document.documentElement;r.classList.remove("dark","light");r.classList.add(dark?"dark":"light");r.style.colorScheme=dark?"dark":"light"}catch(e){document.documentElement.classList.add("dark")}})();`;
