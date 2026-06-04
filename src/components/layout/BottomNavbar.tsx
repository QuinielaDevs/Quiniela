"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Trophy, Swords, User } from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "@/utils/utils";

// Barra de navegación inferior móvil (EXPERIENCE: Pronósticos | Posiciones |
// Duelos | Mi Cuenta). Duelos (Epic 5) queda como placeholder deshabilitado.
type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  enabled: boolean;
};

const ITEMS: NavItem[] = [
  { href: "/predictions", label: "Pronósticos", icon: ClipboardList, enabled: true },
  { href: "/standings", label: "Posiciones", icon: Trophy, enabled: true },
  { href: "/duels", label: "Duelos", icon: Swords, enabled: false },
  { href: "/account", label: "Mi Cuenta", icon: User, enabled: true },
];

export function BottomNavbar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card"
    >
      <ul className="mx-auto flex w-full max-w-md items-stretch">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.enabled && pathname === item.href;
          const content = (
            <span
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                isActive
                  ? "text-accent"
                  : item.enabled
                    ? "text-muted-foreground"
                    : "text-muted-foreground/40",
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              {item.label}
            </span>
          );

          return (
            <li key={item.href} className="flex-1">
              {item.enabled ? (
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className="block"
                >
                  {content}
                </Link>
              ) : (
                <span aria-disabled="true" className="block cursor-not-allowed">
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
