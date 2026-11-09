// Testy walidacji analizy na danych lokalnych. Nie wywołują modelu.
// Uruchom: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { APICallError, RetryError } from "ai";
import { describeProviderError, interpretModelOutput, validateAnalysis } from "./analysis.ts";

const valid = {
  category: "billing",
  priority: "normal",
  draft: "Dziękujemy za wiadomość. Sprawdzimy zwrot i wrócimy z odpowiedzią.",
  needs_review: true,
};

const json = (value: unknown) => JSON.stringify(value);

function apiError(statusCode: number | undefined, message: string, responseBody?: string) {
  return new APICallError({
    message,
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody,
  });
}

test("poprawny wynik przechodzi walidację", () => {
  const result = interpretModelOutput({ text: json(valid), finishReason: "stop" });
  assert.deepEqual(result, { ok: true, analysis: valid });
});

test("brak pola", () => {
  const { needs_review: _, ...missing } = valid;
  const result = validateAnalysis(missing);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.code === "invalid_schema");
  assert.ok(!result.ok && result.details?.includes("Brak pola: needs_review"));
});

test("zły typ", () => {
  const result = validateAnalysis({ ...valid, needs_review: "tak" });
  assert.ok(!result.ok && result.details?.some((d) => d.startsWith("Zły typ pola needs_review")));
});

test("niedozwolona kategoria", () => {
  const result = validateAnalysis({ ...valid, category: "marketing" });
  assert.ok(!result.ok && result.details?.includes("Niedozwolona wartość pola category"));
});

test("niedozwolony priorytet", () => {
  const result = validateAnalysis({ ...valid, priority: "urgent" });
  assert.ok(!result.ok && result.details?.includes("Niedozwolona wartość pola priority"));
});

test("dodatkowe pole", () => {
  const result = validateAnalysis({ ...valid, send_email: true });
  assert.ok(!result.ok && result.details?.includes("Dodatkowe pole: send_email"));
});

test("pusty szkic", () => {
  const result = validateAnalysis({ ...valid, draft: "   " });
  assert.ok(!result.ok && result.details?.includes("Pusty szkic: draft"));
});

test("tablica zamiast obiektu", () => {
  const result = validateAnalysis([valid]);
  assert.ok(!result.ok && result.code === "invalid_schema");
});

test("odmowa modelu: pusta odpowiedź", () => {
  const result = interpretModelOutput({ text: "", finishReason: "stop" });
  assert.ok(!result.ok && result.code === "refusal");
});

test("odmowa modelu: filtr treści", () => {
  const result = interpretModelOutput({ text: json(valid), finishReason: "content-filter" });
  assert.ok(!result.ok && result.code === "refusal");
});

test("odmowa modelu: zwykły tekst zamiast JSON", () => {
  const result = interpretModelOutput({ text: "Przykro mi, nie mogę pomóc.", finishReason: "stop" });
  assert.ok(!result.ok && result.code === "invalid_json");
});

test("przerwana odpowiedź: limit długości", () => {
  const result = interpretModelOutput({ text: '{"category":"sales","dra', finishReason: "length" });
  assert.ok(!result.ok && result.code === "truncated");
});

test("przerwana odpowiedź: urwany JSON bez powodu stop", () => {
  const result = interpretModelOutput({ text: '{"category":"sales"', finishReason: "other" });
  assert.ok(!result.ok && result.code === "truncated");
});

test("przerwana odpowiedź: poprawny JSON, ale zakończenie inne niż stop", () => {
  const result = interpretModelOutput({ text: json(valid), finishReason: "error" });
  assert.ok(!result.ok && result.code === "truncated");
});

test("błąd dostawcy: model bez structured output", () => {
  const result = describeProviderError(
    apiError(404, "No endpoints found that can handle the requested parameters."),
  );
  assert.ok(!result.ok && result.code === "unsupported");
  assert.ok(!result.ok && result.message.includes("OPENROUTER_MODEL"));
});

test("błąd dostawcy: zły klucz", () => {
  const result = describeProviderError(apiError(401, "User not found."));
  assert.ok(!result.ok && result.code === "config");
});

test("błąd dostawcy: brak środków", () => {
  const result = describeProviderError(apiError(402, "Insufficient credits"));
  assert.ok(!result.ok && result.code === "provider" && result.message.includes("środków"));
});

test("błąd dostawcy: brak połączenia po ponownych próbach", () => {
  const lastError = apiError(undefined, "Cannot connect to API");
  const error = new RetryError({ message: "Failed after 3 attempts", reason: "maxRetriesExceeded", errors: [lastError] });
  const result = describeProviderError(error);
  assert.ok(!result.ok && result.code === "provider" && result.message.includes("połączyć"));
});

test("błąd dostawcy: nieznany błąd nie udaje wyniku", () => {
  const result = describeProviderError(new Error("boom"));
  assert.equal(result.ok, false);
});
