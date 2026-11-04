"use client";

import { useLayoutEffect } from "react";
import { applyPreference, readPreference } from "@/lib/theme";

/**
 * Keeps <html data-theme> right after the page has loaded. The script in <head> sets it before the
 * first paint; this puts it back if React's development remount clears it, and follows the device
 * when it switches between light and dark while "Match my device" is chosen. Renders nothing.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyPreference(readPreference());
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readPreference() === "system") applyPreference("system");
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return null;
}
