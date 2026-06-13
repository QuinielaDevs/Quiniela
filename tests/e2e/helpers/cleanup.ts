// Pila de limpieza LIFO para los seeds E2E (Fase 1 del plan).
// Cada paso registrado con add() se ejecuta en orden inverso al registrarse
// (respeta FKs: lo último creado se borra primero). Idempotente: run() drena
// la pila, así que una segunda llamada no repite pasos. Un paso que falla se
// loguea y NO aborta el resto (si un test murió a mitad, el siguiente run debe
// poder limpiar lo que quede).

export type CleanupFn = () => Promise<void> | void;

export interface CleanupStack {
  add(fn: CleanupFn): void;
  run(): Promise<void>;
}

export function createCleanupStack(): CleanupStack {
  const steps: CleanupFn[] = [];

  return {
    add(fn: CleanupFn) {
      steps.push(fn);
    },
    async run() {
      while (steps.length > 0) {
        const step = steps.pop()!;
        try {
          await step();
        } catch (error) {
          console.warn("[e2e cleanup] paso de limpieza falló (continuando):", error);
        }
      }
    },
  };
}
