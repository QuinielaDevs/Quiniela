import { BookOpen, ClipboardList, Trophy, Swords, User } from "lucide-react";
import type { ComponentType } from "react";

// Ítems de la navegación principal de la experiencia, compartidos por la barra
// inferior móvil (BottomNavbar) y la barra superior de desktop (TopNav).
export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  enabled: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/predictions", label: "Pronósticos", icon: ClipboardList, enabled: true },
  { href: "/standings", label: "Posiciones", icon: Trophy, enabled: true },
  { href: "/duels", label: "Duelos", icon: Swords, enabled: true },
  { href: "/rules", label: "Reglas", icon: BookOpen, enabled: true },
  { href: "/account", label: "Mi Cuenta", icon: User, enabled: true },
];

// Regla de activación compartida: el ítem de Posiciones también queda activo en
// la vista En Vivo (/live), que cuelga de esa sección.
export function isNavItemActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/standings" && pathname === "/live") return true;
  return false;
}
