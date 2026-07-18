import type {
  BootstrapData,
  EventInfo,
  KitchenItem,
  Person,
  PreparationStatus,
  TabDetail
} from "../types";

const CACHE_KEY = "mesao-bootstrap-cache";
const AUTH_CACHE_KEY = "mesao-auth-cache";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };

  if (!response.ok) {
    throw new ApiError(payload.error ?? "Não foi possível concluir a operação.", response.status);
  }

  return payload as T;
}

export async function getSession(): Promise<boolean> {
  try {
    const result = await request<{ authenticated: boolean }>("/api/auth/session");
    if (result.authenticated) localStorage.setItem(AUTH_CACHE_KEY, "true");
    return result.authenticated;
  } catch {
    return !navigator.onLine && localStorage.getItem(AUTH_CACHE_KEY) === "true";
  }
}

export async function login(pin: string): Promise<void> {
  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ pin })
  });
  localStorage.setItem(AUTH_CACHE_KEY, "true");
}

export async function logout(): Promise<void> {
  await request("/api/auth/logout", { method: "POST" });
  localStorage.removeItem(AUTH_CACHE_KEY);
}

export async function getBootstrap(): Promise<BootstrapData> {
  try {
    const data = await request<BootstrapData>("/api/bootstrap");
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    return data;
  } catch (error) {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached && !navigator.onLine) {
      return JSON.parse(cached) as BootstrapData;
    }
    throw error;
  }
}

export async function searchPeople(query: string): Promise<Person[]> {
  return request<Person[]>(`/api/people?q=${encodeURIComponent(query)}`);
}

export async function checkIn(input: {
  personId?: string;
  name?: string;
  phone?: string;
}): Promise<TabDetail> {
  return request<TabDetail>("/api/check-ins", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getTab(tabId: string): Promise<TabDetail> {
  return request<TabDetail>(`/api/tabs/${tabId}`);
}

export async function addItem(
  tabId: string,
  productId: string,
  quantity = 1
): Promise<TabDetail> {
  return request<TabDetail>(`/api/tabs/${tabId}/items`, {
    method: "POST",
    body: JSON.stringify({ productId, quantity })
  });
}

export async function removeItem(tabId: string, itemId: string): Promise<TabDetail> {
  return request<TabDetail>(`/api/tabs/${tabId}/items/${itemId}`, {
    method: "DELETE"
  });
}

export async function addPayment(
  tabId: string,
  amountCents: number,
  method: string,
  notes?: string
): Promise<TabDetail> {
  return request<TabDetail>(`/api/tabs/${tabId}/payments`, {
    method: "POST",
    body: JSON.stringify({ amountCents, method, notes })
  });
}

export async function closeTab(tabId: string): Promise<TabDetail> {
  return request<TabDetail>(`/api/tabs/${tabId}/close`, {
    method: "POST"
  });
}

export async function updateKitchenItem(
  itemId: string,
  preparationStatus: PreparationStatus
): Promise<KitchenItem> {
  return request<KitchenItem>(`/api/kitchen/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({ preparationStatus })
  });
}

export async function updateEvent(
  eventId: string,
  input: Partial<Pick<EventInfo, "name" | "eventDate" | "startsAt" | "endsAt">>
): Promise<EventInfo> {
  return request<EventInfo>(`/api/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}
