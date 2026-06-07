"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const logout = () => {
    startTransition(async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/auth/login");
      router.refresh();
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={logout}
      disabled={isPending}
      aria-label="Cerrar sesión"
    >
      <LogOut aria-hidden="true" />
      {isPending ? "Cerrando..." : "Cerrar sesión"}
    </Button>
  );
}
