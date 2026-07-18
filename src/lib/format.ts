import type { PaymentMethod, PreparationStatus } from "../types";

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(cents / 100);
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date(`${date}T12:00:00`));
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  pix: "Pix",
  debit: "Débito",
  credit: "Crédito",
  cash: "Dinheiro",
  courtesy: "Cortesia"
};

export const preparationStatusLabels: Record<PreparationStatus, string> = {
  waiting: "Aguardando",
  preparing: "Preparando",
  ready: "Pronto",
  delivered: "Entregue"
};
