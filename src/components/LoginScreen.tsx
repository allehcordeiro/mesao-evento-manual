import { useState } from "react";
import { Heart, KeyRound } from "lucide-react";
import { login } from "../lib/api";

interface LoginScreenProps {
  onSuccess: () => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await login(pin);
      onSuccess();
    } catch {
      setError("PIN incorreto. Confira e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark brand-mark--large">
          <Heart aria-hidden="true" fill="currentColor" />
        </div>
        <span className="eyebrow">Mesão do Amor</span>
        <h1>Evento</h1>
        <p className="muted">
          Entre com o PIN da equipe para abrir as comandas do dia.
        </p>

        <form onSubmit={handleSubmit} className="stack">
          <label className="field">
            <span>PIN da equipe</span>
            <div className="input-with-icon">
              <KeyRound size={18} aria-hidden="true" />
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={12}
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder="Digite o PIN"
                required
              />
            </div>
          </label>

          {error && <p className="form-error">{error}</p>}

          <button className="button button--primary button--full" disabled={submitting}>
            {submitting ? "Entrando..." : "Entrar no evento"}
          </button>
        </form>

        <p className="login-hint">No ambiente local, o PIN inicial é 1234.</p>
      </section>
    </main>
  );
}
