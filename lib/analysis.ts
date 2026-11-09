import { APICallError, RetryError } from "ai";
import { z } from "zod";

// Tryb analizy wiadomości Studio Nova.
// Model dostaje schemat jako structured output, ale o poprawności wyniku
// decyduje dopiero walidacja w tym pliku, wykonywana na serwerze.

export const CATEGORIES = ["sales", "support", "billing", "unknown"] as const;
export const PRIORITIES = ["normal", "high"] as const;

// Schemat z materiałów kursu, wysyłany do modelu bez zmian.
export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    priority: { type: "string", enum: [...PRIORITIES] },
    draft: { type: "string" },
    needs_review: { type: "boolean" },
  },
  required: ["category", "priority", "draft", "needs_review"],
  additionalProperties: false,
} as const;

// Ten sam schemat w zod, używany do walidacji po stronie serwera.
const analysisSchema = z.strictObject({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  draft: z.string(),
  needs_review: z.boolean(),
});

export type Analysis = z.infer<typeof analysisSchema>;

export type AnalysisErrorCode =
  | "refusal"
  | "truncated"
  | "invalid_json"
  | "invalid_schema"
  | "unsupported"
  | "config"
  | "provider";

export type AnalysisResult =
  | { ok: true; analysis: Analysis; review_reasons?: string[] }
  | { ok: false; code: AnalysisErrorCode; message: string; details?: string[] };

const UNSUPPORTED_MESSAGE =
  "Ustawiony model (lub jego dostawca w OpenRouter) nie obsługuje structured output. " +
  "Zmień OPENROUTER_MODEL na model, który na openrouter.ai/models ma w parametrach " +
  "„structured_outputs”, a potem uruchom serwer ponownie (na Vercel: Redeploy).";

function fail(code: AnalysisErrorCode, message: string, details?: string[]): AnalysisResult {
  return details?.length ? { ok: false, code, message, details } : { ok: false, code, message };
}

// Sprawdza obiekt zwrócony przez model. Opisuje każdy problem po polsku.
export function validateAnalysis(value: unknown): AnalysisResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("invalid_schema", "Model zwrócił coś innego niż obiekt JSON.");
  }

  const parsed = analysisSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => {
      const field = issue.path.join(".");
      if (issue.code === "unrecognized_keys") return `Dodatkowe pole: ${issue.keys.join(", ")}`;
      if (issue.code === "invalid_type" && !(field in value)) return `Brak pola: ${field}`;
      if (issue.code === "invalid_type") return `Zły typ pola ${field} (oczekiwano: ${issue.expected})`;
      if (issue.code === "invalid_value") return `Niedozwolona wartość pola ${field}`;
      return `Błąd pola ${field}: ${issue.message}`;
    });
    return fail("invalid_schema", "Wynik modelu nie pasuje do schematu analizy.", details);
  }

  // Pusty szkic przeszedłby schemat, ale nie jest użytecznym wynikiem.
  if (parsed.data.draft.trim() === "") {
    return fail("invalid_schema", "Wynik modelu nie pasuje do schematu analizy.", ["Pusty szkic: draft"]);
  }

  return { ok: true, analysis: parsed.data };
}

export const MAX_MESSAGE_LENGTH = 4000;

// Z zapytania przeglądarki bierzemy wyłącznie tekst wiadomości. Inne pola
// (np. send_now, role, permissions, system, schema) są pomijane i nie trafiają do modelu.
export function readAnalyzeRequest(body: unknown): { ok: true; message: string } | { ok: false; message: string } {
  const raw = (body as { message?: unknown } | null)?.message;
  const message = typeof raw === "string" ? raw.trim() : "";
  if (!message) return { ok: false, message: "Wklej treść wiadomości do analizy." };
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, message: `Wiadomość jest za długa (maks. ${MAX_MESSAGE_LENGTH} znaków).` };
  }
  return { ok: true, message };
}

// Jedyna cena z cennika firmy. Inna kwota wymaga sprawdzenia przez pracownika.
const ALLOWED_PRICES = [150];

const MANIPULATION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(needs_review|send_now|category|priority|draft)\b/i, "Wiadomość klienta odwołuje się do pól wyniku"],
  [/zignoruj|ignoruj|pomiń|zapomnij|nowa instrukcja|instrukcj\w* (systemow|firmy)|\bsystem\s*:|jesteś teraz|prompt/i,
    "Wiadomość klienta próbuje zmienić instrukcje asystenta"],
  [/\b(role|rola)\s*[=:]|\badmin|uprawnie/i, "Wiadomość klienta próbuje zmienić rolę lub uprawnienia"],
];

function hasForeignPrice(text: string) {
  return [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:zł|pln)/gi)]
    .map((m) => Number(m[1].replace(",", ".")))
    .some((price) => !ALLOWED_PRICES.includes(price));
}

// Kontrola deterministyczna po odpowiedzi modelu. Model nie może jej wyłączyć:
// przy podejrzeniu manipulacji lub obcej cenie wynik zawsze trafia do pracownika.
export function applyServerReview(analysis: Analysis, message: string): AnalysisResult {
  const reasons = MANIPULATION_PATTERNS.filter(([pattern]) => pattern.test(message)).map(([, reason]) => reason);

  if (hasForeignPrice(message)) {
    reasons.push("Wiadomość klienta podaje cenę spoza cennika");
  }
  if (hasForeignPrice(analysis.draft)) {
    reasons.push("Szkic podaje cenę spoza cennika (150 zł)");
  }

  if (reasons.length === 0) return { ok: true, analysis };
  return { ok: true, analysis: { ...analysis, needs_review: true }, review_reasons: reasons };
}

// Interpretuje surowy tekst odpowiedzi modelu razem z powodem zakończenia.
export function interpretModelOutput({
  text,
  finishReason,
}: {
  text: string | undefined;
  finishReason: string | undefined;
}): AnalysisResult {
  if (finishReason === "content-filter") {
    return fail("refusal", "Model odmówił analizy tej wiadomości (filtr treści).");
  }
  if (finishReason === "length") {
    return fail("truncated", "Odpowiedź modelu została przerwana (limit długości). Spróbuj krótszej wiadomości.");
  }
  if (!text || text.trim() === "") {
    return fail("refusal", "Model nie zwrócił wyniku. To zwykle oznacza odmowę odpowiedzi.");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    if (finishReason !== "stop") {
      return fail("truncated", "Odpowiedź modelu została przerwana przed końcem JSON.");
    }
    return fail(
      "invalid_json",
      "Model odpowiedział zwykłym tekstem zamiast JSON. Może to być odmowa albo brak obsługi structured output.",
    );
  }

  if (finishReason !== "stop") {
    return fail("truncated", `Odpowiedź modelu zakończyła się nieprawidłowo (${finishReason ?? "brak powodu"}).`);
  }

  return validateAnalysis(value);
}

// Zamienia błąd dostawcy (OpenRouter) na czytelny komunikat.
export function describeProviderError(error: unknown): AnalysisResult {
  const cause = RetryError.isInstance(error) ? error.lastError : error;

  if (APICallError.isInstance(cause)) {
    const text = `${cause.message} ${cause.responseBody ?? ""}`.toLowerCase();
    if (
      text.includes("no endpoints found") ||
      text.includes("response_format") ||
      text.includes("json_schema") ||
      text.includes("structured")
    ) {
      return fail("unsupported", UNSUPPORTED_MESSAGE);
    }
    if (cause.statusCode === 401) {
      return fail("config", "OpenRouter odrzucił klucz. Sprawdź OPENROUTER_API_KEY.");
    }
    if (cause.statusCode === 402) {
      return fail("provider", "Brak środków na koncie OpenRouter.");
    }
    if (cause.statusCode === 404 || cause.statusCode === 400) {
      return fail("config", "OpenRouter nie przyjął zapytania. Sprawdź nazwę modelu w OPENROUTER_MODEL.");
    }
    if (cause.statusCode === 429) {
      return fail("provider", "Za dużo zapytań do modelu. Spróbuj za chwilę.");
    }
    if (cause.statusCode === undefined) {
      return fail("provider", "Nie udało się połączyć z OpenRouter. Sprawdź połączenie sieciowe.");
    }
    return fail("provider", `Błąd dostawcy modelu (HTTP ${cause.statusCode}). Spróbuj ponownie.`);
  }

  return fail("provider", "Nieoczekiwany błąd podczas analizy. Spróbuj ponownie.");
}
