import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";

export async function POST(req: Request) {
  // Najpierw sesja. Bez niej kończymy tutaj i model nie jest wywoływany.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isValidSession(token)) {
    return new Response("Sesja wygasła lub nie jesteś zalogowany. Odśwież stronę i wpisz hasło.", {
      status: 401,
    });
  }

  // Klucz jest czytany tylko tutaj, na serwerze. Nigdy nie trafia do przeglądarki.
  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelId = process.env.OPENROUTER_MODEL;

  if (!apiKey || !modelId) {
    return new Response(
      "Brak konfiguracji: uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local, a potem uruchom serwer ponownie.",
      { status: 500 },
    );
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const openrouter = createOpenRouter({ apiKey });

  // Cała dotychczasowa rozmowa idzie do modelu, więc zna poprzednie wiadomości.
  const result = streamText({
    model: openrouter(modelId),
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (error) => {
        console.error(error);
        return "Model nie odpowiedział. Sprawdź klucz, nazwę modelu i środki na koncie OpenRouter.";
      },
    }),
  });
}
