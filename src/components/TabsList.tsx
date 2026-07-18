import { Search, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import type { TabSummary } from "../types";
import { formatMoney, formatTime } from "../lib/format";

interface TabsListProps {
  tabs: TabSummary[];
  onSelect: (tabId: string) => void;
}

export function TabsList({ tabs, onSelect }: TabsListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return tabs;

    return tabs.filter(
      (tab) =>
        tab.personName.toLocaleLowerCase("pt-BR").includes(normalized) ||
        tab.number.includes(normalized)
    );
  }, [query, tabs]);

  return (
    <div className="page-content">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Consumo</span>
          <h2>Comandas abertas</h2>
          <p>{tabs.length} comandas aguardando fechamento.</p>
        </div>
      </div>

      <label className="field">
        <span>Pesquisar comanda</span>
        <div className="input-with-icon">
          <Search size={18} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome ou número"
          />
        </div>
      </label>

      <div className="tab-list">
        {filtered.map((tab) => (
          <button className="tab-card" key={tab.id} onClick={() => onSelect(tab.id)}>
            <div className="tab-number">{tab.number}</div>
            <div className="tab-card__content">
              <strong>{tab.personName}</strong>
              <span>
                {tab.itemCount} {tab.itemCount === 1 ? "item" : "itens"} · aberta às{" "}
                {formatTime(tab.openedAt)}
              </span>
              <small>
                Pago {formatMoney(tab.paidCents)} de {formatMoney(tab.totalCents)}
              </small>
            </div>
            <div className="tab-balance">
              <span>Saldo</span>
              <strong>{formatMoney(tab.balanceCents)}</strong>
            </div>
          </button>
        ))}

        {filtered.length === 0 && (
          <div className="empty-card">
            <WalletCards aria-hidden="true" />
            <p>Nenhuma comanda encontrada.</p>
          </div>
        )}
      </div>
    </div>
  );
}
