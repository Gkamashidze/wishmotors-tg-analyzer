import Link   from "next/link";
import { Search, ArrowLeft } from "lucide-react";
import { MobileNav } from "@/components/mobile-nav";

export function TopBar({ title, backHref }: { title: string; backHref?: string }) {
  return (
    <header className="h-16 border-b border-border bg-card/60 backdrop-blur sticky top-0 z-10">
      <div className="h-full px-4 md:px-6 flex items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <MobileNav />
          {backHref && (
            <Link
              href={backHref}
              className="hidden md:flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              aria-label="უკან"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            <p className="text-xs text-muted-foreground">
              wishmotors • რეალურ დროში
            </p>
          </div>
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
