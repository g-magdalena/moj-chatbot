import { cookies } from "next/headers";
import { SESSION_COOKIE, isAuthConfigured, isValidSession } from "@/lib/auth";
import Chat from "./Chat";
import LoginForm from "./LoginForm";

// Strona sprawdza sesję na serwerze przy każdym wejściu.
export default async function Home() {
  if (!isAuthConfigured()) {
    return (
      <main className="chat login">
        <h1>Mój chatbot</h1>
        <p className="error" role="alert">
          Dostęp zablokowany: na serwerze brakuje CHAT_PASSWORD lub SESSION_SECRET.
          Uzupełnij je w .env.local i uruchom serwer ponownie.
        </p>
      </main>
    );
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token) ? <Chat /> : <LoginForm />;
}
