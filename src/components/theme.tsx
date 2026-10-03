import { Monitor, Moon, Sun } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export const THEME_STORAGE_KEY = "paperparse-theme";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(k);var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var root=document.documentElement;root.classList.toggle("dark",d);root.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === "dark") return "dark";
  if (choice === "light") return "light";
  return prefersDark ? "dark" : "light";
}

export function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

export function readStoredTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Private mode can reject storage. Follow the OS.
  }
  return "system";
}

const CHOICES = [
  ["light", "Light", Sun],
  ["dark", "Dark", Moon],
  ["system", "System", Monitor],
] as const;

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const ready = useRef(false);

  useLayoutEffect(() => {
    const stored = ready.current ? choice : readStoredTheme();
    if (!ready.current) {
      ready.current = true;
      if (stored !== choice) setChoice(stored);
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyTheme(resolveTheme(stored, media.matches));
    sync();
    if (stored !== "system") return;
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [choice]);

  return (
    <div className="flex items-center rounded-md border border-border p-0.5" role="group" aria-label="Color theme">
      {CHOICES.map(([value, label, Icon]) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant={choice === value ? "secondary" : "ghost"}
          className="h-7 px-2"
          aria-pressed={choice === value}
          title={label}
          onClick={() => {
            setChoice(value);
            try {
              localStorage.setItem(THEME_STORAGE_KEY, value);
            } catch {
              // The class still updates for this visit.
            }
          }}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </Button>
      ))}
    </div>
  );
}

export function useResolvedTheme(): ResolvedTheme {
  const [resolved, setResolved] = useState<ResolvedTheme>("light");

  useLayoutEffect(() => {
    const read = () =>
      setResolved(document.documentElement.classList.contains("dark") ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return resolved;
}
