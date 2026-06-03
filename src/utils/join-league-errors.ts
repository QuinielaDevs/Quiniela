type RpcError = {
  code?: string | null;
  message?: string | null;
};

export function getJoinLeagueErrorMessage(error: RpcError | null | undefined) {
  if (error?.code === "22023") return "Invitación inválida.";
  if (error?.code === "42501") return "Inicia sesión para unirte a la liga.";

  return "No pudimos unirte a la liga. Intenta de nuevo.";
}
