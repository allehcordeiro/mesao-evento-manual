import {
  Camera,
  ChefHat,
  ClipboardList,
  LogIn,
  UsersRound
} from "lucide-react";
import type { BootstrapData } from "../types";

interface DashboardProps {
  data: BootstrapData;
  onNavigate: (page: "checkin" | "cards" | "tabs" | "kitchen") => void;
}

export function Dashboard({ data, onNavigate }: DashboardProps) {
  const { stats } = data;

  return (
    <div className="page-content">
      <section className="hero-card">
        <div>
          <span className="eyebrow">Evento em andamento</span>
          <h2>O balcão acontece aqui.</h2>
          <p>Acesse rapidamente check-in, cartas, comandas e preparo.</p>
        </div>
        <div className="heart-orbit" aria-hidden="true">♥</div>
      </section>

      <section className="stats-grid stats-grid--operational" aria-label="Resumo operacional do evento">
        <article className="stat-card">
          <UsersRound aria-hidden="true" />
          <strong>{stats.presentCount}</strong>
          <span>Pessoas presentes</span>
        </article>
        <article className="stat-card">
          <ClipboardList aria-hidden="true" />
          <strong>{stats.openTabsCount}</strong>
          <span>Comandas abertas</span>
        </article>
        <article className="stat-card stat-card--operational">
          <ChefHat aria-hidden="true" />
          <strong>{stats.kitchenPendingCount}</strong>
          <span>Pedidos em preparo</span>
          <button className="text-button" onClick={() => onNavigate("kitchen")}>Abrir fila</button>
        </article>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Ações rápidas</span>
            <h3>O que você precisa fazer?</h3>
          </div>
        </div>

        <div className="action-grid action-grid--four">
          <button className="action-card action-card--primary" onClick={() => onNavigate("cards")}>
            <Camera aria-hidden="true" />
            <span>
              <strong>Ler cartas</strong>
              <small>Iniciar uma venda no scanner contínuo</small>
            </span>
          </button>
          <button className="action-card" onClick={() => onNavigate("checkin")}>
            <LogIn aria-hidden="true" />
            <span>
              <strong>Fazer check-in</strong>
              <small>Encontrar ou cadastrar uma pessoa</small>
            </span>
          </button>
          <button className="action-card" onClick={() => onNavigate("tabs")}>
            <ClipboardList aria-hidden="true" />
            <span>
              <strong>Ver comandas</strong>
              <small>Adicionar itens e receber pagamentos</small>
            </span>
          </button>
          <button className="action-card" onClick={() => onNavigate("kitchen")}>
            <ChefHat aria-hidden="true" />
            <span>
              <strong>Fila de preparo</strong>
              <small>Acompanhar pedidos de comida</small>
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}
