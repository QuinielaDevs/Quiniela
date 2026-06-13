// Helpers de usuarios E2E (Fase 1 del plan): creación vía admin API, login por
// el formulario REAL (/auth/login) y orquestación multi-usuario (liga + n
// miembros con BrowserContext propio).
//
// La estrategia de auth es deliberadamente FORM-BASED (no se forjan cookies):
// pasar por /auth/login setea las cookies chunked/base64 que Supabase SSR
// espera, igual que un usuario real.

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { createAdminClient } from "./admin";
import { createCleanupStack } from "./cleanup";
import { addMember, seedLeague, setActiveLeague, type SeededLeague } from "./seed/league";

export const TEST_PASSWORD = "PijaE2E!Test-2026";

/** runId único por ejecución para nombres/códigos sin colisiones. */
export function newRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface E2EUser {
  userId: string;
  email: string;
  password: string;
  displayName?: string;
}

export interface E2EAuth extends E2EUser {
  context: BrowserContext;
  page: Page;
}

export interface CreateUserOpts {
  /** Sufijo legible del email (default: runId nuevo). */
  runId?: string;
  /** Índice/etiqueta cuando se crean varios usuarios del mismo run. */
  tag?: string | number;
  /** display_name del profile (default del trigger: "Jugador Anónimo"). */
  displayName?: string;
}

// Crea un usuario confirmado vía admin API. No abre navegador.
export async function createUser(opts: CreateUserOpts = {}): Promise<E2EUser> {
  const admin = createAdminClient();
  const runId = opts.runId ?? newRunId();
  const tag = opts.tag !== undefined ? `-${opts.tag}` : "";
  const email = `e2e-${runId}${tag}@test.pija`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`No se pudo crear el usuario e2e: ${createErr?.message ?? "unknown"}`);
  }
  const userId = created.user.id;

  if (opts.displayName) {
    // El profile lo crea el trigger fn_handle_new_user; el upsert cubre el caso
    // (improbable) de que aún no exista al momento de setear el nombre.
    await admin
      .from("profiles")
      .upsert({ id: userId, display_name: opts.displayName }, { onConflict: "id" });
  }

  return { userId, email, password: TEST_PASSWORD, displayName: opts.displayName };
}

// Login por el formulario real. Labels y botón copiados de login-form.tsx.
// El login redirige a /predictions tras éxito; esperar la URL garantiza que
// las cookies de sesión quedaron persistidas en el contexto.
export async function loginViaForm(
  page: Page,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<void> {
  await page.goto("/auth/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: /iniciar sesi/i }).click();
  await page.waitForURL(/\/predictions/, { timeout: 15_000 });
}

// Abre un BrowserContext nuevo y deja al usuario logueado en él.
export async function loginAs(
  browser: Browser,
  user: Pick<E2EUser, "email" | "password">,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginViaForm(page, user.email, user.password);
  return { context, page };
}

// Wrapper de compatibilidad: crea usuario + contexto autenticado (la API
// histórica de tests/e2e/helpers/auth.ts).
export async function createAuthenticatedContext(browser: Browser): Promise<E2EAuth> {
  const user = await createUser();
  const { context, page } = await loginAs(browser, user);
  return { ...user, context, page };
}

export async function deleteE2EUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.auth.admin.deleteUser(userId);
}

// ──────────────────────────────────────────────────────────────────────
// Multi-usuario: liga + n miembros listos para usar.
// ──────────────────────────────────────────────────────────────────────

export interface LeagueUser extends E2EUser {
  role: "admin" | "member";
  /** Contexto logueado. Solo los primeros `eagerLogins` usuarios lo traen
   *  pre-abierto; para el resto usar `login()` (lazy, evita pagar n logins). */
  context?: BrowserContext;
  page?: Page;
  /** Abre (o devuelve) el contexto logueado de este usuario. */
  login(): Promise<{ context: BrowserContext; page: Page }>;
}

export interface CreateLeagueWithUsersOpts {
  /** Nº total de miembros (incluye a los admins). */
  members: number;
  /** Nº de admins (los primeros usuarios). Default 1. */
  admins?: number;
  /** Cuántos contextos abrir eagerly (default min(2, members)). */
  eagerLogins?: number;
  leagueOpts?: {
    name?: string;
    requiresPayment?: boolean;
    paymentAmount?: number | null;
    paymentInstructions?: string | null;
    /** payment_status de los miembros (default "paid" para no disparar modales). */
    paymentStatus?: "pending" | "paid";
    /** Saldo inicial de duelos por miembro (inserta seed_initial_balance). */
    wagerBalance?: number;
  };
}

export interface LeagueWithUsers {
  league: SeededLeague;
  users: LeagueUser[];
  runId: string;
  /** Limpieza LIFO de todo lo creado (contextos, membresías, liga, usuarios). */
  cleanup(): Promise<void>;
}

export async function createLeagueWithUsers(
  browser: Browser,
  opts: CreateLeagueWithUsersOpts,
): Promise<LeagueWithUsers> {
  const { members, admins = 1, leagueOpts = {} } = opts;
  if (members < 1) throw new Error("createLeagueWithUsers: members debe ser >= 1");
  const eagerLogins = Math.min(opts.eagerLogins ?? 2, members);

  const runId = newRunId();
  const stack = createCleanupStack();

  // 1) Usuarios
  const baseUsers: E2EUser[] = [];
  for (let i = 0; i < members; i++) {
    const user = await createUser({ runId, tag: i, displayName: `E2E Jugador ${i}` });
    baseUsers.push(user);
    stack.add(() => deleteE2EUser(user.userId));
  }

  // 2) Liga (creada por el primer usuario) + membresías
  const creator = baseUsers[0]!;
  const league = await seedLeague({
    runId,
    creatorId: creator.userId,
    name: leagueOpts.name,
    requiresPayment: leagueOpts.requiresPayment,
    paymentAmount: leagueOpts.paymentAmount,
    paymentInstructions: leagueOpts.paymentInstructions,
  });
  stack.add(() => league.cleanup());

  for (let i = 0; i < members; i++) {
    const member = baseUsers[i]!;
    await addMember(league.id, member.userId, {
      role: i < admins ? "admin" : "member",
      paymentStatus: leagueOpts.paymentStatus ?? "paid",
      wagerBalance: leagueOpts.wagerBalance,
    });
    await setActiveLeague(member.userId, league.id);
  }

  // 3) Contextos: eager para los primeros, lazy para el resto.
  const users: LeagueUser[] = baseUsers.map((user, i) => {
    const entry: LeagueUser = {
      ...user,
      role: i < admins ? "admin" : "member",
      async login() {
        if (entry.context && entry.page) {
          return { context: entry.context, page: entry.page };
        }
        const session = await loginAs(browser, user);
        entry.context = session.context;
        entry.page = session.page;
        stack.add(() => session.context.close());
        return session;
      },
    };
    return entry;
  });

  for (let i = 0; i < eagerLogins; i++) {
    await users[i]!.login();
  }

  return {
    league,
    users,
    runId,
    cleanup: () => stack.run(),
  };
}
