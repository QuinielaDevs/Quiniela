"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createLeague } from "@/app/actions/leagues.actions";
import type { PredictionMode } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Opciones del modo de predicción: se guarda la clave estable (value), no el
// label (admin-settings.html § "Reglas e Inscripción").
const PREDICTION_MODES: { value: PredictionMode; label: string }[] = [
  { value: "dual", label: "Modo Dual (Anticipado + Jornada con Bonos)" },
  { value: "jornada", label: "Jornada a Jornada (Dinamismo semanal)" },
  { value: "grupos", label: "Fase de Grupos Completa (Pronóstico inicial)" },
];

export function LeagueCreateForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [predictionMode, setPredictionMode] = useState<PredictionMode>("dual");
  const [requiresPayment, setRequiresPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");

  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const amount = paymentAmount.trim() === "" ? null : Number(paymentAmount);

      const result = await createLeague({
        name,
        predictionMode,
        requiresPayment,
        paymentAmount: amount,
        paymentInstructions: requiresPayment ? paymentInstructions : null,
      });

      if (!result.success) {
        setError(result.error ?? "No se pudo crear la liga.");
        return;
      }

      // Éxito (AC #6): redirección directa. isPending mantiene el botón en
      // estado "Creando…" hasta que la navegación toma el control.
      router.push("/protected");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* Nombre de la liga */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="league-name">Nombre de la liga</Label>
        <Input
          id="league-name"
          className="h-12"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. La Liga de los Compadres"
          autoComplete="off"
          required
        />
      </div>

      {/* Modo de predicción */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="prediction-mode">Modo de Predicción</Label>
        <Select
          value={predictionMode}
          onValueChange={(v) => setPredictionMode(v as PredictionMode)}
        >
          <SelectTrigger id="prediction-mode" aria-label="Modo de Predicción">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PREDICTION_MODES.map((mode) => (
              <SelectItem key={mode.value} value={mode.value}>
                {mode.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Toggle Requiere Pago — fila táctil ≥48px */}
      <label
        htmlFor="requires-payment"
        className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
      >
        <span className="flex flex-col">
          <span className="text-sm font-semibold">Requiere Pago</span>
          <span className="text-xs text-muted-foreground">
            Activa el control de inscripción de la liga
          </span>
        </span>
        <Switch
          id="requires-payment"
          checked={requiresPayment}
          onCheckedChange={setRequiresPayment}
          aria-label="Requiere pago de inscripción"
        />
      </label>

      {/* Campos condicionales de pago */}
      {requiresPayment && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="payment-amount">Monto de inscripción</Label>
              <Input
                id="payment-amount"
                className="h-12"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="10.00"
                required={requiresPayment}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="payment-instructions">
                Instrucciones de cobro
              </Label>
              <Textarea
                id="payment-instructions"
                value={paymentInstructions}
                onChange={(e) => setPaymentInstructions(e.target.value)}
                placeholder="Bizum / Zelle / efectivo — incluye datos y concepto"
                required={requiresPayment}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <p
          role="alert"
          className="rounded-sm border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {/* CTA */}
      <Button
        type="submit"
        size="xl"
        disabled={isPending}
        className="mt-2 w-full bg-accent font-bold text-accent-foreground hover:bg-accent/90"
      >
        {isPending ? "Creando…" : "Crear Liga"}
      </Button>
    </form>
  );
}
