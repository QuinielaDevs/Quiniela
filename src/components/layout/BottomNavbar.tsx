"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS, isNavItemActive } from "@/components/layout/nav-items";
import { cn } from "@/utils/utils";

// Barra de navegación inferior móvil (EXPERIENCE: Pronósticos | Posiciones |
// Duelos | Mi Cuenta). Se oculta en desktop (lg+), donde la navegación pasa a la
// barra superior horizontal (TopNav).
export function BottomNavbar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación principal"
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card lg:hidden"
    >
      <ul className="mx-auto flex w-full max-w-md items-stretch">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.enabled && isNavItemActive(pathname, item.href);
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
                  data-testid="nav-item"
                  data-route={item.href}
                  className="block"
                >
                  {content}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  data-testid="nav-item"
                  data-route={item.href}
                  className="block cursor-not-allowed"
                >
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
