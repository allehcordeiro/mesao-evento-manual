import { useMemo, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  ChevronLeft,
  Plus,
  Search,
  Trash2,
  WalletCards,
  X
} from "lucide-react";
import type { PaymentMethod, Product, TabDetail } from "../types";
import { CardOrderFlow } from "./CardOrderFlow";
import { CardOrderDetails } from "./CardOrderDetails";
import { formatMoney, paymentMethodLabels, preparationStatusLabels } from "../lib/format";

interface TabDrawerProps {
  tab: TabDetail;
  products: Product[];
  busy: boolean;
  onClose: () => void;
  onAddItem: (productId: string) => Promise<void>;
  onRemoveItem: (itemId: string) => Promise<void>;
  onPayment: (amountCents: number, method: PaymentMethod) => Promise<void>;
  onCloseTab: () => Promise<void>;
  onCardOrderCompleted: (tab: TabDetail) => void;
}

const methods: PaymentMethod[] = ["pix", "debit", "credit", "cash", "courtesy"];

export function TabDrawer({
  tab,
  products,
  busy,
  onClose,
  onAddItem,
  onRemoveItem,
  onPayment,
  onCloseTab,
  onCardOrderCompleted
}: TabDrawerProps) {
  const [view, setView] = useState<"summary" | "products" | "payment" | "cards" | "cardDetails">("summary");
  const [selectedCardOrderId, setSelectedCardOrderId] = useState<string | null>(null);
  const [category, setCategory] = useState("Todos");
  const [productQuery, setProductQuery] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix");
  const [paymentValue, setPaymentValue] = useState(
    (Math.max(tab.balanceCents, 0) / 100).toFixed(2).replace(".", ",")
  );

  const categories = useMemo(
    () => ["Todos", ...Array.from(new Set(products.map((product) => product.category)))],
    [products]
  );

  const filteredProducts = useMemo(() => {
    const query = productQuery.toLocaleLowerCase("pt-BR").trim();

    return products.filter((product) => {
      const matchesCategory = category === "Todos" || product.category === category;
      const matchesQuery =
        !query || product.name.toLocaleLowerCase("pt-BR").includes(query);
      return product.available && matchesCategory && matchesQuery;
    });
  }, [category, productQuery, products]);

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    const normalized = paymentValue.replace(/\./g, "").replace(",", ".");
    const amountCents = Math.round(Number(normalized) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) return;
    await onPayment(amountCents, paymentMethod);
    setView("summary");
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Comanda ${tab.number}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          {view !== "summary" ? (
            <button
              className="icon-button"
              aria-label="Voltar"
              onClick={() => setView(view === "cards" ? "products" : "summary")}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
          ) : (
            <div className="tab-number tab-number--large">{tab.number}</div>
          )}
          <div className="drawer-title">
            <span>{
              view === "summary"
                ? "Comanda"
                : view === "products"
                  ? "Adicionar item"
                  : view === "payment"
                    ? "Pagamento"
                    : view === "cards"
                      ? "Cartas avulsas"
                      : "Detalhes das cartas"
            }</span>
            <strong>{tab.personName}</strong>
          </div>
          <button className="icon-button" aria-label="Fechar janela" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>

        {view === "summary" && (
          <>
            <div className="drawer-scroll">
              <section className="balance-card">
                <div>
                  <span>Total</span>
                  <strong>{formatMoney(tab.totalCents)}</strong>
                </div>
                <div>
                  <span>Pago</span>
                  <strong>{formatMoney(tab.paidCents)}</strong>
                </div>
                <div className="balance-card__highlight">
                  <span>Saldo</span>
                  <strong>{formatMoney(tab.balanceCents)}</strong>
                </div>
              </section>

              <section>
                <div className="section-heading section-heading--compact">
                  <div>
                    <span className="eyebrow">Consumo</span>
                    <h3>Itens da comanda</h3>
                  </div>
                  <button className="button button--compact" onClick={() => setView("products")}>
                    <Plus size={17} aria-hidden="true" />
                    Adicionar
                  </button>
                </div>

                <div className="item-list">
                  {tab.items.map((item) => (
                    <article className="item-row" key={item.id}>
                      <div className="item-quantity">{item.quantity}×</div>
                      <div className="item-row__content">
                        <strong>{item.productName}</strong>
                        <span>{formatMoney(item.unitPriceCents)} cada</span>
                        {item.preparationStatus && (
                          <small className="status-note">Preparo: {preparationStatusLabels[item.preparationStatus]}</small>
                        )}
                        {item.cardOrderId && (
                          <button
                            type="button"
                            className="item-detail-link"
                            onClick={() => {
                              setSelectedCardOrderId(item.cardOrderId);
                              setView("cardDetails");
                            }}
                          >
                            Ver {item.cardCount ?? ""} cartas · {item.cardFolderName ?? "Pasta"}
                          </button>
                        )}
                      </div>
                      <strong>{formatMoney(item.totalPriceCents)}</strong>
                      {tab.status === "open" && (
                        <button
                          className="icon-button icon-button--danger"
                          aria-label={`Remover ${item.productName}`}
                          disabled={busy}
                          onClick={() => onRemoveItem(item.id)}
                        >
                          <Trash2 size={17} aria-hidden="true" />
                        </button>
                      )}
                    </article>
                  ))}

                  {tab.items.length === 0 && (
                    <div className="empty-card">
                      <WalletCards aria-hidden="true" />
                      <p>A comanda ainda não possui itens.</p>
                    </div>
                  )}
                </div>
              </section>

              {tab.payments.length > 0 && (
                <section>
                  <div className="section-heading section-heading--compact">
                    <div>
                      <span className="eyebrow">Recebimentos</span>
                      <h3>Pagamentos</h3>
                    </div>
                  </div>
                  <div className="payment-history">
                    {tab.payments.map((payment) => (
                      <div key={payment.id}>
                        <Banknote aria-hidden="true" />
                        <span>{paymentMethodLabels[payment.method]}</span>
                        <strong>{formatMoney(payment.amountCents)}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {tab.status === "open" && (
              <footer className="drawer-actions">
                <button className="button" onClick={() => {
                  setPaymentValue((Math.max(tab.balanceCents, 0) / 100).toFixed(2).replace(".", ","));
                  setView("payment");
                }}>
                  <Banknote size={18} aria-hidden="true" />
                  Receber
                </button>
                <button
                  className="button button--primary"
                  disabled={busy || tab.balanceCents > 0}
                  onClick={onCloseTab}
                >
                  <CheckCircle2 size={18} aria-hidden="true" />
                  Fechar comanda
                </button>
              </footer>
            )}
          </>
        )}

        {view === "products" && (
          <div className="drawer-scroll">
            <label className="field">
              <span>Pesquisar produto</span>
              <div className="input-with-icon">
                <Search size={18} aria-hidden="true" />
                <input
                  value={productQuery}
                  onChange={(event) => setProductQuery(event.target.value)}
                  placeholder="Bebida, comida, acessório..."
                />
              </div>
            </label>

            <div className="chip-row">
              {categories.map((item) => (
                <button
                  className={`chip ${category === item ? "chip--active" : ""}`}
                  key={item}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="product-grid">
              {filteredProducts.map((product) => {
                const remaining =
                  product.stockInitial === null
                    ? null
                    : product.stockInitial - product.stockSold;
                return (
                  <button
                    className="product-card"
                    key={product.id}
                    disabled={busy || remaining === 0}
                    onClick={() => {
                      if (product.id === "prod_single_cards") {
                        setView("cards");
                        return;
                      }
                      onAddItem(product.id);
                    }}
                  >
                    <span className="product-category">{product.category}</span>
                    <strong>{product.name}</strong>
                    <div>
                      <span>{product.id === "prod_single_cards" ? "Montar pedido" : formatMoney(product.priceCents)}</span>
                      <Plus size={18} aria-hidden="true" />
                    </div>
                    {remaining !== null && <small>{remaining} disponíveis</small>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {view === "cards" && (
          <CardOrderFlow
            tabId={tab.id}
            busy={busy}
            onCompleted={(updated) => {
              onCardOrderCompleted(updated);
              setView("summary");
            }}
          />
        )}

        {view === "cardDetails" && selectedCardOrderId && (
          <CardOrderDetails cardOrderId={selectedCardOrderId} />
        )}

        {view === "payment" && (
          <form className="drawer-scroll payment-form" onSubmit={submitPayment}>
            <section className="payment-balance">
              <span>Saldo atual</span>
              <strong>{formatMoney(tab.balanceCents)}</strong>
            </section>

            <label className="field">
              <span>Valor recebido</span>
              <input
                className="money-input"
                inputMode="decimal"
                value={paymentValue}
                onChange={(event) => setPaymentValue(event.target.value.replace(/[^\d,.]/g, ""))}
                placeholder="0,00"
                required
              />
              <small className="field-hint">
                Digite o valor normalmente, por exemplo 25,00.
              </small>
            </label>

            <div className="method-grid">
              {methods.map((method) => (
                <button
                  type="button"
                  className={`method-card ${paymentMethod === method ? "method-card--active" : ""}`}
                  key={method}
                  onClick={() => setPaymentMethod(method)}
                >
                  {paymentMethodLabels[method]}
                </button>
              ))}
            </div>

            <button className="button button--primary button--full" disabled={busy}>
              {busy ? "Registrando..." : "Confirmar pagamento"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
