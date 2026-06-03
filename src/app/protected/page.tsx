import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";
import { InfoIcon } from "lucide-react";
import { FetchDataSteps } from "@/components/tutorial/fetch-data-steps";
import { Suspense } from "react";

async function UserDetails() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  return JSON.stringify(data.claims, null, 2);
}

type ProtectedPageProps = {
  searchParams?: Promise<{ joined?: string; league?: string }>;
};

// `searchParams` es un dato dinámico (uncached): con `cacheComponents` (Next 16)
// debe consumirse dentro de un <Suspense>, no en el cuerpo de la página, o el
// prerender estático falla. Por eso el banner vive en este hijo async.
async function JoinedBanner({ searchParams }: ProtectedPageProps) {
  const params = searchParams ? await searchParams : undefined;
  if (params?.joined !== "1") return null;

  return (
    <div className="w-full">
      <div className="rounded-md border border-success bg-success/15 p-3 px-5 text-sm font-medium text-success">
        ¡Te has unido con éxito! Ya puedes registrar tus pronósticos.
      </div>
    </div>
  );
}

export default function ProtectedPage({ searchParams }: ProtectedPageProps) {
  return (
    <div className="flex-1 w-full flex flex-col gap-12">
      <Suspense fallback={null}>
        <JoinedBanner searchParams={searchParams} />
      </Suspense>
      <div className="w-full">
        <div className="bg-accent text-sm p-3 px-5 rounded-md text-foreground flex gap-3 items-center">
          <InfoIcon size="16" strokeWidth={2} />
          This is a protected page that you can only see as an authenticated
          user
        </div>
      </div>
      <div className="flex flex-col gap-2 items-start">
        <h2 className="font-bold text-2xl mb-4">Your user details</h2>
        <pre className="text-xs font-mono p-3 rounded border max-h-32 overflow-auto">
          <Suspense>
            <UserDetails />
          </Suspense>
        </pre>
      </div>
      <div>
        <h2 className="font-bold text-2xl mb-4">Next steps</h2>
        <FetchDataSteps />
      </div>
    </div>
  );
}
