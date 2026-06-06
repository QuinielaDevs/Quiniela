# Blind Hunter Review Prompt

You are the Blind Hunter. You receive ONLY the git diff of the changes. You have NO access to the project files, the specification, or any other context. Your goal is to inspect the diff for syntax errors, logical bugs, poor naming, code quality issues, or obvious flaws.

## Git Diff
```diff
diff --git a/src/app/predictions/page.tsx b/src/app/predictions/page.tsx
index 5515c0e..de6498a 100644
--- a/src/app/predictions/page.tsx
+++ b/src/app/predictions/page.tsx
@@ -145,7 +145,7 @@ export default function PredictionsPage({
   searchParams,
 }: PredictionsPageProps) {
   return (
-    <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground lg:px-8 lg:py-10">
+    <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground lg:px-8 lg:pt-10 lg:pb-28">
       <div className="mx-auto flex w-full max-w-md flex-col gap-4 lg:max-w-5xl lg:gap-6">
         <header className="space-y-1">
           <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent">
diff --git a/src/components/layout/BottomNavbar.tsx b/src/components/layout/BottomNavbar.tsx
index 2299dbe..509c313 100644
--- a/src/components/layout/BottomNavbar.tsx
+++ b/src/components/layout/BottomNavbar.tsx
@@ -34,7 +34,10 @@ export function BottomNavbar() {
       <ul className="mx-auto flex w-full max-w-md items-stretch">
         {ITEMS.map((item) => {
           const Icon = item.icon;
-          const isActive = item.enabled && pathname === item.href;
+          const isActive =
+            item.enabled &&
+            (pathname === item.href ||
+              (item.href === "/standings" && pathname === "/live"));
           const content = (
             <span
               className={cn(
diff --git a/src/app/live/page.tsx b/src/app/live/page.tsx
index 4952fa8..5bc6082 100644
--- a/src/app/live/page.tsx
+++ b/src/app/live/page.tsx
@@ -146,11 +146,19 @@ export default function LivePage() {
   return (
     <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground">
       <div className="mx-auto flex w-full max-w-md flex-col gap-4">
-        <header className="space-y-1">
-          <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent">
-            PIJA Quiniela
-          </p>
-          <h1 className="font-display text-2xl font-bold">Tabla en Vivo</h1>
+        <header className="flex items-center justify-between">
+          <div className="space-y-1">
+            <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent">
+              PIJA Quiniela
+            </p>
+            <h1 className="font-display text-2xl font-bold">Tabla en Vivo</h1>
+          </div>
+          <Link
+            href="/standings"
+            className="inline-flex h-9 items-center justify-center rounded-full border border-border bg-card px-4 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
+          >
+            Volver
+          </Link>
         </header>
 
         <Suspense fallback={<BoardSkeleton />}>
diff --git a/src/components/predictions/MatchCard.test.tsx b/src/components/predictions/MatchCard.test.tsx
index 004e25a..9a8f4c2 100644
--- a/src/components/predictions/MatchCard.test.tsx
+++ b/src/components/predictions/MatchCard.test.tsx
@@ -99,7 +99,7 @@ describe("MatchCard", () => {
     expect(savePrediction).not.toHaveBeenCalled();
 
     await act(async () => {
-      vi.advanceTimersByTime(499);
+      vi.advanceTimersByTime(1499);
     });
     expect(savePrediction).not.toHaveBeenCalled();
 
@@ -126,7 +126,7 @@ describe("MatchCard", () => {
 
     renderMatchCard();
     await act(async () => {
-      vi.advanceTimersByTime(1000);
+      vi.advanceTimersByTime(2000);
     });
     await flushPromises();
 
@@ -147,7 +147,7 @@ describe("MatchCard", () => {
     });
     fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
     await act(async () => {
-      vi.advanceTimersByTime(499);
+      vi.advanceTimersByTime(1499);
     });
 
     expect(savePrediction).not.toHaveBeenCalled();
@@ -178,7 +178,7 @@ describe("MatchCard", () => {
     fireEvent.click(screen.getByLabelText("Disminuir goles de Argentina"));
 
     await act(async () => {
-      vi.advanceTimersByTime(500);
+      vi.advanceTimersByTime(1500);
     });
     await flushPromises();
 
@@ -199,7 +199,7 @@ describe("MatchCard", () => {
 
     fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
     await act(async () => {
-      vi.advanceTimersByTime(500);
+      vi.advanceTimersByTime(1500);
     });
 
     expect(screen.getByText("Guardando...")).toBeInTheDocument();
@@ -225,7 +225,7 @@ describe("MatchCard", () => {
 
     fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
     await act(async () => {
-      vi.advanceTimersByTime(500);
+      vi.advanceTimersByTime(1500);
     });
 
     expect(savePrediction).not.toHaveBeenCalled();
@@ -248,7 +248,7 @@ describe("MatchCard", () => {
 
     fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
     await act(async () => {
-      vi.advanceTimersByTime(500);
+      vi.advanceTimersByTime(1500);
     });
     await flushPromises();
 
@@ -272,7 +272,7 @@ describe("MatchCard", () => {
 
     fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
     await act(async () => {
-      vi.advanceTimersByTime(500);
+      vi.advanceTimersByTime(1500);
     });
     await flushPromises();
 
@@ -297,7 +297,7 @@ describe("MatchCard", () => {
 
     fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
     await act(async () => {
-      vi.advanceTimersByTime(500);
+      vi.advanceTimersByTime(1500);
     });
 
     await flushPromises();
@@ -322,7 +322,7 @@ describe("MatchCard", () => {
 
     fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
     await act(async () => {
-      vi.advanceTimersByTime(500);
+      vi.advanceTimersByTime(1500);
     });
     await flushPromises();
 
@@ -369,7 +369,7 @@ describe("MatchCard", () => {
     expect(screen.getByText("1")).toBeInTheDocument();
 
     await act(async () => {
-      vi.advanceTimersByTime(1000);
+      vi.advanceTimersByTime(2000);
     });
     await flushPromises();
 
@@ -420,7 +420,7 @@ describe("MatchCard", () => {
     expect(screen.queryByRole("alertdialog")).toBeNull();
 
     await act(async () => {
-      vi.advanceTimersByTime(500);
+      vi.advanceTimersByTime(1500);
     });
     await flushPromises();
 
@@ -444,7 +444,7 @@ describe("MatchCard", () => {
     fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
 
     await act(async () => {
-      vi.advanceTimersByTime(500);
+      vi.advanceTimersByTime(1500);
     });
     await flushPromises();
 
@@ -467,7 +467,7 @@ describe("MatchCard", () => {
     fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
 
     await act(async () => {
-      vi.advanceTimersByTime(500);
+      vi.advanceTimersByTime(1500);
     });
     await flushPromises();
 
@@ -511,7 +511,7 @@ describe("MatchCard", () => {
 
     fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
     await act(async () => {
-      vi.advanceTimersByTime(500);
+      vi.advanceTimersByTime(1500);
     });
     await flushPromises();
 
diff --git a/src/components/predictions/MatchCard.tsx b/src/components/predictions/MatchCard.tsx
index 322025d..13cc715 100644
--- a/src/components/predictions/MatchCard.tsx
+++ b/src/components/predictions/MatchCard.tsx
@@ -55,7 +55,7 @@ type PendingPrediction = {
   awayScorePred: number;
 };
 
-const DEBOUNCE_MS = 500;
+const DEBOUNCE_MS = 1500;
 const OFFLINE_COPY = "Sin conexion - Pendiente";
 const LOCKED_COPY = "Pronostico cerrado";
 const TBD_COPY = "Pendiente de clasificacion";
@@ -324,6 +324,15 @@ export function MatchCard({
     };
   }, [runSave, saveState]);
 
+  useEffect(() => {
+    if (saveState === "saved") {
+      const timer = setTimeout(() => {
+        setSaveState("idle");
+      }, 3000);
+      return () => clearTimeout(timer);
+    }
+  }, [saveState]);
+
   // Intercepta una edición: si bajaría el multiplicador guardado y no se ha
   // confirmado aún, abre la advertencia ANTES de tocar el estado/debounce.
   const requestScoreChange = useCallback(
diff --git a/src/components/ui/ScrollableTabs.tsx b/src/components/ui/ScrollableTabs.tsx
index e405d55..30e06e1 100644
--- a/src/components/ui/ScrollableTabs.tsx
+++ b/src/components/ui/ScrollableTabs.tsx
@@ -67,15 +67,15 @@ export function ScrollableTabs({
   }
 
   return (
-    <div className="relative border-b border-border bg-card">
+    <div className="relative rounded-full border border-border bg-card/60 p-1 shadow-sm backdrop-blur-sm">
       {showLeft && (
         <>
-          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-card to-transparent" />
+          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-card to-transparent rounded-l-full" />
           <button
             type="button"
             onClick={() => nudge(-1)}
             aria-label={`Desplazar ${ariaLabel} a la izquierda`}
-            className="absolute left-0 top-1/2 z-20 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-foreground"
+            className="absolute left-1.5 top-1/2 z-20 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-foreground"
           >
             <ChevronLeft className="size-4" aria-hidden="true" />
           </button>
@@ -86,7 +86,7 @@ export function ScrollableTabs({
         ref={scrollerRef}
         role="tablist"
         aria-label={ariaLabel}
-        className="flex gap-1 overflow-x-auto scroll-smooth px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
+        className="flex gap-1 overflow-x-auto scroll-smooth px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-full"
       >
         {tabs.map((tab) => {
           const isActive = tab.key === activeKey;
@@ -116,12 +116,12 @@ export function ScrollableTabs({
 
       {showRight && (
         <>
-          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-card to-transparent" />
+          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-card to-transparent rounded-r-full" />
           <button
             type="button"
             onClick={() => nudge(1)}
             aria-label={`Desplazar ${ariaLabel} a la derecha`}
-            className="absolute right-0 top-1/2 z-20 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-foreground"
+            className="absolute right-1.5 top-1/2 z-20 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-foreground"
           >
             <ChevronRight className="size-4" aria-hidden="true" />
           </button>
diff --git a/src/utils/scoring.ts b/src/utils/scoring.ts
index 9f5c39d..a6b97ba 100644
--- a/src/utils/scoring.ts
+++ b/src/utils/scoring.ts
@@ -120,7 +120,7 @@ export function calculatePredictionMultiplier(
   firstMatchTime?: Date | string | number,
 ): number {
   const savedAtMs = toMs(savedAt);
-  const refTimeMs = firstMatchTime ? toMs(firstMatchTime) : toMs(matchTime);
+  const refTimeMs = toMs(matchTime);
   if (!Number.isFinite(savedAtMs) || !Number.isFinite(refTimeMs)) {
     return MIN_MULTIPLIER;
   }
```

Please review the diff and report any code issues, naming problems, or logical defects.
