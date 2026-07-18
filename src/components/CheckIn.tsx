import { useEffect, useState } from "react";
import { Search, UserPlus, UsersRound } from "lucide-react";
import { checkIn, searchPeople } from "../lib/api";
import type { Person, TabDetail } from "../types";
import { formatTime } from "../lib/format";

interface CheckInProps {
  onOpenTab: (tab: TabDetail) => void;
  onChanged: () => void;
  notify: (message: string) => void;
}

export function CheckIn({ onOpenTab, onChanged, notify }: CheckInProps) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (query.trim().length < 2) {
        setPeople([]);
        return;
      }

      setSearching(true);
      try {
        setPeople(await searchPeople(query.trim()));
      } catch {
        setPeople([]);
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query]);

  async function handleExisting(personId: string) {
    setSubmitting(true);
    try {
      const tab = await checkIn({ personId });
      notify("Check-in realizado e comanda aberta.");
      onChanged();
      onOpenTab(tab);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível fazer o check-in.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNew(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const tab = await checkIn({ name: name.trim(), phone: phone.trim() || undefined });
      setName("");
      setPhone("");
      notify("Pessoa cadastrada e check-in realizado.");
      onChanged();
      onOpenTab(tab);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível cadastrar a pessoa.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-content">
      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Chegada</span>
            <h2>Fazer check-in</h2>
            <p>Pesquise primeiro para evitar cadastros duplicados.</p>
          </div>
        </div>

        <label className="field">
          <span>Nome ou telefone</span>
          <div className="input-with-icon">
            <Search size={18} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ex.: Alexandre ou 11999999999"
            />
          </div>
        </label>

        <div className="result-list">
          {searching && <div className="empty-card">Buscando pessoas...</div>}
          {!searching && query.length >= 2 && people.length === 0 && (
            <div className="empty-card">
              <UsersRound aria-hidden="true" />
              <p>Nenhuma pessoa encontrada.</p>
              <small>Use o cadastro rápido logo abaixo.</small>
            </div>
          )}
          {people.map((person) => (
            <article className="person-card" key={person.id}>
              <div className="avatar">{person.name.slice(0, 1).toUpperCase()}</div>
              <div className="person-card__content">
                <strong>{person.name}</strong>
                <span>{person.phone || "Telefone não informado"}</span>
                {person.lastAttendanceAt && (
                  <small>Última chegada: {formatTime(person.lastAttendanceAt)}</small>
                )}
              </div>
              <button
                className="button button--compact"
                disabled={submitting}
                onClick={() => handleExisting(person.id)}
              >
                Entrar
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <UserPlus aria-hidden="true" />
          <div>
            <h3>Cadastro rápido</h3>
            <p>Somente o nome é obrigatório.</p>
          </div>
        </div>

        <form className="stack" onSubmit={handleNew}>
          <label className="field">
            <span>Nome</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome da pessoa"
              required
            />
          </label>
          <label className="field">
            <span>WhatsApp ou telefone</span>
            <input
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Opcional"
            />
          </label>
          <button
            className="button button--primary button--full"
            disabled={submitting || !name.trim()}
          >
            {submitting ? "Criando..." : "Cadastrar e abrir comanda"}
          </button>
        </form>
      </section>
    </div>
  );
}
