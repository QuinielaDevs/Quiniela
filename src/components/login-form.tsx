"use client";

import { cn } from "@/utils/utils";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { GoogleSignInButton } from "@/components/google-signin-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSafeNextPath } from "@/utils/redirect";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({
  next = "/predictions",
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & { next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const safeNext = getSafeNextPath(next);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      router.push(safeNext);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="border-border/60 bg-card/80 shadow-2xl shadow-black/40 backdrop-blur-md">
        <CardHeader>
          <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent">
            PIJA Quiniela
          </p>
          <CardTitle className="font-display text-2xl">Inicia sesión</CardTitle>
          <CardDescription>
            Entra con tu correo para registrar tus pronósticos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Contraseña</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    ¿Olvidaste tu contraseña?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && (
                <p className="text-sm text-red-500" data-testid="auth-error">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Iniciando sesión..." : "Iniciar sesión"}
              </Button>
              <div className="relative text-center text-sm">
                <span className="bg-card text-muted-foreground relative z-10 px-2">
                  o
                </span>
                <div className="absolute inset-0 top-1/2 -z-0 border-t" />
              </div>
              <GoogleSignInButton next={safeNext} />
            </div>
            <div className="mt-4 text-center text-sm">
              ¿No tienes una cuenta?{" "}
              <Link
                href={`/auth/sign-up?next=${encodeURIComponent(safeNext)}`}
                className="underline underline-offset-4"
              >
                Regístrate
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
