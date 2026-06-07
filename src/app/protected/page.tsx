import { redirect } from "next/navigation";

// Ruta legado del template inicial. El destino autenticado canónico de PIJA
// Quiniela es /predictions, y esta página no debe leer datos dinámicos durante
// prerender.
export default function ProtectedPage() {
  redirect("/predictions");
}
