import { Link } from "@tanstack/react-router";
import { Library, ScanText, Settings, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link to="/" search={{ id: undefined }} className="flex items-center gap-2 text-primary">
          <ScanText className="h-5 w-5" aria-hidden="true" />
          <span className="font-display text-xl">PaperParse</span>
        </Link>
        <nav className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/mock-new">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              AI Mock
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/library">
              <Library className="h-4 w-4" aria-hidden="true" />
              Library
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/settings">
              <Settings className="h-4 w-4" aria-hidden="true" />
              Settings
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
