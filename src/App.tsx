import { useCallback, useEffect, useState } from "react";
import {
  CalendarCog,
  ChefHat,
  ClipboardList,
  Heart,
  Home,
  LogIn,
  LogOut,
  RefreshCw,
  WifiOff
} from "lucide-react";
import {
  addItem,
  addPayment,
  ApiError,
  closeTab,
  getBootstrap,
  getSession,
  getTab,
  logout,
  removeItem,
  updateEvent,
  updateKitchenItem
} from "./lib/api";
import type {
  BootstrapData,
  PaymentMethod,
  PreparationStatus,
  TabDetail
} from "./types";
import { formatDate } from "./lib/format";
import { LoginScreen } from "./components/LoginScreen";
import { Dashboard } from "./components/Dashboard";
import { CheckIn } from "./components/CheckIn";
import { TabsList } from "./components/TabsList";
import { Kitchen } from "./components/Kitchen";
import { TabDrawer } from "./components/TabDrawer";
import { EventSettings } from "./components/EventSettings";

type Page = "home" | "checkin" | "tabs" | "kitchen";

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [data, setData] = useState<BootstrapData | null>(null);
  const [page, setPage] = useState<Page>("home");
  const [selectedTab, setSelectedTab] = useState<TabDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  const loadData = useCallback(async () => {
    setError("");
    try {
      const bootstrap = await getBootstrap();
      setData(bootstrap);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setAuthenticated(false);
        return;
      }
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar o evento.");
    }
  }, []);

  useEffect(() => {
    getSession().then((isAuthenticated) => {
      setAuthenticated(isAuthenticated);
      if (isAuthenticated) loadData();
    });
  }, [loadData]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  async function openTab(tabId: string) {
    setBusy(true);
    try {
      setSelectedTab(await getTab(tabId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível abrir a comanda.");
    } finally {
      setBusy(false);
    }
  }

  async function mutateTab(action: () => Promise<TabDetail>, successMessage?: string) {
    setBusy(true);
    setError("");
    try {
      const updated = await action();
      setSelectedTab(updated);
      await loadData();
      if (successMessage) notify(successMessage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível concluir a operação.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await logout();
    setAuthenticated(false);
    setData(null);
  }

  if (authenticated === null) {
    return (
      <main className="loading-screen">
        <div className="brand-mark brand-mark--large"><Heart fill="currentColor" /></div>
        <p>Carregando o Mesão...</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <LoginScreen
        onSuccess={() => {
          setAuthenticated(true);
          loadData();
        }}
      />
    );
  }

  if (!data) {
    return (
      <main className="loading-screen">
        <div className="brand-mark brand-mark--large"><Heart fill="currentColor" /></div>
        <p>{error || "Preparando o evento..."}</p>
        <button className="button" onClick={loadData}>
          <RefreshCw size={18} /> Tentar novamente
        </button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark">
          <Heart aria-hidden="true" fill="currentColor" />
        </div>
        <div className="app-header__title">
          <span>{data.event.name}</span>
          <strong>{formatDate(data.event.eventDate)}</strong>
        </div>
        <button
          className="icon-button"
          aria-label="Configurar evento"
          onClick={() => setSettingsOpen(true)}
        >
          <CalendarCog aria-hidden="true" />
        </button>
        <button className="icon-button" aria-label="Sair" onClick={handleLogout}>
          <LogOut aria-hidden="true" />
        </button>
      </header>

      {!online && (
        <div className="offline-banner">
          <WifiOff size={16} aria-hidden="true" />
          Sem internet. Os últimos dados continuam disponíveis apenas para consulta.
        </div>
      )}

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError("")}>Fechar</button>
        </div>
      )}

      <main className="app-main">
        {page === "home" && <Dashboard data={data} onNavigate={setPage} />}
        {page === "checkin" && (
          <CheckIn
            notify={notify}
            onChanged={loadData}
            onOpenTab={(tab) => setSelectedTab(tab)}
          />
        )}
        {page === "tabs" && <TabsList tabs={data.tabs} onSelect={openTab} />}
        {page === "kitchen" && (
          <Kitchen
            items={data.kitchen}
            onUpdate={async (itemId, status) => {
              setBusy(true);
              try {
                await updateKitchenItem(itemId, status);
                await loadData();
                notify("Status do pedido atualizado.");
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o pedido.");
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </main>

      <nav className="bottom-nav" aria-label="Navegação principal">
        <button className={page === "home" ? "active" : ""} onClick={() => setPage("home")}>
          <Home aria-hidden="true" />
          <span>Início</span>
        </button>
        <button className={page === "checkin" ? "active" : ""} onClick={() => setPage("checkin")}>
          <LogIn aria-hidden="true" />
          <span>Check-in</span>
        </button>
        <button className={page === "tabs" ? "active" : ""} onClick={() => setPage("tabs")}>
          <ClipboardList aria-hidden="true" />
          <span>Comandas</span>
        </button>
        <button className={page === "kitchen" ? "active" : ""} onClick={() => setPage("kitchen")}>
          <ChefHat aria-hidden="true" />
          <span>Preparo</span>
        </button>
      </nav>

      {selectedTab && (
        <TabDrawer
          tab={selectedTab}
          products={data.products}
          busy={busy}
          onClose={() => setSelectedTab(null)}
          onAddItem={(productId) =>
            mutateTab(() => addItem(selectedTab.id, productId), "Item adicionado.")
          }
          onRemoveItem={(itemId) =>
            mutateTab(() => removeItem(selectedTab.id, itemId), "Item removido.")
          }
          onPayment={(amountCents: number, method: PaymentMethod) =>
            mutateTab(
              () => addPayment(selectedTab.id, amountCents, method),
              "Pagamento registrado."
            )
          }
          onCardOrderCompleted={(updated) => {
            setSelectedTab(updated);
            loadData();
            notify("Cartas adicionadas à comanda.");
          }}
          onCloseTab={() =>
            mutateTab(async () => {
              const updated = await closeTab(selectedTab.id);
              window.setTimeout(() => setSelectedTab(null), 350);
              return updated;
            }, "Comanda fechada.")
          }
        />
      )}

      {settingsOpen && (
        <EventSettings
          event={data.event}
          onClose={() => setSettingsOpen(false)}
          onSave={async (input) => {
            try {
              await updateEvent(data.event.id, input);
              await loadData();
              notify("Evento atualizado.");
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o evento.");
              throw caught;
            }
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
