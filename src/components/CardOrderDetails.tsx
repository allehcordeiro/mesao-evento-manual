import { useEffect, useState } from "react";
import { ExternalLink, ImageOff, LoaderCircle } from "lucide-react";
import { getCardOrder } from "../lib/api";
import type { CardOrderDetail } from "../types";
import { formatMoney } from "../lib/format";

interface CardOrderDetailsProps {
  cardOrderId: string;
}

export function CardOrderDetails({ cardOrderId }: CardOrderDetailsProps) {
  const [order, setOrder] = useState<CardOrderDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setOrder(null);
    setError("");
    getCardOrder(cardOrderId)
      .then(setOrder)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir o pedido."));
  }, [cardOrderId]);

  if (error) return <div className="inline-error">{error}</div>;
  if (!order) {
    return <div className="details-loading"><LoaderCircle className="spin" /> Carregando cartas…</div>;
  }

  return (
    <div className="drawer-scroll card-order-details">
      <section className="card-order-summary">
        <div><span>Pasta</span><strong>{order.folderCode} · {order.folderName}</strong></div>
        <div><span>Cartas</span><strong>{order.cardCount}</strong></div>
        <div><span>Total</span><strong>{formatMoney(order.totalCents)}</strong></div>
      </section>

      {order.photoDataUrl ? (
        <figure className="saved-photo">
          <img src={order.photoDataUrl} alt="Fotografia do lote vendido" />
          <figcaption>
            Fotografia temporária{order.photoExpiresAt ? ` até ${new Date(order.photoExpiresAt).toLocaleDateString("pt-BR")}` : ""}.
          </figcaption>
        </figure>
      ) : (
        <div className="saved-photo-empty"><ImageOff /> A fotografia temporária já foi removida.</div>
      )}

      <div className="sold-card-list">
        {order.items.map((item) => (
          <article key={item.id}>
            {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <div className="sold-card-placeholder" />}
            <div>
              <strong>{item.quantity}× {item.cardName}</strong>
              <span>
                {[item.setName, item.collectorNumber ? `#${item.collectorNumber}` : null]
                  .filter(Boolean)
                  .join(" · ") || "Edição não informada"}
              </span>
              <small>{item.condition} · {item.finish}</small>
            </div>
            <div className="sold-card-price">
              <strong>{formatMoney(item.totalPriceCents)}</strong>
              <small>{formatMoney(item.unitPriceCents)} cada</small>
              <a
                href={`https://www.ligamagic.com.br/?${new URLSearchParams({ view: "cards/search", tipo: "1", card: item.cardName })}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Abrir ${item.cardName} na LigaMagic`}
              >
                <ExternalLink size={15} /> LigaMagic
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
