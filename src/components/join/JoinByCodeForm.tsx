"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { joinLeagueByInvite } from "@/app/actions/leagues.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Entrada manual de código de invitación: une al usuario autenticado a una liga
// sin necesidad de un enlace. La validación de longitud/alfabeto y el mapeo de
// errores viven en la server action `joinLeagueByInvite` (no se duplican aquí).
export function JoinByCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await joinLeagueByInvite(code);

      if (!result.success || !result.data) {
        setError(result.error ?? "No pudimos unirte a la liga.");
        return;
      }

      router.push(`/predictions?joined=1&league=${result.data.league_id}`);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="invite-code">Código de invitación</Label>
        <Input
          id="invite-code"
          name="invite-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Ej. ABC123"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="uppercase tracking-widest"
          aria-invalid={error ? true : undefined}
        />
      </div>

      <Button
        type="submit"
        size="xl"
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
        disabled={isPending || code.trim().length === 0}
      >
        {isPending ? "Uniéndote..." : "Unirme con el código"}
      </Button>

      {error && (
        <p
          role="alert"
          className="rounded-sm border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive-foreground"
        >
          {error}
        </p>
      )}
    </form>
  );
}
