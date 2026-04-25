"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  TrendingUp,
  Receipt,
  Package,
  ShoppingBag,
  BookOpen,
  Settings,
  LifeBuoy,
  FileDown,
  FileText,
  UserX,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  { href: "/", label: "მთავარი დაფა", icon: LayoutDashboard },
  { href: "/orders", label: "შეკვეთები", icon: ClipboardList },
  { href: "/sales", label: "გაყიდვები", icon: TrendingUp },
  { href: "/expenses", label: "ხარჯები", icon: Receipt },
  { href: "/inventory", label: "მარაგი", icon: Package },
  { href: "/products", label: "პროდუქცია", icon: ShoppingBag },
  { href: "/imports", label: "იმპორტი", icon: FileDown },
  { href: "/accounting", label: "ბუღალტერია", icon: BookOpen },
  { href: "/vat", label: "დღგ-ს დეკლარაცია", icon: FileText },
  { href: "/debtors", label: "დებიტორები", icon: UserX },
];

const BOTTOM_NAV: NavItem[] = [
  { href: "#", label: "პარამეტრები", icon: Settings },
  { href: "#", label: "დახმარება", icon: LifeBuoy },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex md:flex-col w-64 shrink-0 border-r border-border bg-card">
      <div className="h-16 flex items-center gap-2 px-6 border-b border-border">
        <Image
          src="/logo.jpg"
          alt="WishMotors"
          width={36}
          height={36}
          priority
          unoptimized
          className="h-9 w-9 rounded-lg object-contain"
        />
        <div className="flex flex-col leading-tight">
          <span className="font-semibold">WishMotors</span>
          <span className="text-xs text-muted-foreground">Sales Console</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
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
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
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

      <div className="px-3 py-4 border-t border-border space-y-1">
        {BOTTOM_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
