"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/utils/utils";

export type ScrollableTab = { key: string; label: string };

type ScrollableTabsProps = {
  tabs: ScrollableTab[];
  activeKey: string;
  onSelect: (key: string) => void;
  // Etiqueta accesible del tablist y de los botones de desplazamiento.
  ariaLabel: string;
};

const FADE_EPSILON = 4;

// Tab Bar nivel-2 desplazable (UX-DR-7 / EXPERIENCE tab-bar-container):
// overflow-x con scrollbar oculto, fades + chevrons según scrollLeft, y
// centrado del tab activo vía scrollIntoView. En desktop el contenido suele
// caber sin scroll, por lo que los fades/chevrons no aparecen.
export function ScrollableTabs({
  tabs,
  activeKey,
  onSelect,
  ariaLabel,
}: ScrollableTabsProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  function updateFades() {
    const el = scrollerRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > FADE_EPSILON);
    setShowRight(
      el.scrollLeft + el.clientWidth < el.scrollWidth - FADE_EPSILON,
    );
  }

  useEffect(() => {
    updateFades();
    const el = scrollerRef.current;
    if (!el) return;
    const handler = () => updateFades();
    el.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("resize", handler);
    return () => {
      el.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
    };
  }, [tabs.length]);

  function select(key: string) {
    onSelect(key);
    const btn = tabRefs.current.get(key);
    btn?.scrollIntoView({ inline: "center", block: "nearest" });
  }

  function nudge(direction: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.6, behavior: "smooth" });
  }

  return (
    <div className="relative border-b border-border bg-card">
      {showLeft && (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-card to-transparent" />
          <button
            type="button"
            onClick={() => nudge(-1)}
            aria-label={`Desplazar ${ariaLabel} a la izquierda`}
            className="absolute left-0 top-1/2 z-20 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
        </>
      )}

      <div
        ref={scrollerRef}
        role="tablist"
        aria-label={ariaLabel}
        className="flex gap-1 overflow-x-auto scroll-smooth px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          return (
            <button
              key={tab.key}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.key, node);
                else tabRefs.current.delete(tab.key);
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => select(tab.key)}
              className={cn(
                "h-12 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {showRight && (
        <>
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-card to-transparent" />
          <button
            type="button"
            onClick={() => nudge(1)}
            aria-label={`Desplazar ${ariaLabel} a la derecha`}
            className="absolute right-0 top-1/2 z-20 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-foreground"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}
