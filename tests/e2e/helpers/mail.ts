// Lectura del buzón de email local de Supabase (Fase 1 del plan E2E).
// config.toml expone el servidor de pruebas en http://127.0.0.1:54324; según
// la versión del CLI es Mailpit (/api/v1/messages) o Inbucket
// (/api/v1/mailbox/{user}). Este helper detecta cuál responde.
// (El stack actual levanta Mailpit; Inbucket queda como fallback.)

const MAIL_BASE = process.env.SUPABASE_MAIL_URL ?? "http://127.0.0.1:54324";

export interface CapturedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

type MailpitMessageSummary = {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
};

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getLastEmailViaMailpit(email: string): Promise<CapturedEmail | null> {
  const list = (await fetchJson(`${MAIL_BASE}/api/v1/messages?limit=50`)) as {
    messages?: MailpitMessageSummary[];
  } | null;
  if (!list?.messages) return null;

  const target = email.toLowerCase();
  const match = list.messages.find((msg) =>
    (msg.To ?? []).some((to) => to.Address?.toLowerCase() === target),
  );
  if (!match) return null;

  const detail = (await fetchJson(`${MAIL_BASE}/api/v1/message/${match.ID}`)) as {
    HTML?: string;
    Text?: string;
    Subject?: string;
  } | null;
  if (!detail) return null;

  return {
    to: email,
    subject: detail.Subject ?? match.Subject ?? "",
    html: detail.HTML ?? "",
    text: detail.Text ?? "",
  };
}

async function getLastEmailViaInbucket(email: string): Promise<CapturedEmail | null> {
  const mailbox = email.split("@")[0];
  const list = (await fetchJson(`${MAIL_BASE}/api/v1/mailbox/${mailbox}`)) as Array<{
    id: string;
    subject: string;
  }> | null;
  if (!list || list.length === 0) return null;

  const last = list[list.length - 1];
  if (!last) return null;
  const detail = (await fetchJson(`${MAIL_BASE}/api/v1/mailbox/${mailbox}/${last.id}`)) as {
    subject?: string;
    body?: { html?: string; text?: string };
  } | null;
  if (!detail) return null;

  return {
    to: email,
    subject: detail.subject ?? last.subject ?? "",
    html: detail.body?.html ?? "",
    text: detail.body?.text ?? "",
  };
}

/** Último email recibido por `email`, o null si no hay (Mailpit → Inbucket). */
export async function getLastEmailTo(email: string): Promise<CapturedEmail | null> {
  const viaMailpit = await getLastEmailViaMailpit(email);
  if (viaMailpit) return viaMailpit;
  return getLastEmailViaInbucket(email);
}

/** Espera (polling) a que llegue un email para `email`. */
export async function waitForEmailTo(
  email: string,
  { timeoutMs = 15_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<CapturedEmail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const captured = await getLastEmailTo(email);
    if (captured) return captured;
    if (Date.now() > deadline) {
      throw new Error(`No llegó ningún email para ${email} en ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Extrae los links (href y URLs sueltas) del cuerpo de un email. */
export function extractLinks(htmlOrText: string): string[] {
  const links = new Set<string>();
  for (const match of htmlOrText.matchAll(/href="([^"]+)"/gi)) {
    if (match[1]) links.add(match[1]);
  }
  for (const match of htmlOrText.matchAll(/https?:\/\/[^\s"'<>\])]+/gi)) {
    links.add(match[0]);
  }
  // Los cuerpos HTML escapan & como &amp; — normalizamos para usar el link.
  return Array.from(links).map((link) => link.replace(/&amp;/g, "&"));
}
