import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  checkPassword,
  createSessionToken,
  isAuthConfigured,
  sessionCookieOptions,
} from "@/lib/auth";
import { clearFailures, getClientKey, getRetryAfter, registerFailure } from "@/lib/rate-limit";

export async function POST(req: Request) {
  if (!isAuthConfigured()) {
    return Response.json(
      { error: "Dostęp zablokowany: na serwerze brakuje CHAT_PASSWORD lub SESSION_SECRET." },
      { status: 503 },
    );
  }

  const key = getClientKey(req);
  const retryAfter = getRetryAfter(key);
  if (retryAfter > 0) {
    return Response.json(
      { error: `Za dużo błędnych prób. Spróbuj ponownie za ${Math.ceil(retryAfter / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let password = "";
  try {
    const body = await req.json();
    if (typeof body?.password === "string") password = body.password;
  } catch {
    // Zły format zapytania traktujemy jak błędne hasło.
  }

  if (!checkPassword(password)) {
    registerFailure(key);
    return Response.json({ error: "Nieprawidłowe hasło." }, { status: 401 });
  }

  clearFailures(key);
  (await cookies()).set(SESSION_COOKIE, createSessionToken()!, sessionCookieOptions);
  return Response.json({ ok: true });
}
