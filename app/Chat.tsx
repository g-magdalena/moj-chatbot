"use client";

import { useChat } from "@ai-sdk/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Chat() {
  const { messages, sendMessage, status, error } = useChat();
  const [input, setInput] = useState("");
  const router = useRouter();

  const isBusy = status === "submitted" || status === "streaming";
  const isEmpty = input.trim() === "";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEmpty || isBusy) return;
    sendMessage({ text: input.trim() });
    setInput("");
  }

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.refresh();
  }

  return (
    <main className="chat">
      <header className="top">
        <h1>Mój chatbot</h1>
        <button type="button" className="secondary" onClick={handleLogout}>
          Wyjdź
        </button>
      </header>

      <section className="messages" aria-label="Rozmowa">
        {messages.map((message) => (
          <div key={message.id} className={`message ${message.role}`}>
            <strong>{message.role === "user" ? "Ty" : "Chatbot"}</strong>
            {message.parts.map((part, i) =>
              part.type === "text" ? (
                <p key={`${message.id}-${i}`}>{part.text}</p>
              ) : null,
            )}
          </div>
        ))}

        {status === "submitted" && <p className="status">Chatbot myśli…</p>}

        {error && (
          <p className="error" role="alert">
            {error.message || "Coś poszło nie tak. Spróbuj ponownie."}
          </p>
        )}
      </section>

      <form className="composer" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Napisz wiadomość..."
          aria-label="Wiadomość"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={isEmpty || isBusy}>
          {isBusy ? "Czekaj…" : "Wyślij"}
        </button>
      </form>
    </main>
  );
}
