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
const CARD_PHOTO_RETENTION_DAYS = 7;
const MAX_CARD_PHOTO_DATA_URL_LENGTH = 900_000;


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

async function tableColumnNames(
  db: D1Database,
  table: "card_folders" | "card_orders" | "card_order_items" | "tab_items"
): Promise<Set<string>> {
  const result = await db
    .prepare(`PRAGMA table_info(${table})`)
    .all<Record<string, unknown>>();
  return new Set(result.results.map((column) => String(column.name)));
}

async function ensureTabItemsCardOrderColumn(db: D1Database): Promise<void> {
  const currentColumns = await tableColumnNames(db, "tab_items");
  if (currentColumns.has("card_order_id")) return;

  try {
    await db
      .prepare(
        `ALTER TABLE tab_items
         ADD COLUMN card_order_id TEXT
         REFERENCES card_orders(id) ON DELETE SET NULL`
      )
      .run();
  } catch (error) {
    // Dois atendimentos podem detectar a coluna ausente ao mesmo tempo.
    // Revalida o schema antes de considerar a alteração como falha real.
    const refreshedColumns = await tableColumnNames(db, "tab_items");
    if (!refreshedColumns.has("card_order_id")) throw error;
  }

  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tab_items_card_order_unique
       ON tab_items(card_order_id)
       WHERE card_order_id IS NOT NULL`
    )
    .run();
}

function scryfallImageUrl(card: Record<string, unknown>): string | null {
  const imageUris = card.image_uris as Record<string, unknown> | undefined;
  if (imageUris?.normal) return String(imageUris.normal);

  const faces = card.card_faces as Array<Record<string, unknown>> | undefined;
  const firstFaceImages = faces?.[0]?.image_uris as Record<string, unknown> | undefined;
  return firstFaceImages?.normal ? String(firstFaceImages.normal) : null;
}

function mapScryfallCard(card: Record<string, unknown>) {
  return {
    id: String(card.id),
    name: String(card.name),
    printedName: card.printed_name ? String(card.printed_name) : null,
    setCode: String(card.set ?? ""),
    setName: String(card.set_name ?? ""),
    collectorNumber: String(card.collector_number ?? ""),
    language: String(card.lang ?? "en"),
    imageUrl: scryfallImageUrl(card)
  };
}

async function scryfallFetch(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.scryfall.com${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MesaoEvento/0.2 (card-order lookup)"
    }
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = payload.details ? String(payload.details) : "Carta não encontrada no Scryfall.";
    throw new HttpError(response.status === 404 ? 404 : 502, message);
  }
  return payload;
}

async function clearExpiredCardPhotos(db: D1Database): Promise<void> {
  await db
    .prepare(
      `UPDATE card_orders
       SET photo_data_url = NULL,
           photo_size_bytes = 0,
           photo_deleted_at = ?,
           updated_at = ?
       WHERE photo_data_url IS NOT NULL
         AND photo_expires_at IS NOT NULL
         AND photo_expires_at <= ?`
    )
    .bind(now(), now(), now())
    .run();
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

  const tabItemColumns = await tableColumnNames(db, "tab_items");
  const hasCardOrderLink = tabItemColumns.has("card_order_id");
  const cardOrderSelect = hasCardOrderLink
    ? `ti.card_order_id,
       co.card_count,
       co.folder_name_snapshot AS card_folder_name`
    : `NULL AS card_order_id,
       NULL AS card_count,
       NULL AS card_folder_name`;
  const cardOrderJoin = hasCardOrderLink
    ? "LEFT JOIN card_orders co ON co.id = ti.card_order_id"
    : "";

  const items = await db
    .prepare(
      `SELECT
         ti.id,
         ti.product_id,
         ti.product_name_snapshot,
         ti.quantity,
         ti.unit_price_cents,
         ti.total_price_cents,
         ti.preparation_status,
         ti.created_at,
         ${cardOrderSelect}
       FROM tab_items ti
       ${cardOrderJoin}
       WHERE ti.tab_id = ?
       ORDER BY ti.created_at DESC`
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
      createdAt: String(item.created_at),
      cardOrderId: item.card_order_id ? String(item.card_order_id) : null,
      cardCount:
        item.card_count === null || item.card_count === undefined
          ? null
          : Number(item.card_count),
      cardFolderName: item.card_folder_name ? String(item.card_folder_name) : null
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
  await clearExpiredCardPhotos(env.DB);
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
         ti.card_order_id,
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

  const statements = [
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
  ];

  if (item.card_order_id) {
    statements.push(
      env.DB.prepare("DELETE FROM card_orders WHERE id = ?").bind(String(item.card_order_id))
    );
  }

  await env.DB.batch(statements);

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

function dataUrlSizeBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const base64 = dataUrl.slice(comma + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

async function handleCardFolders(request: Request, env: Env): Promise<Response> {
  if (request.method.toUpperCase() === "GET") {
    const result = await env.DB
      .prepare(
        `SELECT id, code, name
         FROM card_folders
         WHERE active = 1
         ORDER BY sort_order, name`
      )
      .all<Record<string, unknown>>();

    return json(
      result.results.map((folder) => ({
        id: String(folder.id),
        code: String(folder.code),
        name: String(folder.name)
      }))
    );
  }

  const body = await bodyAsJson(request);
  const name = stringValue(body.name);
  if (name.length < 2 || name.length > 60) {
    throw new HttpError(400, "Informe um nome de pasta entre 2 e 60 caracteres.");
  }

  const existing = await env.DB
    .prepare("SELECT id, code, name FROM card_folders WHERE name = ? COLLATE NOCASE LIMIT 1")
    .bind(name)
    .first<Record<string, unknown>>();

  if (existing) {
    return json({
      id: String(existing.id),
      code: String(existing.code),
      name: String(existing.name)
    });
  }

  const count = await env.DB
    .prepare("SELECT COUNT(*) AS total FROM card_folders")
    .first<Record<string, unknown>>();
  const code = `P-${String(Number(count?.total ?? 0) + 1).padStart(2, "0")}`;
  const folderId = id("folder");
  const timestamp = now();

  const availableColumns = await tableColumnNames(env.DB, "card_folders");
  const insertColumns = ["id", "code", "name"];
  const insertValues: unknown[] = [folderId, code, name];

  if (availableColumns.has("qr_token")) {
    insertColumns.push("qr_token");
    insertValues.push(`folder_${crypto.randomUUID()}`);
  }

  insertColumns.push("active", "sort_order");
  insertValues.push(1, Number(count?.total ?? 0) + 1);

  if (availableColumns.has("created_by_operator_id")) {
    insertColumns.push("created_by_operator_id");
    insertValues.push("operator");
  }

  if (availableColumns.has("updated_by_operator_id")) {
    insertColumns.push("updated_by_operator_id");
    insertValues.push("operator");
  }

  insertColumns.push("created_at", "updated_at");
  insertValues.push(timestamp, timestamp);

  const placeholders = insertColumns.map(() => "?").join(", ");
  await env.DB
    .prepare(
      `INSERT INTO card_folders (${insertColumns.join(", ")})
       VALUES (${placeholders})`
    )
    .bind(...insertValues)
    .run();

  return json({ id: folderId, code, name }, 201);
}

async function handleScryfallNamed(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) throw new HttpError(400, "Informe o nome da carta.");

  const params = new URLSearchParams({ fuzzy: query });
  try {
    const card = await scryfallFetch(`/cards/named?${params.toString()}`);
    return json(mapScryfallCard(card));
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
    const searchParams = new URLSearchParams({ q: query, order: "name" });
    const result = await scryfallFetch(`/cards/search?${searchParams.toString()}`);
    const cards = Array.isArray(result.data)
      ? (result.data as Array<Record<string, unknown>>)
      : [];
    if (!cards[0]) throw error;
    return json(mapScryfallCard(cards[0]));
  }
}

async function handleScryfallPrints(request: Request): Promise<Response> {
  const name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
  if (name.length < 2) throw new HttpError(400, "Informe o nome da carta.");

  const safeName = name.replace(/"/g, "");
  const params = new URLSearchParams({
    order: "released",
    unique: "prints",
    q: `!"${safeName}"`
  });
  const result = await scryfallFetch(`/cards/search?${params.toString()}`);
  const cards = Array.isArray(result.data)
    ? (result.data as Array<Record<string, unknown>>)
    : [];
  return json(cards.slice(0, 40).map(mapScryfallCard));
}

async function handleCreateCardOrder(
  request: Request,
  env: Env,
  tabId: string
): Promise<Response> {
  const body = await bodyAsJson(request);
  const folderId = stringValue(body.folderId);
  const photoDataUrl = stringValue(body.photoDataUrl) || null;
  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (!folderId) throw new HttpError(400, "Selecione a pasta das cartas.");
  if (rawItems.length < 1 || rawItems.length > 30) {
    throw new HttpError(400, "O pedido deve possuir entre 1 e 30 cartas.");
  }

  if (photoDataUrl) {
    const allowedPrefix = /^data:image\/(jpeg|jpg|png|webp);base64,/i;
    if (!allowedPrefix.test(photoDataUrl)) {
      throw new HttpError(400, "A fotografia precisa ser JPEG, PNG ou WebP.");
    }
    if (photoDataUrl.length > MAX_CARD_PHOTO_DATA_URL_LENGTH) {
      throw new HttpError(413, "A fotografia ficou muito grande. Tire uma foto novamente.");
    }
  }

  const tab = await env.DB
    .prepare("SELECT event_id, status FROM tabs WHERE id = ?")
    .bind(tabId)
    .first<Record<string, unknown>>();
  if (!tab) throw new HttpError(404, "Comanda não encontrada.");
  if (tab.status !== "open") throw new HttpError(409, "Esta comanda já está fechada.");

  const folder = await env.DB
    .prepare("SELECT id, code, name FROM card_folders WHERE id = ? AND active = 1")
    .bind(folderId)
    .first<Record<string, unknown>>();
  if (!folder) throw new HttpError(404, "Pasta não encontrada ou inativa.");

  const product = await env.DB
    .prepare(
      `SELECT p.id, p.name
       FROM event_products ep
       INNER JOIN products p ON p.id = ep.product_id
       WHERE ep.event_id = ?
         AND ep.product_id = 'prod_single_cards'
         AND ep.available = 1`
    )
    .bind(String(tab.event_id))
    .first<Record<string, unknown>>();
  if (!product) {
    throw new HttpError(409, "O produto Cartas avulsas não está disponível neste evento.");
  }

  const items = rawItems.map((raw, index) => {
    const item = (raw ?? {}) as JsonRecord;
    const cardName = stringValue(item.cardName);
    const quantity = Math.floor(numberValue(item.quantity || 1));
    const unitPriceCents = Math.floor(numberValue(item.unitPriceCents));
    const finish = stringValue(item.finish) || "normal";
    const condition = stringValue(item.condition) || "NM";

    if (cardName.length < 2) {
      throw new HttpError(400, `Informe o nome da carta ${index + 1}.`);
    }
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 20) {
      throw new HttpError(400, `Quantidade inválida na carta ${index + 1}.`);
    }
    if (!Number.isFinite(unitPriceCents) || unitPriceCents < 0) {
      throw new HttpError(400, `Valor inválido na carta ${index + 1}.`);
    }
    if (!["normal", "foil", "etched"].includes(finish)) {
      throw new HttpError(400, `Acabamento inválido na carta ${index + 1}.`);
    }
    if (!["NM", "SP", "MP", "HP", "D"].includes(condition)) {
      throw new HttpError(400, `Condição inválida na carta ${index + 1}.`);
    }

    return {
      sequence: index + 1,
      rawOcrText: stringValue(item.rawOcrText) || null,
      scryfallId: stringValue(item.scryfallId) || null,
      cardName,
      setCode: stringValue(item.setCode) || null,
      setName: stringValue(item.setName) || null,
      collectorNumber: stringValue(item.collectorNumber) || null,
      language: stringValue(item.language) || null,
      finish,
      condition,
      imageUrl: stringValue(item.imageUrl) || null,
      quantity,
      unitPriceCents,
      totalPriceCents: quantity * unitPriceCents
    };
  });

  const totalCents = items.reduce((sum, item) => sum + item.totalPriceCents, 0);
  const cardCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const orderId = id("card_order");
  const tabItemId = id("item");
  const timestamp = now();
  const photoSizeBytes = photoDataUrl ? dataUrlSizeBytes(photoDataUrl) : 0;
  const expiresAt = photoDataUrl
    ? new Date(Date.now() + CARD_PHOTO_RETENTION_DAYS * 86_400_000).toISOString()
    : null;

  await ensureTabItemsCardOrderColumn(env.DB);

  const orderTableColumns = await tableColumnNames(env.DB, "card_orders");
  const orderColumns: string[] = [
    "id",
    "tab_id",
    "folder_id",
    "folder_code_snapshot",
    "folder_name_snapshot",
    "status",
    "card_count",
    "total_cents"
  ];
  const orderValues: unknown[] = [
    orderId,
    tabId,
    folderId,
    String(folder.code),
    String(folder.name),
    "completed",
    cardCount,
    totalCents
  ];

  const addOrderColumn = (column: string, value: unknown) => {
    if (orderTableColumns.has(column)) {
      orderColumns.push(column);
      orderValues.push(value);
    }
  };

  addOrderColumn("event_id", String(tab.event_id));
  addOrderColumn("subtotal_cents", totalCents);
  addOrderColumn("discount_cents", 0);
  addOrderColumn("photo_data_url", photoDataUrl);
  addOrderColumn("photo_size_bytes", photoSizeBytes);
  addOrderColumn("photo_expires_at", expiresAt);
  addOrderColumn("created_by_operator_id", "operator");
  addOrderColumn("completed_by_operator_id", "operator");
  addOrderColumn("completed_at", timestamp);
  orderColumns.push("created_at", "updated_at");
  orderValues.push(timestamp, timestamp);

  const orderPlaceholders = orderColumns.map(() => "?").join(", ");
  const statements = [
    env.DB
      .prepare(
        `INSERT INTO card_orders (${orderColumns.join(", ")})
         VALUES (${orderPlaceholders})`
      )
      .bind(...orderValues)
  ];

  const itemTableColumns = await tableColumnNames(env.DB, "card_order_items");
  for (const item of items) {
    const itemColumns: string[] = [
      "id",
      "card_order_id",
      "sequence",
      "raw_ocr_text",
      "scryfall_id",
      "card_name",
      "set_code",
      "set_name",
      "collector_number",
      "language",
      "finish",
      "card_condition",
      "quantity",
      "unit_price_cents",
      "total_price_cents"
    ];
    const itemValues: unknown[] = [
      id("card_item"),
      orderId,
      item.sequence,
      item.rawOcrText,
      item.scryfallId,
      item.cardName,
      item.setCode,
      item.setName,
      item.collectorNumber,
      item.language,
      item.finish,
      item.condition,
      item.quantity,
      item.unitPriceCents,
      item.totalPriceCents
    ];

    if (itemTableColumns.has("image_url")) {
      itemColumns.push("image_url");
      itemValues.push(item.imageUrl);
    } else if (itemTableColumns.has("scryfall_image_url")) {
      itemColumns.push("scryfall_image_url");
      itemValues.push(item.imageUrl);
    }

    const addItemColumn = (column: string, value: unknown) => {
      if (itemTableColumns.has(column)) {
        itemColumns.push(column);
        itemValues.push(value);
      }
    };

    addItemColumn("recognition_status", "confirmed");
    addItemColumn("price_source", "ligamagic_manual");
    addItemColumn("priced_at", timestamp);
    addItemColumn("priced_by_operator_id", "operator");
    addItemColumn("confirmed_at", timestamp);
    addItemColumn("confirmed_by_operator_id", "operator");
    itemColumns.push("created_at", "updated_at");
    itemValues.push(timestamp, timestamp);

    const itemPlaceholders = itemColumns.map(() => "?").join(", ");
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO card_order_items (${itemColumns.join(", ")})
           VALUES (${itemPlaceholders})`
        )
        .bind(...itemValues)
    );
  }

  statements.push(
    env.DB
      .prepare(
        `INSERT INTO tab_items
          (id, tab_id, product_id, product_name_snapshot, quantity,
           unit_price_cents, total_price_cents, preparation_status,
           created_at, card_order_id)
         VALUES (?, ?, 'prod_single_cards', ?, 1, ?, ?, NULL, ?, ?)`
      )
      .bind(
        tabItemId,
        tabId,
        `Cartas avulsas — ${String(folder.name)}`,
        totalCents,
        totalCents,
        timestamp,
        orderId
      ),
    env.DB
      .prepare(
        `UPDATE event_products
         SET stock_sold = stock_sold + 1
         WHERE event_id = ? AND product_id = 'prod_single_cards'`
      )
      .bind(String(tab.event_id)),
    env.DB
      .prepare("UPDATE tabs SET updated_at = ? WHERE id = ?")
      .bind(timestamp, tabId)
  );

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("card_order_finalize_failed", {
      tabId,
      folderId,
      cardCount,
      totalCents,
      message
    });

    if (/foreign key constraint failed/i.test(message)) {
      throw new HttpError(
        409,
        "Não foi possível vincular o lote à comanda. Atualize a página e confirme se a pasta e o produto Cartas avulsas continuam ativos."
      );
    }

    const requiredColumn = message.match(/not null constraint failed:\s*([a-zA-Z0-9_.]+)/i)?.[1];
    if (requiredColumn) {
      throw new HttpError(
        409,
        `O banco exige o campo ${requiredColumn} para finalizar o lote. Consulte os logs do Worker antes de tentar novamente.`
      );
    }

    const missingColumn =
      message.match(/no such column:\s*([a-zA-Z0-9_.]+)/i)?.[1] ??
      message.match(/has no column named\s+([a-zA-Z0-9_.]+)/i)?.[1];
    if (missingColumn) {
      throw new HttpError(
        409,
        `O banco não possui o campo ${missingColumn}. Publique a versão 6.2 e tente novamente.`
      );
    }

    throw error;
  }

  return json(await getTabDetail(env.DB, tabId), 201);
}

async function handleGetCardOrder(env: Env, cardOrderId: string): Promise<Response> {
  await clearExpiredCardPhotos(env.DB);
  const order = await env.DB
    .prepare(
      `SELECT id, tab_id, folder_id, folder_code_snapshot, folder_name_snapshot,
              status, card_count, total_cents, photo_data_url, photo_expires_at,
              created_at
       FROM card_orders
       WHERE id = ?`
    )
    .bind(cardOrderId)
    .first<Record<string, unknown>>();

  if (!order) throw new HttpError(404, "Pedido de cartas não encontrado.");

  const itemTableColumns = await tableColumnNames(env.DB, "card_order_items");
  const imageExpression = itemTableColumns.has("image_url")
    ? "image_url"
    : itemTableColumns.has("scryfall_image_url")
      ? "scryfall_image_url AS image_url"
      : "NULL AS image_url";

  const result = await env.DB
    .prepare(
      `SELECT id, sequence, raw_ocr_text, scryfall_id, card_name, set_code,
              set_name, collector_number, language, finish, card_condition,
              ${imageExpression}, quantity, unit_price_cents, total_price_cents
       FROM card_order_items
       WHERE card_order_id = ?
       ORDER BY sequence`
    )
    .bind(cardOrderId)
    .all<Record<string, unknown>>();

  return json({
    id: String(order.id),
    tabId: String(order.tab_id),
    folderId: String(order.folder_id),
    folderCode: String(order.folder_code_snapshot),
    folderName: String(order.folder_name_snapshot),
    status: String(order.status),
    cardCount: Number(order.card_count),
    totalCents: Number(order.total_cents),
    photoDataUrl: order.photo_data_url ? String(order.photo_data_url) : null,
    photoExpiresAt: order.photo_expires_at ? String(order.photo_expires_at) : null,
    createdAt: String(order.created_at),
    items: result.results.map((item) => ({
      id: String(item.id),
      sequence: Number(item.sequence),
      rawOcrText: item.raw_ocr_text ? String(item.raw_ocr_text) : null,
      scryfallId: item.scryfall_id ? String(item.scryfall_id) : null,
      cardName: String(item.card_name),
      setCode: item.set_code ? String(item.set_code) : null,
      setName: item.set_name ? String(item.set_name) : null,
      collectorNumber: item.collector_number ? String(item.collector_number) : null,
      language: item.language ? String(item.language) : null,
      finish: String(item.finish),
      condition: String(item.card_condition),
      imageUrl: item.image_url ? String(item.image_url) : null,
      quantity: Number(item.quantity),
      unitPriceCents: Number(item.unit_price_cents),
      totalPriceCents: Number(item.total_price_cents)
    }))
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
  if (path === "/api/card-folders" && (method === "GET" || method === "POST")) {
    return handleCardFolders(request, env);
  }
  if (path === "/api/cards/scryfall/named" && method === "GET") {
    return handleScryfallNamed(request);
  }
  if (path === "/api/cards/scryfall/prints" && method === "GET") {
    return handleScryfallPrints(request);
  }
  if (path === "/api/people" && method === "GET") return handlePeople(request, env);
  if (path === "/api/check-ins" && method === "POST") {
    return handleCheckIn(request, env);
  }

  const tabMatch = path.match(/^\/api\/tabs\/([^/]+)$/);
  if (tabMatch && method === "GET") {
    return json(await getTabDetail(env.DB, decodeURIComponent(tabMatch[1])));
  }

  const createCardOrderMatch = path.match(/^\/api\/tabs\/([^/]+)\/card-orders$/);
  if (createCardOrderMatch && method === "POST") {
    return handleCreateCardOrder(
      request,
      env,
      decodeURIComponent(createCardOrderMatch[1])
    );
  }

  const cardOrderMatch = path.match(/^\/api\/card-orders\/([^/]+)$/);
  if (cardOrderMatch && method === "GET") {
    return handleGetCardOrder(env, decodeURIComponent(cardOrderMatch[1]));
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
