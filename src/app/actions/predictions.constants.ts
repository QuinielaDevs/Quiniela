export const MAX_PREDICTION_SCORE = 99;

export const SAVE_ERROR = "No pudimos guardar tu prediccion. Intenta de nuevo.";
export const TRANSIENT_SAVE_ERROR = "Error al guardar. Reintentando...";
// Error definitivo (NO reintentable) por bloqueo de kickoff (Story 2.4): la RPC
// fn_save_prediction lanza 'Pronostico cerrado' cuando now() >= match_time.
export const PREDICTION_LOCKED_ERROR =
  "Pronostico cerrado. El partido esta por comenzar.";
