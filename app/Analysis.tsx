"use client";

import { useState } from "react";
import type { Analysis as AnalysisData } from "@/lib/analysis";

const CATEGORY_LABELS: Record<AnalysisData["category"], string> = {
  sales: "Sprzedaż (sales)",
  support: "Wsparcie techniczne (support)",
  billing: "Płatności i zwroty (billing)",
  unknown: "Nierozpoznana sprawa (unknown)",
};

const PRIORITY_LABELS: Record<AnalysisData["priority"], string> = {
  normal: "Normalny (normal)",
  high: "Wysoki (high)",
};

type Failure = { message: string; details?: string[] };

export default function Analysis() {
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [result, setResult] = useState<AnalysisData | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const isEmpty = message.trim() === "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEmpty || isBusy) return;
    setIsBusy(true);
    setResult(null);
    setFailure(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok === true) {
        setResult(data.analysis);
      } else if (data && typeof data.message === "string") {
        setFailure({ message: data.message, details: data.details });
      } else {
        // Np. przekroczony czas na hostingu: serwer nie zdążył oddać JSON.
        setFailure({ message: `Odpowiedź serwera została przerwana (HTTP ${res.status}). Spróbuj ponownie.` });
      }
    } catch {
      setFailure({ message: "Brak połączenia z serwerem." });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="analysis" aria-label="Analiza wiadomości">
      <form className="analysis-form" onSubmit={handleSubmit}>
        <label htmlFor="client-message">Wiadomość klienta Studio Nova</label>
        <textarea
          id="client-message"
          rows={5}
          placeholder="Wklej treść wiadomości od klienta…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button type="submit" disabled={isEmpty || isBusy}>
          {isBusy ? "Analizuję…" : "Analizuj"}
        </button>
      </form>

      {isBusy && <p className="status">Model analizuje wiadomość…</p>}

      {failure && (
        <div className="error" role="alert">
          <p>{failure.message}</p>
          {failure.details && (
            <ul>
              {failure.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && (
        <div className="result">
          <dl>
            <dt>Kategoria</dt>
            <dd>{CATEGORY_LABELS[result.category]}</dd>
            <dt>Priorytet</dt>
            <dd className={result.priority === "high" ? "high" : undefined}>{PRIORITY_LABELS[result.priority]}</dd>
            <dt>Status sprawdzenia</dt>
            <dd className={result.needs_review ? "review" : undefined}>
              {result.needs_review
                ? "Wymaga sprawdzenia i decyzji pracownika"
                : "Bez uwag modelu, ale nadal przejrzyj szkic przed wysłaniem"}
            </dd>
          </dl>
          <h2>Szkic odpowiedzi</h2>
          <p className="draft">{result.draft}</p>
          <p className="note">To tylko szkic. Aplikacja niczego nie wysyła ani nie rezerwuje.</p>
        </div>
      )}
    </section>
  );
}
