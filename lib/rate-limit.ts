// Limit błędnych prób hasła.
//
// UWAGA: licznik żyje w pamięci jednego procesu serwera. Lokalnie to wystarcza,
// ale na hostingu (np. Vercel) działa wiele instancji naraz i każda ma własny
// licznik, a restart go zeruje. To NIE jest globalna ochrona. Na produkcji
// potrzebny jest wspólny magazyn (np. Redis) albo reguła limitu w firewallu hostingu.

const WINDOW_MS = 15 * 60 * 1000; // 15 minut
const MAX_FAILURES = 5;

const failures = new Map<string, { count: number; resetAt: number }>();

export function getClientKey(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

// Zwraca liczbę sekund do odblokowania albo 0, jeśli można próbować.
export function getRetryAfter(key: string) {
  const entry = failures.get(key);
  if (!entry) return 0;
  if (Date.now() >= entry.resetAt) {
    failures.delete(key);
    return 0;
  }
  return entry.count >= MAX_FAILURES ? Math.ceil((entry.resetAt - Date.now()) / 1000) : 0;
}

export function registerFailure(key: string) {
  const now = Date.now();
  const entry = failures.get(key);
  if (!entry || now >= entry.resetAt) {
    failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count++;
  }

  // Sprzątanie, żeby mapa nie rosła bez końca.
  if (failures.size > 10_000) {
    for (const [k, v] of failures) if (now >= v.resetAt) failures.delete(k);
  }
}

export function clearFailures(key: string) {
  failures.delete(key);
}
