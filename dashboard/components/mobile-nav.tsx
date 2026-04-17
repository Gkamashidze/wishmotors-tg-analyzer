"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  TrendingUp,
  Receipt,
  Package,
  ShoppingBag,
  Settings,
  LifeBuoy,
  Wrench,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "მთავარი დაფა", icon: LayoutDashboard },
  { href: "/orders", label: "შეკვეთები", icon: ClipboardList },
  { href: "/sales", label: "გაყიდვები", icon: TrendingUp },
  { href: "/expenses", label: "ხარჯები", icon: Receipt },
  { href: "/inventory", label: "მარაგი", icon: Package },
  { href: "/products", label: "პროდუქცია", icon: ShoppingBag },
];

const BOTTOM_NAV = [
  { href: "#", label: "პარამეტრები", icon: Settings },
  { href: "#", label: "დახმარება", icon: LifeBuoy },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="md:hidden flex items-center justify-center h-9 w-9 rounded-lg hover:bg-accent transition-colors cursor-pointer"
        aria-label="მენიუ გახსნა"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 md:hidden transition-opacity duration-300",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Slide-in drawer */}
      <div
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-72 bg-card border-r border-border shadow-2xl flex flex-col md:hidden transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="ნავიგაციის მენიუ"
      >
        {/* Drawer header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Wrench className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-semibold text-sm">WishMotors</span>
              <span className="text-xs text-muted-foreground">Sales Console</span>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-accent transition-colors cursor-pointer"
            aria-label="მენიუ დახურვა"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main nav links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors cursor-pointer",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom nav */}
        <div className="px-3 py-4 border-t border-border space-y-1 shrink-0">
          {BOTTOM_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
