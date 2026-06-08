// Setup global para el proyecto "unit": extiende `expect` de Vitest con los
// matchers de jest-dom (toBeInTheDocument, toHaveTextContent, etc.).
import "@testing-library/jest-dom/vitest";

// jsdom no implementa ResizeObserver, que componentes de Radix (p. ej. Select)
// usan al montar. Polyfill no-op para poder renderizarlos en tests.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
