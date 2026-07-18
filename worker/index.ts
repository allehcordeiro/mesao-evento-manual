interface Env {
  DB: D1Database;
  APP_PIN: string;
  SESSION_SECRET: string;
  APP_NAME: string;
}

type JsonRecord = Record<string, unknown>;

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SESSION_COOKIE = "mesao_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;

  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }

  return null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );
  return toBase64Url(new Uint8Array(signature));
}

async function createSession(secret: string): Promise<string> {
  const body = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        role: "operator",
        exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
      })
    )
  );
  return `${body}.${await hmac(body, secret)}`;
}

async function verifySession(token: string | null, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const [body, signature] = token.split(".");
  if (!body || !signature) return false;

  const expected = await hmac(body, secret);
  if (!constantTimeEqual(signature, expected)) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as {
      exp?: number;
    };
    return typeof payload.exp === "number" && payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function bodyAsJson(request: Request): Promise<JsonRecord> {
  try {
    return (await request.json()) as JsonRecord;
  } catch {
    throw new HttpError(400, "O corpo da requisição é inválido.");
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now(): string {
  return new Date().toISOString();
}

function mapEvent(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    eventDate: String(row.event_date),
    startsAt: row.starts_at ? String(row.starts_at) : null,
    endsAt: row.ends_at ? String(row.ends_at) : null,
    status: String(row.status)
  };
}

function mapProduct(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    category: String(row.category),
    priceCents: Number(row.price_cents),
    requiresPreparation: Boolean(row.requires_preparation),
    available: Boolean(row.available),
    stockInitial:
      row.stock_initial === null || row.stock_initial === undefined
        ? null
        : Number(row.stock_initial),
    stockSold: Number(row.stock_sold ?? 0)
  };
}

function mapTabSummary(row: Record<string, unknown>) {
  const totalCents = Number(row.total_cents ?? 0);
  const paidCents = Number(row.paid_cents ?? 0);

  return {
    id: String(row.id),
    number: String(row.number),
    status: String(row.status),
    personName: String(row.person_name),
    personPhone: row.person_phone ? String(row.person_phone) : null,
    openedAt: String(row.opened_at),
    totalCents,
    paidCents,
    balanceCents: totalCents - paidCents,
    itemCount: Number(row.item_count ?? 0)
  };
}

async function activeEvent(db: D1Database): Promise<Record<string, unknown>> {
  const event = await db
    .prepare(
      `SELECT id, name, event_date, starts_at, ends_at, status
       FROM events
       WHERE status = 'active'
       ORDER BY event_date DESC
       LIMIT 1`
    )
    .first<Record<string, unknown>>();

  if (!event) {
    throw new HttpError(
      503,
      "Nenhum evento ativo foi encontrado. Aplique as migrações do banco."
    );
  }

  return event;
}

async function listProducts(
  db: D1Database,
  eventId: string
): Promise<Array<Record<string, unknown>>> {
  const result = await db
    .prepare(
      `SELECT
         p.id,
         p.name,
         p.category,
         ep.price_cents,
         p.requires_preparation,
         ep.available,
         ep.stock_initial,
         ep.stock_sold
       FROM event_products ep
       INNER JOIN products p ON p.id = ep.product_id
       WHERE ep.event_id = ? AND p.active = 1
       ORDER BY p.category, p.name`
    )
    .bind(eventId)
    .all<Record<string, unknown>>();

  return result.results;
}

async function listTabs(
  db: D1Database,
  eventId: string
): Promise<Array<Record<string, unknown>>> {
  const result = await db
    .prepare(
      `SELECT
         t.id,
         t.number,
         t.status,
         t.opened_at,
         pe.name AS person_name,
         pe.phone AS person_phone,
         COALESCE((
           SELECT SUM(ti.total_price_cents)
           FROM tab_items ti
           WHERE ti.tab_id = t.id
         ), 0) AS total_cents,
         COALESCE((
           SELECT SUM(pa.amount_cents)
           FROM payments pa
           WHERE pa.tab_id = t.id
         ), 0) AS paid_cents,
         COALESCE((
           SELECT SUM(ti2.quantity)
           FROM tab_items ti2
           WHERE ti2.tab_id = t.id
         ), 0) AS item_count
       FROM tabs t
       INNER JOIN attendances a ON a.id = t.attendance_id
       INNER JOIN people pe ON pe.id = a.person_id
       WHERE t.event_id = ? AND t.status = 'open'
       ORDER BY t.opened_at DESC`
    )
    .bind(eventId)
    .all<Record<string, unknown>>();

  return result.results;
}

async function listKitchen(
  db: D1Database,
  eventId: string
): Promise<Array<Record<string, unknown>>> {
  const result = await db
    .prepare(
      `SELECT
         ti.id,
         ti.tab_id,
         t.number AS tab_number,
         pe.name AS person_name,
         ti.product_name_snapshot AS product_name,
         ti.quantity,
         ti.preparation_status,
         ti.created_at
       FROM tab_items ti
       INNER JOIN tabs t ON t.id = ti.tab_id
       INNER JOIN attendances a ON a.id = t.attendance_id
       INNER JOIN people pe ON pe.id = a.person_id
       WHERE t.event_id = ?
         AND ti.preparation_status IN ('waiting', 'preparing', 'ready')
       ORDER BY
         CASE ti.preparation_status
           WHEN 'waiting' THEN 1
           WHEN 'preparing' THEN 2
           ELSE 3
         END,
         ti.created_at`
    )
    .bind(eventId)
    .all<Record<string, unknown>>();

  return result.results;
}

async function dashboard(
  db: D1Database,
  eventId: string
): Promise<Record<string, number>> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM attendances WHERE event_id = ? AND status = 'present') AS present_count,
         (SELECT COUNT(*) FROM tabs WHERE event_id = ? AND status = 'open') AS open_tabs_count,
         (SELECT COALESCE(SUM(ti.total_price_cents), 0)
          FROM tab_items ti
          INNER JOIN tabs t ON t.id = ti.tab_id
          WHERE t.event_id = ?) AS sales_cents,
         (SELECT COALESCE(SUM(pa.amount_cents), 0)
          FROM payments pa
          INNER JOIN tabs t ON t.id = pa.tab_id
          WHERE t.event_id = ?) AS payments_cents,
         (SELECT COUNT(*)
          FROM tab_items ti
          INNER JOIN tabs t ON t.id = ti.tab_id
          WHERE t.event_id = ?
            AND ti.preparation_status IN ('waiting', 'preparing', 'ready')) AS kitchen_pending_count`
    )
    .bind(eventId, eventId, eventId, eventId, eventId)
    .first<Record<string, unknown>>();

  return {
    presentCount: Number(row?.present_count ?? 0),
    openTabsCount: Number(row?.open_tabs_count ?? 0),
    salesCents: Number(row?.sales_cents ?? 0),
    paymentsCents: Number(row?.payments_cents ?? 0),
    kitchenPendingCount: Number(row?.kitchen_pending_count ?? 0)
  };
}

async function getTabDetail(db: D1Database, tabId: string) {
  const row = await db
    .prepare(
      `SELECT
         t.id,
         t.number,
         t.status,
         t.opened_at,
         a.id AS attendance_id,
         pe.id AS person_id,
         pe.name AS person_name,
         pe.phone AS person_phone,
         COALESCE((SELECT SUM(ti.total_price_cents) FROM tab_items ti WHERE ti.tab_id = t.id), 0) AS total_cents,
         COALESCE((SELECT SUM(pa.amount_cents) FROM payments pa WHERE pa.tab_id = t.id), 0) AS paid_cents,
         COALESCE((SELECT SUM(ti.quantity) FROM tab_items ti WHERE ti.tab_id = t.id), 0) AS item_count
       FROM tabs t
       INNER JOIN attendances a ON a.id = t.attendance_id
       INNER JOIN people pe ON pe.id = a.person_id
       WHERE t.id = ?`
    )
    .bind(tabId)
    .first<Record<string, unknown>>();

  if (!row) throw new HttpError(404, "Comanda não encontrada.");

  const items = await db
    .prepare(
      `SELECT
         id,
         product_id,
         product_name_snapshot,
         quantity,
         unit_price_cents,
         total_price_cents,
         preparation_status,
         created_at
       FROM tab_items
       WHERE tab_id = ?
       ORDER BY created_at DESC`
    )
    .bind(tabId)
    .all<Record<string, unknown>>();

  const payments = await db
    .prepare(
      `SELECT id, amount_cents, method, notes, created_at
       FROM payments
       WHERE tab_id = ?
       ORDER BY created_at DESC`
    )
    .bind(tabId)
    .all<Record<string, unknown>>();

  return {
    ...mapTabSummary(row),
    attendanceId: String(row.attendance_id),
    personId: String(row.person_id),
    items: items.results.map((item) => ({
      id: String(item.id),
      productId: String(item.product_id),
      productName: String(item.product_name_snapshot),
      quantity: Number(item.quantity),
      unitPriceCents: Number(item.unit_price_cents),
      totalPriceCents: Number(item.total_price_cents),
      preparationStatus: item.preparation_status
        ? String(item.preparation_status)
        : null,
      createdAt: String(item.created_at)
    })),
    payments: payments.results.map((payment) => ({
      id: String(payment.id),
      amountCents: Number(payment.amount_cents),
      method: String(payment.method),
      notes: payment.notes ? String(payment.notes) : null,
      createdAt: String(payment.created_at)
    }))
  };
}

async function handleBootstrap(env: Env): Promise<Response> {
  const eventRow = await activeEvent(env.DB);
  const eventId = String(eventRow.id);
  const [stats, products, tabs, kitchen] = await Promise.all([
    dashboard(env.DB, eventId),
    listProducts(env.DB, eventId),
    listTabs(env.DB, eventId),
    listKitchen(env.DB, eventId)
  ]);

  return json({
    event: mapEvent(eventRow),
    stats,
    products: products.map(mapProduct),
    tabs: tabs.map(mapTabSummary),
    kitchen: kitchen.map((item) => ({
      id: String(item.id),
      tabId: String(item.tab_id),
      tabNumber: String(item.tab_number),
      personName: String(item.person_name),
      productName: String(item.product_name),
      quantity: Number(item.quantity),
      preparationStatus: String(item.preparation_status),
      createdAt: String(item.created_at)
    }))
  });
}

async function handlePeople(request: Request, env: Env): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return json([]);

  const like = `%${query}%`;
  const digits = query.replace(/\D/g, "");
  const phoneLike = `%${digits || query}%`;
  const result = await env.DB
    .prepare(
      `SELECT
         pe.id,
         pe.name,
         pe.nickname,
         pe.phone,
         MAX(a.check_in_at) AS last_attendance_at
       FROM people pe
       LEFT JOIN attendances a ON a.person_id = pe.id
       WHERE pe.name LIKE ? COLLATE NOCASE
          OR pe.nickname LIKE ? COLLATE NOCASE
          OR pe.phone LIKE ?
       GROUP BY pe.id
       ORDER BY pe.name
       LIMIT 20`
    )
    .bind(like, like, phoneLike)
    .all<Record<string, unknown>>();

  return json(
    result.results.map((person) => ({
      id: String(person.id),
      name: String(person.name),
      nickname: person.nickname ? String(person.nickname) : null,
      phone: person.phone ? String(person.phone) : null,
      lastAttendanceAt: person.last_attendance_at
        ? String(person.last_attendance_at)
        : null
    }))
  );
}

async function handleCheckIn(request: Request, env: Env): Promise<Response> {
  const body = await bodyAsJson(request);
  const event = await activeEvent(env.DB);
  const eventId = String(event.id);
  let personId = stringValue(body.personId);

  if (personId) {
    const person = await env.DB
      .prepare("SELECT id FROM people WHERE id = ?")
      .bind(personId)
      .first();
    if (!person) throw new HttpError(404, "Pessoa não encontrada.");
  } else {
    const name = stringValue(body.name);
    const phone = stringValue(body.phone).replace(/\D/g, "") || null;
    if (name.length < 2) throw new HttpError(400, "Informe o nome da pessoa.");

    if (phone) {
      const existing = await env.DB
        .prepare("SELECT id FROM people WHERE phone = ? LIMIT 1")
        .bind(phone)
        .first<Record<string, unknown>>();
      if (existing) personId = String(existing.id);
    }

    if (!personId) {
      personId = id("person");
      await env.DB
        .prepare(
          `INSERT INTO people (id, name, phone, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(personId, name, phone, now(), now())
        .run();
    }
  }

  let attendance = await env.DB
    .prepare(
      `SELECT id FROM attendances
       WHERE event_id = ? AND person_id = ?
       LIMIT 1`
    )
    .bind(eventId, personId)
    .first<Record<string, unknown>>();

  if (!attendance) {
    const attendanceId = id("attendance");
    await env.DB
      .prepare(
        `INSERT INTO attendances
          (id, event_id, person_id, check_in_at, status, created_at)
         VALUES (?, ?, ?, ?, 'present', ?)`
      )
      .bind(attendanceId, eventId, personId, now(), now())
      .run();
    attendance = { id: attendanceId };
  } else {
    await env.DB
      .prepare(
        `UPDATE attendances
         SET status = 'present', check_in_at = ?
         WHERE id = ?`
      )
      .bind(now(), String(attendance.id))
      .run();
  }

  let tab = await env.DB
    .prepare("SELECT id FROM tabs WHERE attendance_id = ? LIMIT 1")
    .bind(String(attendance.id))
    .first<Record<string, unknown>>();

  if (!tab) {
    const maxRow = await env.DB
      .prepare(
        `SELECT COALESCE(MAX(CAST(number AS INTEGER)), 0) AS max_number
         FROM tabs
         WHERE event_id = ?`
      )
      .bind(eventId)
      .first<Record<string, unknown>>();

    const nextNumber = String(Number(maxRow?.max_number ?? 0) + 1).padStart(3, "0");
    const tabId = id("tab");
    await env.DB
      .prepare(
        `INSERT INTO tabs
          (id, event_id, attendance_id, number, status, opened_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`
      )
      .bind(tabId, eventId, String(attendance.id), nextNumber, now(), now(), now())
      .run();
    tab = { id: tabId };
  }

  return json(await getTabDetail(env.DB, String(tab.id)), 201);
}

async function handleAddItem(
  request: Request,
  env: Env,
  tabId: string
): Promise<Response> {
  const body = await bodyAsJson(request);
  const productId = stringValue(body.productId);
  const quantity = Math.floor(numberValue(body.quantity || 1));

  if (!productId || quantity < 1 || quantity > 50) {
    throw new HttpError(400, "Produto ou quantidade inválida.");
  }

  const tab = await env.DB
    .prepare("SELECT event_id, status FROM tabs WHERE id = ?")
    .bind(tabId)
    .first<Record<string, unknown>>();

  if (!tab) throw new HttpError(404, "Comanda não encontrada.");
  if (tab.status !== "open") throw new HttpError(409, "Esta comanda já está fechada.");

  const product = await env.DB
    .prepare(
      `SELECT
         p.id,
         p.name,
         p.requires_preparation,
         ep.price_cents,
         ep.stock_initial,
         ep.stock_sold,
         ep.available
       FROM event_products ep
       INNER JOIN products p ON p.id = ep.product_id
       WHERE ep.event_id = ? AND ep.product_id = ?`
    )
    .bind(String(tab.event_id), productId)
    .first<Record<string, unknown>>();

  if (!product || !product.available) {
    throw new HttpError(404, "Produto indisponível neste evento.");
  }

  if (
    product.stock_initial !== null &&
    Number(product.stock_sold) + quantity > Number(product.stock_initial)
  ) {
    throw new HttpError(409, "Não há estoque suficiente para este produto.");
  }

  const priceCents = Number(product.price_cents);
  const timestamp = now();

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO tab_items
          (id, tab_id, product_id, product_name_snapshot, quantity,
           unit_price_cents, total_price_cents, preparation_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id("item"),
        tabId,
        productId,
        String(product.name),
        quantity,
        priceCents,
        priceCents * quantity,
        product.requires_preparation ? "waiting" : null,
        timestamp
      ),
    env.DB
      .prepare(
        `UPDATE event_products
         SET stock_sold = stock_sold + ?
         WHERE event_id = ? AND product_id = ?`
      )
      .bind(quantity, String(tab.event_id), productId),
    env.DB
      .prepare("UPDATE tabs SET updated_at = ? WHERE id = ?")
      .bind(timestamp, tabId)
  ]);

  return json(await getTabDetail(env.DB, tabId), 201);
}

async function handleRemoveItem(
  env: Env,
  tabId: string,
  itemId: string
): Promise<Response> {
  const item = await env.DB
    .prepare(
      `SELECT
         ti.product_id,
         ti.quantity,
         t.event_id,
         t.status
       FROM tab_items ti
       INNER JOIN tabs t ON t.id = ti.tab_id
       WHERE ti.id = ? AND ti.tab_id = ?`
    )
    .bind(itemId, tabId)
    .first<Record<string, unknown>>();

  if (!item) throw new HttpError(404, "Item não encontrado.");
  if (item.status !== "open") throw new HttpError(409, "Esta comanda já está fechada.");

  await env.DB.batch([
    env.DB.prepare("DELETE FROM tab_items WHERE id = ?").bind(itemId),
    env.DB
      .prepare(
        `UPDATE event_products
         SET stock_sold = MAX(stock_sold - ?, 0)
         WHERE event_id = ? AND product_id = ?`
      )
      .bind(Number(item.quantity), String(item.event_id), String(item.product_id)),
    env.DB
      .prepare("UPDATE tabs SET updated_at = ? WHERE id = ?")
      .bind(now(), tabId)
  ]);

  return json(await getTabDetail(env.DB, tabId));
}

async function handlePayment(
  request: Request,
  env: Env,
  tabId: string
): Promise<Response> {
  const body = await bodyAsJson(request);
  const amountCents = Math.floor(numberValue(body.amountCents));
  const method = stringValue(body.method);
  const notes = stringValue(body.notes) || null;
  const allowed = new Set(["pix", "debit", "credit", "cash", "courtesy"]);

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new HttpError(400, "Informe um valor de pagamento válido.");
  }

  if (!allowed.has(method)) throw new HttpError(400, "Forma de pagamento inválida.");

  const tab = await env.DB
    .prepare("SELECT status FROM tabs WHERE id = ?")
    .bind(tabId)
    .first<Record<string, unknown>>();

  if (!tab) throw new HttpError(404, "Comanda não encontrada.");
  if (tab.status !== "open") throw new HttpError(409, "Esta comanda já está fechada.");

  const timestamp = now();
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO payments
          (id, tab_id, amount_cents, method, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id("payment"), tabId, amountCents, method, notes, timestamp),
    env.DB
      .prepare("UPDATE tabs SET updated_at = ? WHERE id = ?")
      .bind(timestamp, tabId)
  ]);

  return json(await getTabDetail(env.DB, tabId), 201);
}

async function handleCloseTab(env: Env, tabId: string): Promise<Response> {
  const detail = await getTabDetail(env.DB, tabId);

  if (detail.status !== "open") return json(detail);
  if (detail.balanceCents > 0) {
    throw new HttpError(
      409,
      `Ainda existe um saldo de R$ ${(detail.balanceCents / 100)
        .toFixed(2)
        .replace(".", ",")}.`
    );
  }

  await env.DB
    .prepare(
      `UPDATE tabs
       SET status = 'closed', closed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(now(), now(), tabId)
    .run();

  return json(await getTabDetail(env.DB, tabId));
}

async function handleKitchen(
  request: Request,
  env: Env,
  itemId: string
): Promise<Response> {
  const body = await bodyAsJson(request);
  const status = stringValue(body.preparationStatus);
  const allowed = new Set(["waiting", "preparing", "ready", "delivered"]);

  if (!allowed.has(status)) throw new HttpError(400, "Status de preparo inválido.");

  await env.DB
    .prepare(
      `UPDATE tab_items
       SET preparation_status = ?
       WHERE id = ? AND preparation_status IS NOT NULL`
    )
    .bind(status, itemId)
    .run();

  const item = await env.DB
    .prepare(
      `SELECT
         ti.id,
         ti.tab_id,
         t.number AS tab_number,
         pe.name AS person_name,
         ti.product_name_snapshot AS product_name,
         ti.quantity,
         ti.preparation_status,
         ti.created_at
       FROM tab_items ti
       INNER JOIN tabs t ON t.id = ti.tab_id
       INNER JOIN attendances a ON a.id = t.attendance_id
       INNER JOIN people pe ON pe.id = a.person_id
       WHERE ti.id = ?`
    )
    .bind(itemId)
    .first<Record<string, unknown>>();

  if (!item) throw new HttpError(404, "Pedido não encontrado.");

  return json({
    id: String(item.id),
    tabId: String(item.tab_id),
    tabNumber: String(item.tab_number),
    personName: String(item.person_name),
    productName: String(item.product_name),
    quantity: Number(item.quantity),
    preparationStatus: String(item.preparation_status),
    createdAt: String(item.created_at)
  });
}

async function handleUpdateEvent(
  request: Request,
  env: Env,
  eventId: string
): Promise<Response> {
  const body = await bodyAsJson(request);
  const current = await env.DB
    .prepare(
      `SELECT id, name, event_date, starts_at, ends_at, status
       FROM events
       WHERE id = ?`
    )
    .bind(eventId)
    .first<Record<string, unknown>>();

  if (!current) throw new HttpError(404, "Evento não encontrado.");

  const name = stringValue(body.name) || String(current.name);
  const eventDate = stringValue(body.eventDate) || String(current.event_date);
  const startsAt =
    body.startsAt === "" ? null : stringValue(body.startsAt) || current.starts_at;
  const endsAt =
    body.endsAt === "" ? null : stringValue(body.endsAt) || current.ends_at;

  await env.DB
    .prepare(
      `UPDATE events
       SET name = ?, event_date = ?, starts_at = ?, ends_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(name, eventDate, startsAt, endsAt, now(), eventId)
    .run();

  const updated = await env.DB
    .prepare(
      `SELECT id, name, event_date, starts_at, ends_at, status
       FROM events
       WHERE id = ?`
    )
    .bind(eventId)
    .first<Record<string, unknown>>();

  return json(mapEvent(updated!));
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === "/api/health") {
    return json({ ok: true, app: env.APP_NAME ?? "Mesão Evento" });
  }

  if (path === "/api/auth/login" && method === "POST") {
    const body = await bodyAsJson(request);
    const pin = stringValue(body.pin);

    if (!env.APP_PIN || !env.SESSION_SECRET) {
      throw new HttpError(500, "Os segredos do aplicativo ainda não foram configurados.");
    }

    if (!constantTimeEqual(pin, env.APP_PIN)) {
      throw new HttpError(401, "PIN incorreto.");
    }

    const token = await createSession(env.SESSION_SECRET);
    const secure = url.protocol === "https:" ? "; Secure" : "";

    return json(
      { authenticated: true },
      200,
      {
        "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(
          token
        )}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${secure}`
      }
    );
  }

  if (path === "/api/auth/logout" && method === "POST") {
    return json(
      { authenticated: false },
      200,
      {
        "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
      }
    );
  }

  const authenticated = await verifySession(
    readCookie(request, SESSION_COOKIE),
    env.SESSION_SECRET
  );

  if (path === "/api/auth/session" && method === "GET") {
    return json({ authenticated });
  }

  if (!path.startsWith("/api/")) {
    return json({ error: "Rota não encontrada." }, 404);
  }

  if (!authenticated) throw new HttpError(401, "Sessão expirada.");

  if (path === "/api/bootstrap" && method === "GET") return handleBootstrap(env);
  if (path === "/api/people" && method === "GET") return handlePeople(request, env);
  if (path === "/api/check-ins" && method === "POST") {
    return handleCheckIn(request, env);
  }

  const tabMatch = path.match(/^\/api\/tabs\/([^/]+)$/);
  if (tabMatch && method === "GET") {
    return json(await getTabDetail(env.DB, decodeURIComponent(tabMatch[1])));
  }

  const addItemMatch = path.match(/^\/api\/tabs\/([^/]+)\/items$/);
  if (addItemMatch && method === "POST") {
    return handleAddItem(request, env, decodeURIComponent(addItemMatch[1]));
  }

  const removeItemMatch = path.match(/^\/api\/tabs\/([^/]+)\/items\/([^/]+)$/);
  if (removeItemMatch && method === "DELETE") {
    return handleRemoveItem(
      env,
      decodeURIComponent(removeItemMatch[1]),
      decodeURIComponent(removeItemMatch[2])
    );
  }

  const paymentMatch = path.match(/^\/api\/tabs\/([^/]+)\/payments$/);
  if (paymentMatch && method === "POST") {
    return handlePayment(request, env, decodeURIComponent(paymentMatch[1]));
  }

  const closeMatch = path.match(/^\/api\/tabs\/([^/]+)\/close$/);
  if (closeMatch && method === "POST") {
    return handleCloseTab(env, decodeURIComponent(closeMatch[1]));
  }

  const kitchenMatch = path.match(/^\/api\/kitchen\/([^/]+)$/);
  if (kitchenMatch && method === "PATCH") {
    return handleKitchen(request, env, decodeURIComponent(kitchenMatch[1]));
  }

  const eventMatch = path.match(/^\/api\/events\/([^/]+)$/);
  if (eventMatch && method === "PATCH") {
    return handleUpdateEvent(request, env, decodeURIComponent(eventMatch[1]));
  }

  throw new HttpError(404, "Rota não encontrada.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "Ocorreu um erro inesperado no servidor." }, 500);
    }
  }
};
