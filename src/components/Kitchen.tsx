import { ChefHat, Check, CookingPot, PackageCheck } from "lucide-react";
import type { KitchenItem, PreparationStatus } from "../types";
import { formatTime, preparationStatusLabels } from "../lib/format";

interface KitchenProps {
  items: KitchenItem[];
  onUpdate: (itemId: string, status: PreparationStatus) => void;
}

const columns: Array<{
  status: PreparationStatus;
  icon: typeof ChefHat;
  next?: PreparationStatus;
  action?: string;
}> = [
  { status: "waiting", icon: ChefHat, next: "preparing", action: "Iniciar" },
  { status: "preparing", icon: CookingPot, next: "ready", action: "Marcar pronto" },
  { status: "ready", icon: PackageCheck, next: "delivered", action: "Entregar" }
];

export function Kitchen({ items, onUpdate }: KitchenProps) {
  return (
    <div className="page-content">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Produção</span>
          <h2>Fila de preparo</h2>
          <p>Atualize o pedido conforme ele avança.</p>
        </div>
      </div>

      <div className="kitchen-board">
        {columns.map(({ status, icon: Icon, next, action }) => {
          const statusItems = items.filter((item) => item.preparationStatus === status);

          return (
            <section className="kitchen-column" key={status}>
              <header>
                <Icon aria-hidden="true" />
                <strong>{preparationStatusLabels[status]}</strong>
                <span>{statusItems.length}</span>
              </header>

              <div className="kitchen-list">
                {statusItems.map((item) => (
                  <article className="kitchen-card" key={item.id}>
                    <div className="kitchen-card__top">
                      <span className="pill">Comanda {item.tabNumber}</span>
                      <small>{formatTime(item.createdAt)}</small>
                    </div>
                    <h3>
                      {item.quantity}× {item.productName}
                    </h3>
                    <p>{item.personName}</p>
                    {next && action && (
                      <button
                        className="button button--full"
                        onClick={() => onUpdate(item.id, next)}
                      >
                        {next === "delivered" && <Check size={17} aria-hidden="true" />}
                        {action}
                      </button>
                    )}
                  </article>
                ))}

                {statusItems.length === 0 && (
                  <div className="kitchen-empty">Nenhum pedido aqui.</div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
