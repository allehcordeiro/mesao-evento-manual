export type PaymentMethod = "pix" | "debit" | "credit" | "cash" | "courtesy";
export type PreparationStatus = "waiting" | "preparing" | "ready" | "delivered";

export interface SessionResponse {
  authenticated: boolean;
}

export interface EventInfo {
  id: string;
  name: string;
  eventDate: string;
  startsAt: string | null;
  endsAt: string | null;
  status: "draft" | "active" | "closed";
}

export interface DashboardStats {
  presentCount: number;
  openTabsCount: number;
  salesCents: number;
  paymentsCents: number;
  kitchenPendingCount: number;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  priceCents: number;
  requiresPreparation: boolean;
  available: boolean;
  stockInitial: number | null;
  stockSold: number;
}

export interface TabSummary {
  id: string;
  number: string;
  status: "open" | "closed";
  personName: string;
  personPhone: string | null;
  openedAt: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  itemCount: number;
}

export interface TabItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  preparationStatus: PreparationStatus | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  amountCents: number;
  method: PaymentMethod;
  notes: string | null;
  createdAt: string;
}

export interface TabDetail extends TabSummary {
  attendanceId: string;
  personId: string;
  items: TabItem[];
  payments: Payment[];
}

export interface Person {
  id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  lastAttendanceAt: string | null;
}

export interface KitchenItem {
  id: string;
  tabId: string;
  tabNumber: string;
  personName: string;
  productName: string;
  quantity: number;
  preparationStatus: PreparationStatus;
  createdAt: string;
}

export interface BootstrapData {
  event: EventInfo;
  stats: DashboardStats;
  products: Product[];
  tabs: TabSummary[];
  kitchen: KitchenItem[];
}
