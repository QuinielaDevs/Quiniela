import { LoginForm } from "@/components/login-form";
import { getSafeNextPath } from "@/utils/redirect";
import { Suspense } from "react";

async function LoginFormWithSearchParams({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const next = getSafeNextPath(params?.next);

  return <LoginForm next={next} />;
}

export default function Page({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense>
          <LoginFormWithSearchParams searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
