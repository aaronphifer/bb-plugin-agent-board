import { useEffect, useState } from "react";
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from "@/lib/dashboard-preferences";

export function useDashboardPreferences() {
  const [preferences, setPreferences] = useState(() => { try { return readPreferences(window.localStorage); } catch { return DEFAULT_PREFERENCES; } });
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    try { setStorageFailed(!writePreferences(preferences, window.localStorage)); } catch { setStorageFailed(true); }
  }, [preferences]);
  return { preferences, setPreferences, storageFailed };
}
