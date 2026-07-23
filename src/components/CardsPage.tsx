import { useMemo, useState } from "react";
import { Camera, Check, ClipboardList, Search } from "lucide-react";
import type { TabDetail, TabSummary } from "../types";
import { CardOrderFlow } from "./CardOrderFlow";
import { formatMoney } from "../lib/format";

interface CardsPageProps {
  tabs: TabSummary[];
  busy: boolean;
  onCompleted: (tab: TabDetail) => void;
  onOpenTab: (tabId: string) => void;
}

export function CardsPage({ tabs, busy, onCompleted, onOpenTab }: CardsPageProps) {
  const [query, setQuery] = useState("");
  const [selectedTabId, setSelectedTabId] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastCompleted, setLastCompleted] = useState<TabDetail | null>(null);

  const openTabs = useMemo(
    () => tabs.filter((tab) => tab.status === "open"),
    [tabs]
  );

  const filteredTabs = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return openTabs;
    return openTabs.filter((tab) =>
      tab.personName.toLocaleLowerCase("pt-BR").includes(normalized) ||
      tab.number.toLocaleLowerCase("pt-BR").includes(normalized)
    );
  }, [openTabs, query]);

  const selectedTab = openTabs.find((tab) => tab.id === selectedTabId) ?? null;

  if (scannerOpen && selectedTab) {
    return (
      <div className="cards-page cards-page--scanner">
        <CardOrderFlow
          key={selectedTab.id}
          standalone
          tabId={selectedTab.id}
          tabLabel={`${selectedTab.number} · ${selectedTab.personName}`}
          busy={busy}
          onCancel={() => setScannerOpen(false)}
          onCompleted={(updated) => {
            setLastCompleted(updated);
            setScannerOpen(false);
            onCompleted(updated);
          }}
        />
      </div>
    );
  }

  return (
    <div className="page-content cards-page">
      <section className="cards-page-hero">
        <div>
          <span className="eyebrow">Balcão</span>
          <h2>Venda de cartas avulsas</h2>
          <p>Escolha a comanda uma vez e entre no modo scanner contínuo.</p>
        </div>
        <Camera aria-hidden="true" />
      </section>

      {lastCompleted && (
        <section className="card-sale-success">
          <Check size={22} />
          <div>
            <strong>Lote adicionado à comanda {lastCompleted.number}</strong>
            <span>{lastCompleted.personName} · saldo {formatMoney(lastCompleted.balanceCents)}</span>
          </div>
          <button type="button" className="text-button" onClick={() => onOpenTab(lastCompleted.id)}>
            Ver comanda
          </button>
        </section>
      )}

      <section className="panel card-tab-selector">
        <div className="section-heading section-heading--compact">
          <div>
            <span className="eyebrow">1. Comanda</span>
            <h3>Para quem são as cartas?</h3>
          </div>
          <span className="open-tab-count">{openTabs.length} abertas</span>
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

        <div className="card-tab-list">
          {filteredTabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={`card-tab-choice ${selectedTabId === tab.id ? "selected" : ""}`}
              onClick={() => setSelectedTabId(tab.id)}
            >
              <span className="tab-number">{tab.number}</span>
              <div>
                <strong>{tab.personName}</strong>
                <small>{tab.itemCount} itens · saldo {formatMoney(tab.balanceCents)}</small>
              </div>
              {selectedTabId === tab.id ? <Check size={20} /> : <ClipboardList size={20} />}
            </button>
          ))}

          {filteredTabs.length === 0 && (
            <div className="empty-card">
              <ClipboardList aria-hidden="true" />
              <p>Nenhuma comanda aberta encontrada.</p>
            </div>
          )}
        </div>

        <button
          type="button"
          className="button button--primary button--full"
          disabled={!selectedTab}
          onClick={() => setScannerOpen(true)}
        >
          <Camera size={18} /> Continuar com {selectedTab?.personName ?? "a comanda"}
        </button>
      </section>
    </div>
  );
}
