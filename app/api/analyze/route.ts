import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { NoObjectGeneratedError, Output, generateText, jsonSchema } from "ai";
import { cookies } from "next/headers";
import {
  ANALYSIS_JSON_SCHEMA,
  type AnalysisResult,
  describeProviderError,
  interpretModelOutput,
} from "@/lib/analysis";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { buildAnalysisInput, buildAnalysisPrompt } from "@/lib/studio-nova";

const MAX_MESSAGE_LENGTH = 4000;

const STATUS: Record<string, number> = {
  refusal: 422,
  truncated: 502,
  invalid_json: 502,
  invalid_schema: 502,
  unsupported: 503,
  config: 503,
  provider: 502,
};

function respond(result: AnalysisResult) {
  return Response.json(result, { status: result.ok ? 200 : (STATUS[result.code] ?? 500) });
}

export async function POST(req: Request) {
  // Najpierw sesja. Bez niej kończymy tutaj i model nie jest wywoływany.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isValidSession(token)) {
    return Response.json(
      { ok: false, code: "session", message: "Sesja wygasła lub nie jesteś zalogowany. Odśwież stronę i wpisz hasło." },
      { status: 401 },
    );
  }

  // Klucz jest czytany tylko tutaj, na serwerze. Nigdy nie trafia do przeglądarki.
  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelId = process.env.OPENROUTER_MODEL;
  if (!apiKey || !modelId) {
    return respond({
      ok: false,
      code: "config",
      message: "Brak konfiguracji: uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL, a potem uruchom serwer ponownie.",
    });
  }

  let message = "";
  try {
    const body = await req.json();
    if (typeof body?.message === "string") message = body.message.trim();
  } catch {
    // Zły format zapytania obsługujemy jak pustą wiadomość.
  }
  if (!message) {
    return Response.json({ ok: false, code: "input", message: "Wklej treść wiadomości do analizy." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return Response.json(
      { ok: false, code: "input", message: `Wiadomość jest za długa (maks. ${MAX_MESSAGE_LENGTH} znaków).` },
      { status: 400 },
    );
  }

  const now = new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  }).format(new Date());

  const openrouter = createOpenRouter({ apiKey });

  try {
    const result = await generateText({
      // require_parameters: OpenRouter wybierze tylko dostawcę obsługującego schemat JSON.
      // Jeśli żaden go nie obsługuje, dostaniemy błąd zamiast zwykłego tekstu.
      model: openrouter(modelId, { provider: { require_parameters: true } }),
      system: buildAnalysisPrompt(now),
      prompt: buildAnalysisInput(message),
      // Schemat trafia do modelu jako structured output. AI SDK sprawdza tylko,
      // czy to JSON. Pełną walidację robi interpretModelOutput poniżej.
      output: Output.object({ schema: jsonSchema(ANALYSIS_JSON_SCHEMA), name: "studio_nova_analysis" }),
    });

    return respond(interpretModelOutput({ text: result.text, finishReason: result.finishReason }));
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      // Model coś zwrócił, ale to nie jest JSON. Ustalamy dlaczego.
      return respond(interpretModelOutput({ text: error.text, finishReason: error.finishReason }));
    }
    console.error(error);
    return respond(describeProviderError(error));
  }
}
