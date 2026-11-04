/**
 * Light or dark, chosen by the user in Settings > Appearance. The choice is kept in this browser's
 * localStorage (a per-device setting) and applied as `data-theme="light|dark"` on <html>, which
 * the CSS in globals.css reads. "system" follows the device. Browser-only, except for the pure
 * `resolveTheme` and the script text.
 */

export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "theme";
/** Fired on this page when the choice changes (the "storage" event only fires in other tabs). */
export const THEME_EVENT = "replenish-theme";

export const THEME_CHOICES: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "system", label: "Match my device", hint: "Light or dark, whichever your phone or computer is set to." },
  { value: "light", label: "Light", hint: "" },
  { value: "dark", label: "Dark", hint: "" },
];

/** The theme to show for a preference. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference === "light" || preference === "dark") return preference;
  return systemPrefersDark ? "dark" : "light";
}

/** Runs in <head> before the page is painted, so there is no flash of the wrong theme. Same rule as resolveTheme. */
export const THEME_SCRIPT = `(function(){var t="light",s=null,d=false;try{s=localStorage.getItem("${THEME_KEY}")}catch(e){}try{d=window.matchMedia("(prefers-color-scheme: dark)").matches}catch(e){}t=s==="light"||s==="dark"?s:d?"dark":"light";document.documentElement.setAttribute("data-theme",t)})()`;

const systemPrefersDark = () => {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
};

export function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyPreference(preference: ThemePreference): void {
  document.documentElement.setAttribute("data-theme", resolveTheme(preference, systemPrefersDark()));
}

/** Remembers and applies a choice. Storage can be unavailable (a private window): the page still changes, it just isn't remembered. */
export function savePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Not remembered; applied below anyway.
  }
  applyPreference(preference);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** For useSyncExternalStore: tells React when the choice changes, here or in another tab. */
export function subscribePreference(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
