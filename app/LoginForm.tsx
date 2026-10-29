"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || isBusy) return;
    setIsBusy(true);
    setError("");

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Nie udało się zalogować.");
    } catch {
      setError("Brak połączenia z serwerem.");
    } finally {
      setIsBusy(false);
      setPassword("");
    }
  }

  return (
    <main className="chat login">
      <h1>Mój chatbot</h1>
      <form className="composer" onSubmit={handleSubmit}>
        <input
          type="password"
          placeholder="Wpisz hasło"
          aria-label="Wpisz hasło"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={!password || isBusy}>
          {isBusy ? "Sprawdzam…" : "Wejdź"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
