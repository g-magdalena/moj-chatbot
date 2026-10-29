import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Ten plik działa tylko na serwerze. Hasło i sekret nigdy nie trafiają do przeglądarki.

export const SESSION_COOKIE = "chat_session";
export const SESSION_MAX_AGE = 60 * 60 * 8; // 8 godzin

function getConfig() {
  const password = process.env.CHAT_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  // Brak konfiguracji blokuje dostęp, zamiast wyłączać ochronę.
  if (!password || !secret || secret.length < 32) return null;
  return { password, secret };
}

export function isAuthConfigured() {
  return getConfig() !== null;
}

function sign(data: string, secret: string) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

// Porównanie w stałym czasie, żeby czas odpowiedzi nie zdradzał hasła.
function safeEqual(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPassword(input: string) {
  const config = getConfig();
  if (!config) return false;
  return safeEqual(input, config.password);
}

// Cookie zawiera tylko datę wygaśnięcia, losowy identyfikator i podpis. Bez hasła.
export function createSessionToken() {
  const config = getConfig();
  if (!config) return null;
  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${expiresAt}.${randomBytes(16).toString("base64url")}`;
  return `${payload}.${sign(payload, config.secret)}`;
}

export function isValidSession(token: string | undefined) {
  const config = getConfig();
  if (!config || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresAt, nonce, signature] = parts;

  if (!safeEqual(signature, sign(`${expiresAt}.${nonce}`, config.secret))) return false;

  const expiresMs = Number(expiresAt);
  return Number.isFinite(expiresMs) && Date.now() < expiresMs;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE,
};
