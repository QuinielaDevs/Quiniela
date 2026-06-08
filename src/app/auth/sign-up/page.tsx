import { Suspense } from "react";

import { SignUpForm } from "@/components/sign-up-form";
import { getSafeNextPath } from "@/utils/redirect";

async function SignUpFormWithSearchParams({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const next = getSafeNextPath(params?.next);

  return <SignUpForm next={next} />;
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
          <SignUpFormWithSearchParams searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
