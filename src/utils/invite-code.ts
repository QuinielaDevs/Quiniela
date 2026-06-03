import { randomInt } from "node:crypto";

/**
 * Alfabeto del invite_code SIN caracteres ambiguos: se omiten O/0, I/1 y L
 * para que el código sea fácil de dictar/teclear en móvil (lo consume
 * /join/[invite_code] en Story 1.4). [Source: Story 1.3 Dev Notes]
 */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Longitud por defecto del invite_code. */
export const INVITE_CODE_LENGTH = 8;

/**
 * Genera un invite_code aleatorio. Usa `crypto.randomInt` (sin sesgo de módulo)
 * en vez de Math.random. NO garantiza unicidad por sí solo: el llamante debe
 * reintentar ante una violación `unique` (Postgres 23505) regenerando el código.
 */
export function generateInviteCode(length: number = INVITE_CODE_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}
