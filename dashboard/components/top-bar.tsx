import { Search } from "lucide-react";

export function TopBar({ title }: { title: string }) {
  return (
    <header className="h-16 border-b border-border bg-card/60 backdrop-blur sticky top-0 z-10">
      <div className="h-full px-6 flex items-center gap-4 justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-xs text-muted-foreground">
            wishmotors • რეალურ დროში
          </p>
        </div>

        <div className="relative hidden md:block w-80 max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="ძიება..."
            aria-label="ძიება"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
    </header>
  );
}
