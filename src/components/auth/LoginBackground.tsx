"use client";

import { useEffect, useRef } from "react";

// Fondo animado del login: canvas a pantalla completa con motivo futbolístico
// y de competencia — líneas de cancha en perspectiva, halos de luces de estadio
// y chispas/destellos dorados ascendentes que reaccionan suavemente al puntero.
// Ligero (nº de partículas acotado), escala a devicePixelRatio, cancela el rAF
// al desmontar y respeta `prefers-reduced-motion` (render estático sin loop).

// Colores del tema (ver globals.css).
const COLOR_BG_TOP = "#0D1B2A"; // indigo profundo
const COLOR_BG_BOTTOM = "#13243a";
const COLOR_GOLD = "233, 196, 106"; // #E9C46A dorado campeonato (rgb)
const COLOR_CRIMSON = "230, 57, 70"; // #E63946 carmesí (rgb)
const COLOR_LINE = "65, 90, 119"; // #415A77 slate (líneas de cancha)

const PARTICLE_COUNT = 70;
const POINTER_RADIUS = 140;

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  crimson: boolean;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function paintBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  // Degradado base.
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, COLOR_BG_TOP);
  bg.addColorStop(1, COLOR_BG_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Halos de "luces de estadio".
  const glow = (cx: number, cy: number, r: number, rgb: string, a: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${rgb}, ${a})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  };
  glow(width * 0.18, height * 0.12, Math.max(width, height) * 0.5, COLOR_GOLD, 0.1);
  glow(width * 0.85, height * 0.0, Math.max(width, height) * 0.45, COLOR_CRIMSON, 0.08);
}

function paintPitch(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  // Líneas de cancha en perspectiva hacia un punto de fuga superior central.
  ctx.save();
  ctx.strokeStyle = `rgba(${COLOR_LINE}, 0.35)`;
  ctx.lineWidth = 1;
  const vanishX = width / 2;
  const vanishY = -height * 0.25;

  // Líneas verticales convergentes.
  const verticals = 9;
  for (let i = 0; i <= verticals; i++) {
    const x = (width / verticals) * i;
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.lineTo(vanishX + (x - vanishX) * 0.12, vanishY);
    ctx.globalAlpha = 0.5;
    ctx.stroke();
  }

  // Líneas horizontales que se comprimen con la distancia.
  const horizontals = 7;
  for (let i = 1; i <= horizontals; i++) {
    const t = i / horizontals;
    const y = height - Math.pow(t, 1.8) * height * 0.95;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.globalAlpha = 0.35 * (1 - t) + 0.05;
    ctx.stroke();
  }

  // Círculo central tenue.
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.ellipse(width / 2, height * 0.62, width * 0.16, height * 0.05, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function LoginBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const reduced = prefersReducedMotion();

    if (reduced) {
      paintBackdrop(ctx, width, height);
      paintPitch(ctx, width, height);
      const onResizeStatic = () => {
        resize();
        paintBackdrop(ctx, width, height);
        paintPitch(ctx, width, height);
      };
      window.addEventListener("resize", onResizeStatic);
      return () => window.removeEventListener("resize", onResizeStatic);
    }

    const sparks: Spark[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -(0.15 + Math.random() * 0.45),
      size: 0.6 + Math.random() * 2.2,
      alpha: 0.15 + Math.random() * 0.5,
      crimson: Math.random() < 0.18,
    }));

    let rafId = 0;

    const frame = () => {
      paintBackdrop(ctx, width, height);
      paintPitch(ctx, width, height);

      const pointer = pointerRef.current;

      for (const s of sparks) {
        // Atracción suave hacia el puntero (parallax/interacción).
        if (pointer) {
          const dx = pointer.x - s.x;
          const dy = pointer.y - s.y;
          const dist = Math.hypot(dx, dy);
          if (dist < POINTER_RADIUS && dist > 0.01) {
            const pull = (1 - dist / POINTER_RADIUS) * 0.4;
            s.vx += (dx / dist) * pull * 0.05;
            s.vy += (dy / dist) * pull * 0.05;
          }
        }

        s.x += s.vx;
        s.y += s.vy;
        s.vx *= 0.99;

        // Reaparecer por abajo al salir por arriba/los lados.
        if (s.y < -10) {
          s.y = height + 10;
          s.x = Math.random() * width;
          s.vy = -(0.15 + Math.random() * 0.45);
          s.vx = (Math.random() - 0.5) * 0.25;
        }
        if (s.x < -10) s.x = width + 10;
        if (s.x > width + 10) s.x = -10;

        const rgb = s.crimson ? COLOR_CRIMSON : COLOR_GOLD;
        const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.size * 4);
        glow.addColorStop(0, `rgba(${rgb}, ${s.alpha})`);
        glow.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * 4, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(frame);
    };

    const onResize = () => resize();
    const onPointerMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerLeave = () => {
      pointerRef.current = null;
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
