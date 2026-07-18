import {
  ChefHat,
  CircleDollarSign,
  ClipboardList,
  LogIn,
  UsersRound
} from "lucide-react";
import type { BootstrapData } from "../types";
import { formatMoney } from "../lib/format";

interface DashboardProps {
  data: BootstrapData;
  onNavigate: (page: "checkin" | "tabs" | "kitchen") => void;
}

export function Dashboard({ data, onNavigate }: DashboardProps) {
  const { stats } = data;

  return (
    <div className="page-content">
      <section className="hero-card">
        <div>
          <span className="eyebrow">Evento em andamento</span>
          <h2>O encontro acontece aqui.</h2>
          <p>Check-in, consumo e pagamentos em uma jornada rápida.</p>
        </div>
        <div className="heart-orbit" aria-hidden="true">♥</div>
      </section>

      <section className="stats-grid" aria-label="Resumo do evento">
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
        <article className="stat-card stat-card--wide">
          <CircleDollarSign aria-hidden="true" />
          <div>
            <strong>{formatMoney(stats.salesCents)}</strong>
            <span>Consumo registrado</span>
          </div>
          <small>{formatMoney(stats.paymentsCents)} recebidos</small>
        </article>
        <article className="stat-card stat-card--wide">
          <ChefHat aria-hidden="true" />
          <div>
            <strong>{stats.kitchenPendingCount}</strong>
            <span>Pedidos em preparo</span>
          </div>
          <button className="text-button" onClick={() => onNavigate("kitchen")}>
            Abrir fila
          </button>
        </article>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Ações rápidas</span>
            <h3>O que você precisa fazer?</h3>
          </div>
        </div>

        <div className="action-grid">
          <button className="action-card action-card--primary" onClick={() => onNavigate("checkin")}>
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
