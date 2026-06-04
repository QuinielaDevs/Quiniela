// Mensajes de UI para las Server Actions de administración de liga (Story 3.3).
// Se mantienen fuera del módulo "use server" (que solo puede exportar funciones
// async) para poder importarlos también desde componentes cliente y tests.

/** Copy de EXPERIENCE › "Error Administrativo". */
export const ADMIN_SAVE_ERROR =
  "No pudimos guardar los cambios. Por favor revisa tu conexión e inténtalo de nuevo.";

/** Mensaje genérico cuando el backend rechaza por falta de privilegios (42501). */
export const ADMIN_NOT_AUTHORIZED_ERROR =
  "No tienes permisos para realizar esta acción.";
