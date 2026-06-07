import { redirect } from "next/navigation";

type ProtectedPageProps = {
  searchParams?: Promise<{ joined?: string; league?: string }>;
};

// Ruta legado del template inicial. El destino autenticado canónico de PIJA
// Quiniela es /predictions, incluso para callbacks OAuth antiguos.
export default async function ProtectedPage({
  searchParams,
}: ProtectedPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const query = new URLSearchParams();

  if (params?.joined) query.set("joined", params.joined);
  if (params?.league) query.set("league", params.league);

  redirect(`/predictions${query.size > 0 ? `?${query.toString()}` : ""}`);
}
