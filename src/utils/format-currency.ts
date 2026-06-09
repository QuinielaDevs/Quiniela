// Formato de moneda del producto. Las inscripciones de liga se cobran en USD,
// así que mostramos el símbolo y el código explícito ("$10 USD") para evitar la
// ambigüedad del "$" en contextos LatAm (peso, bolívar, etc.).
//
// Decimales inteligentes: enteros sin centavos ("$10 USD"), montos con centavos
// con 2 decimales ("$10.50 USD"); separador de miles ("$1,500 USD").

/** Formatea un monto numérico en USD: "$10 USD" / "$10.50 USD" / "$1,500 USD". */
export function formatUsd(amount: number): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "symbol",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);

  return `${formatted} USD`;
}

/**
 * Igual que `formatUsd` pero acepta `null` para la tarifa de inscripción sin
 * confirmar (liga que requiere pago pero aún sin monto fijado).
 */
export function formatPaymentAmount(amount: number | null): string {
  if (amount === null) return "Monto por confirmar";
  return formatUsd(amount);
}
