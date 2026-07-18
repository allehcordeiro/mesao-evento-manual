import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import type { EventInfo } from "../types";

interface EventSettingsProps {
  event: EventInfo;
  onClose: () => void;
  onSave: (input: {
    name: string;
    eventDate: string;
    startsAt: string;
    endsAt: string;
  }) => Promise<void>;
}

export function EventSettings({ event, onClose, onSave }: EventSettingsProps) {
  const [name, setName] = useState(event.name);
  const [eventDate, setEventDate] = useState(event.eventDate);
  const [startsAt, setStartsAt] = useState(event.startsAt ?? "");
  const [endsAt, setEndsAt] = useState(event.endsAt ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault();
    setSaving(true);
    try {
      await onSave({ name, eventDate, startsAt, endsAt });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Configurar evento"
        onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">Configuração rápida</span>
            <h2>Evento ativo</h2>
          </div>
          <button className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>

        <form className="stack" onSubmit={handleSubmit}>
          <label className="field">
            <span>Nome do evento</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Data</span>
            <div className="input-with-icon">
              <CalendarDays size={18} aria-hidden="true" />
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                required
              />
            </div>
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Início</span>
              <input
                type="time"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Fim</span>
              <input
                type="time"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </label>
          </div>
          <button className="button button--primary button--full" disabled={saving}>
            {saving ? "Salvando..." : "Salvar evento"}
          </button>
        </form>
      </section>
    </div>
  );
}
