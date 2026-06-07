export const MAX_PREDICTION_SCORE = 99;

export const SAVE_ERROR = "No pudimos guardar tu prediccion. Intenta de nuevo.";
export const TRANSIENT_SAVE_ERROR = "Error al guardar. Reintentando...";
// Error definitivo (NO reintentable) por bloqueo de kickoff (Story 2.4): la RPC
// fn_save_prediction lanza 'Pronostico cerrado' cuando now() >= match_time.
export const PREDICTION_LOCKED_ERROR =
  "Pronostico cerrado. El partido esta por comenzar.";

// Ventana de gracia para "deshacer cambio" (debe espejar fn_revert_prediction:
// 2 minutos). Pasada la ventana, el cliente oculta el botón de deshacer.
export const UNDO_WINDOW_MS = 2 * 60 * 1000;

// El servidor (fn_revert_prediction) rechaza un deshacer fuera de la ventana de
// gracia con errcode 'P0003'. La acción lo mapea a este mensaje estable.
export const UNDO_EXPIRED_ERROR =
  "Ya no puedes deshacer este cambio. Pasó la ventana para revertir.";

export const UNDO_ERROR = "No pudimos deshacer el cambio. Intenta de nuevo.";
