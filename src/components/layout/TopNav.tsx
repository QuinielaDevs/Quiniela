"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS, isNavItemActive } from "@/components/layout/nav-items";
import { cn } from "@/utils/utils";

// Barra de navegación superior horizontal para desktop (lg+). En móvil se oculta
// y la navegación la provee la BottomNavbar. Brand a la izquierda + ítems a la
// derecha con estado activo dorado.
export function TopNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación principal"
      className="sticky top-0 z-30 hidden border-b border-border bg-card/80 backdrop-blur-md lg:block"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-8 py-3">
        <Link
          href="/predictions"
          className="font-display text-lg font-bold tracking-tight text-foreground"
        >
          PIJA <span className="text-accent">Quiniela</span>
        </Link>

        <ul className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.enabled && isNavItemActive(pathname, item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent/15 text-accent"
                      : "text-muted-foreground hover:bg-background hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
