import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  ExternalLink,
  ImagePlus,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  Trash2
} from "lucide-react";
import {
  createCardFolder,
  createCardOrder,
  listCardFolders,
  listScryfallPrints,
  resolveScryfallCard
} from "../lib/api";
import type {
  CardFolder,
  CardOrderItemInput,
  ScryfallCardOption,
  TabDetail
} from "../types";
import { formatMoney } from "../lib/format";

type Finish = CardOrderItemInput["finish"];
type CardCondition = CardOrderItemInput["condition"];

type OcrWorker = {
  recognize: (
    image: string,
    options?: Record<string, unknown>
  ) => Promise<{ data: { text: string; confidence?: number } }>;
  setParameters: (parameters: Record<string, string>) => Promise<void>;
  terminate: () => Promise<void>;
};

declare global {
  interface Window {
    Tesseract?: {
      createWorker: (language?: string) => Promise<OcrWorker>;
    };
  }
}

interface DraftCard {
  key: string;
  rawOcrText: string;
  cardName: string;
  selectedCard: ScryfallCardOption | null;
  printOptions: ScryfallCardOption[];
  showPrints: boolean;
  quantity: number;
  finish: Finish;
  condition: CardCondition;
  priceText: string;
  searching: boolean;
  error: string;
}

interface CardOrderFlowProps {
  tabId: string;
  busy: boolean;
  onCompleted: (tab: TabDetail) => void;
}

const conditions: CardCondition[] = ["NM", "SP", "MP", "HP", "D"];
const finishes: Array<{ value: Finish; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "foil", label: "Foil" },
  { value: "etched", label: "Etched" }
];

function createDraftCard(index: number): DraftCard {
  return {
    key: `${Date.now()}_${index}_${Math.random()}`,
    rawOcrText: "",
    cardName: "",
    selectedCard: null,
    printOptions: [],
    showPrints: false,
    quantity: 1,
    finish: "normal",
    condition: "NM",
    priceText: "",
    searching: false,
    error: ""
  };
}

function parseMoneyToCents(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : -1;
}

function buildLigaMagicUrl(cardName: string): string {
  const params = new URLSearchParams({
    view: "cards/search",
    tipo: "1",
    card: cardName
  });
  return `https://www.ligamagic.com.br/?${params.toString()}`;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível abrir a fotografia."));
    image.src = source;
  });
}

async function compressPhoto(file: File): Promise<string> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    const maxSide = 1400;
    let scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    let quality = 0.82;
    let result = "";

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Seu navegador não conseguiu preparar a fotografia.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      result = canvas.toDataURL("image/jpeg", quality);
      if (result.length <= 780_000) return result;
      quality = Math.max(0.48, quality - 0.08);
      if (attempt >= 4) scale *= 0.88;
    }

    if (result.length > 880_000) {
      throw new Error("A fotografia ficou muito grande. Afaste um pouco a câmera e tente novamente.");
    }
    return result;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function gridColumns(cardCount: number): number {
  if (cardCount <= 2) return cardCount;
  if (cardCount <= 6) return 3;
  return 4;
}

async function cropCardTitle(
  photoDataUrl: string,
  cardIndex: number,
  cardCount: number
): Promise<string> {
  const image = await loadImage(photoDataUrl);
  const columns = gridColumns(cardCount);
  const rows = Math.ceil(cardCount / columns);
  const column = cardIndex % columns;
  const row = Math.floor(cardIndex / columns);
  const cellWidth = image.naturalWidth / columns;
  const cellHeight = image.naturalHeight / rows;

  // A faixa superior contém o nome. Pequena margem evita ler cartas vizinhas.
  const sourceX = column * cellWidth + cellWidth * 0.04;
  const sourceY = row * cellHeight + cellHeight * 0.02;
  const sourceWidth = cellWidth * 0.92;
  const sourceHeight = cellHeight * 0.24;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(600, Math.round(sourceWidth * 1.8));
  canvas.height = Math.max(120, Math.round(sourceHeight * 1.8));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível recortar a fotografia.");
  context.filter = "grayscale(1) contrast(1.35)";
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas.toDataURL("image/jpeg", 0.9);
}

function cleanOcrName(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/[^A-Za-zÀ-ÿ0-9,'’\- ]/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => /[A-Za-zÀ-ÿ]{2}/.test(line));

  return lines.sort((left, right) => right.length - left.length)[0]?.slice(0, 80) ?? "";
}

export function CardOrderFlow({ tabId, busy, onCompleted }: CardOrderFlowProps) {
  const [folders, setFolders] = useState<CardFolder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [cardCount, setCardCount] = useState(4);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [cards, setCards] = useState<DraftCard[]>(() =>
    Array.from({ length: 4 }, (_, index) => createDraftCard(index))
  );
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ocrWorkerRef = useRef<OcrWorker | null>(null);

  useEffect(() => () => {
    ocrWorkerRef.current?.terminate().catch(() => undefined);
    ocrWorkerRef.current = null;
  }, []);

  useEffect(() => {
    listCardFolders()
      .then((result) => {
        setFolders(result);
        if (result[0]) setFolderId(result[0].id);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível carregar as pastas."))
      .finally(() => setLoadingFolders(false));
  }, []);

  const columns = gridColumns(cardCount);
  const totalCents = useMemo(
    () =>
      cards.reduce((total, card) => {
        const cents = parseMoneyToCents(card.priceText);
        return total + (cents >= 0 ? cents * card.quantity : 0);
      }, 0),
    [cards]
  );

  function resizeCards(nextCount: number) {
    setCardCount(nextCount);
    setCards((current) =>
      Array.from({ length: nextCount }, (_, index) => current[index] ?? createDraftCard(index))
    );
  }

  function updateCard(index: number, patch: Partial<DraftCard>) {
    setCards((current) =>
      current.map((card, cardIndex) => (cardIndex === index ? { ...card, ...patch } : card))
    );
  }

  async function handlePhoto(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      setPhotoDataUrl(await compressPhoto(file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível preparar a fotografia.");
    }
  }

  async function addFolder() {
    if (newFolderName.trim().length < 2) return;
    setCreatingFolder(true);
    setError("");
    try {
      const folder = await createCardFolder(newFolderName.trim());
      setFolders((current) => {
        const withoutDuplicate = current.filter((item) => item.id !== folder.id);
        return [...withoutDuplicate, folder].sort((left, right) => left.name.localeCompare(right.name));
      });
      setFolderId(folder.id);
      setNewFolderName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível criar a pasta.");
    } finally {
      setCreatingFolder(false);
    }
  }

  async function searchCard(index: number, queryOverride?: string) {
    const query = (queryOverride ?? cards[index].cardName).trim();
    if (query.length < 2) {
      updateCard(index, { error: "Digite pelo menos duas letras." });
      return;
    }

    updateCard(index, { searching: true, error: "", cardName: query });
    try {
      const result = await resolveScryfallCard(query);
      updateCard(index, {
        searching: false,
        cardName: result.name,
        selectedCard: result,
        printOptions: [],
        showPrints: false
      });
    } catch (caught) {
      updateCard(index, {
        searching: false,
        selectedCard: null,
        error: caught instanceof Error ? caught.message : "Carta não encontrada."
      });
    }
  }

  async function openPrints(index: number) {
    const card = cards[index];
    if (!card.cardName) return;
    updateCard(index, { searching: true, error: "" });
    try {
      const prints = await listScryfallPrints(card.cardName);
      updateCard(index, {
        searching: false,
        printOptions: prints,
        showPrints: true
      });
    } catch (caught) {
      updateCard(index, {
        searching: false,
        error: caught instanceof Error ? caught.message : "Não foi possível carregar as edições."
      });
    }
  }

  async function runOcr() {
    if (!photoDataUrl) {
      setError("Tire a fotografia antes de iniciar a leitura.");
      return;
    }
    if (!window.Tesseract) {
      setError("O OCR não carregou. Você ainda pode digitar os nomes manualmente.");
      return;
    }

    setOcrRunning(true);
    setError("");
    let worker: OcrWorker | null = null;
    try {
      setOcrProgress("Carregando o leitor de texto…");
      worker = await window.Tesseract.createWorker("eng");
      ocrWorkerRef.current = worker;
      await worker.setParameters({
        tessedit_pageseg_mode: "7",
        preserve_interword_spaces: "1"
      });

      for (let index = 0; index < cards.length; index += 1) {
        setOcrProgress(`Lendo carta ${index + 1} de ${cards.length}…`);
        const crop = await cropCardTitle(photoDataUrl, index, cards.length);
        const result = await worker.recognize(crop);
        const rawText = result.data.text.trim();
        const name = cleanOcrName(rawText);
        updateCard(index, {
          rawOcrText: rawText,
          cardName: name,
          selectedCard: null,
          error: name ? "" : "Não foi possível ler o nome. Digite manualmente."
        });
        if (name) await searchCard(index, name);
      }
      setOcrProgress("Leitura concluída. Confira os nomes e as edições.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `O OCR não concluiu: ${caught.message}. Você pode continuar manualmente.`
          : "O OCR não concluiu. Você pode continuar manualmente."
      );
    } finally {
      if (worker) await worker.terminate().catch(() => undefined);
      if (ocrWorkerRef.current === worker) ocrWorkerRef.current = null;
      setOcrRunning(false);
    }
  }

  async function finalize() {
    setError("");
    if (!folderId) {
      setError("Selecione a pasta das cartas.");
      return;
    }

    const items: CardOrderItemInput[] = [];
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      const unitPriceCents = parseMoneyToCents(card.priceText);
      if (card.cardName.trim().length < 2) {
        setError(`Informe o nome da carta ${index + 1}.`);
        return;
      }
      if (unitPriceCents < 0) {
        setError(`Informe o valor da carta ${index + 1}.`);
        return;
      }
      const selected = card.selectedCard;
      items.push({
        rawOcrText: card.rawOcrText,
        scryfallId: selected?.id,
        cardName: selected?.name ?? card.cardName.trim(),
        setCode: selected?.setCode,
        setName: selected?.setName,
        collectorNumber: selected?.collectorNumber,
        language: selected?.language,
        finish: card.finish,
        condition: card.condition,
        imageUrl: selected?.imageUrl ?? undefined,
        quantity: card.quantity,
        unitPriceCents
      });
    }

    setSaving(true);
    try {
      const updated = await createCardOrder(tabId, {
        folderId,
        photoDataUrl,
        items
      });
      onCompleted(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível adicionar as cartas.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="drawer-scroll card-order-flow">
      {error && <div className="inline-error">{error}</div>}

      <section className="card-step">
        <span className="eyebrow">1. Origem</span>
        <h3>De qual pasta saíram?</h3>
        <label className="field">
          <span>Pasta</span>
          <select
            value={folderId}
            disabled={loadingFolders}
            onChange={(event) => setFolderId(event.target.value)}
          >
            {loadingFolders && <option>Carregando…</option>}
            {!loadingFolders && folders.length === 0 && <option value="">Cadastre uma pasta</option>}
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.code} · {folder.name}
              </option>
            ))}
          </select>
        </label>
        <div className="folder-create-row">
          <input
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            placeholder="Nova pasta, por exemplo Multicoloridas"
          />
          <button
            type="button"
            className="button button--compact"
            disabled={creatingFolder || newFolderName.trim().length < 2}
            onClick={addFolder}
          >
            <Plus size={16} /> {creatingFolder ? "Salvando…" : "Criar"}
          </button>
        </div>
      </section>

      <section className="card-step">
        <span className="eyebrow">2. Fotografia</span>
        <h3>Organize as cartas em grade</h3>
        <p className="card-help">
          Coloque uma carta em cada posição, sem sobrepor, seguindo a ordem da esquerda para a direita.
        </p>

        <label className="field">
          <span>Quantidade de cartas nesta foto</span>
          <select
            value={cardCount}
            onChange={(event) => resizeCards(Number(event.target.value))}
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>

        <label className="photo-picker">
          {photoDataUrl ? <img src={photoDataUrl} alt="Lote fotografado" /> : <Camera aria-hidden="true" />}
          <span>{photoDataUrl ? "Trocar fotografia" : "Tirar fotografia"}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(event) => handlePhoto(event.target.files?.[0])}
          />
        </label>

        {photoDataUrl && (
          <div
            className="photo-grid-preview"
            style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
            aria-label="Ordem das cartas na fotografia"
          >
            {cards.map((card, index) => <span key={card.key}>{index + 1}</span>)}
          </div>
        )}

        <button
          type="button"
          className="button button--full"
          disabled={!photoDataUrl || ocrRunning}
          onClick={runOcr}
        >
          {ocrRunning ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
          {ocrRunning ? "Lendo nomes…" : "Ler nomes com OCR"}
        </button>
        {ocrProgress && <small className="field-hint">{ocrProgress}</small>}
        <small className="field-hint">
          O OCR é apenas um auxílio. Você sempre poderá corrigir ou digitar o nome manualmente.
        </small>
      </section>

      <section className="card-step">
        <span className="eyebrow">3. Conferência e preços</span>
        <h3>Confira carta por carta</h3>

        <div className="card-draft-list">
          {cards.map((card, index) => (
            <article className="card-draft" key={card.key}>
              <div className="card-draft__number">{index + 1}</div>
              {card.selectedCard?.imageUrl ? (
                <img className="card-thumb" src={card.selectedCard.imageUrl} alt="" />
              ) : (
                <div className="card-thumb card-thumb--empty"><ImagePlus size={22} /></div>
              )}

              <div className="card-draft__body">
                <label className="field field--compact">
                  <span>Nome da carta</span>
                  <div className="card-search-row">
                    <input
                      value={card.cardName}
                      onChange={(event) => updateCard(index, {
                        cardName: event.target.value,
                        selectedCard: null,
                        error: ""
                      })}
                      placeholder="Digite ou confira o nome"
                    />
                    <button
                      type="button"
                      className="icon-button"
                      disabled={card.searching || card.cardName.trim().length < 2}
                      aria-label="Buscar no Scryfall"
                      onClick={() => searchCard(index)}
                    >
                      {card.searching ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}
                    </button>
                  </div>
                </label>

                {card.selectedCard && (
                  <div className="card-match">
                    <Check size={15} />
                    <span>
                      {card.selectedCard.setName} · #{card.selectedCard.collectorNumber}
                    </span>
                    <button type="button" onClick={() => openPrints(index)}>Trocar edição</button>
                  </div>
                )}

                {card.showPrints && (
                  <div className="print-picker">
                    {card.printOptions.map((option) => (
                      <button
                        type="button"
                        key={option.id}
                        className={card.selectedCard?.id === option.id ? "selected" : ""}
                        onClick={() => updateCard(index, {
                          selectedCard: option,
                          cardName: option.name,
                          showPrints: false
                        })}
                      >
                        {option.imageUrl ? <img src={option.imageUrl} alt="" /> : <span>Sem imagem</span>}
                        <small>{option.setCode.toUpperCase()} · #{option.collectorNumber}</small>
                      </button>
                    ))}
                  </div>
                )}

                {card.error && <small className="card-error">{card.error}</small>}

                <div className="card-option-grid">
                  <label className="field field--compact">
                    <span>Condição</span>
                    <select
                      value={card.condition}
                      onChange={(event) => updateCard(index, { condition: event.target.value as CardCondition })}
                    >
                      {conditions.map((condition) => <option key={condition}>{condition}</option>)}
                    </select>
                  </label>
                  <label className="field field--compact">
                    <span>Acabamento</span>
                    <select
                      value={card.finish}
                      onChange={(event) => updateCard(index, { finish: event.target.value as Finish })}
                    >
                      {finishes.map((finish) => (
                        <option key={finish.value} value={finish.value}>{finish.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field field--compact">
                    <span>Qtd.</span>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      inputMode="numeric"
                      value={card.quantity}
                      onChange={(event) => updateCard(index, {
                        quantity: Math.max(1, Math.min(20, Number(event.target.value) || 1))
                      })}
                    />
                  </label>
                  <label className="field field--compact">
                    <span>Valor unitário</span>
                    <input
                      inputMode="decimal"
                      value={card.priceText}
                      onChange={(event) => updateCard(index, {
                        priceText: event.target.value.replace(/[^\d,.]/g, "")
                      })}
                      placeholder="0,00"
                    />
                  </label>
                </div>

                <a
                  className={`button button--compact liga-button ${card.cardName.trim().length < 2 ? "disabled" : ""}`}
                  href={card.cardName.trim().length >= 2 ? buildLigaMagicUrl(card.cardName.trim()) : undefined}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    if (card.cardName) navigator.clipboard?.writeText(card.cardName).catch(() => undefined);
                  }}
                >
                  <ExternalLink size={16} /> Abrir na LigaMagic
                </a>
              </div>

              {cards.length > 1 && (
                <button
                  type="button"
                  className="icon-button icon-button--danger card-remove"
                  aria-label={`Remover carta ${index + 1}`}
                  onClick={() => {
                    const next = cards.filter((_, cardIndex) => cardIndex !== index);
                    setCards(next);
                    setCardCount(next.length);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </article>
          ))}
        </div>

        {cards.length < 12 && (
          <button
            type="button"
            className="button button--compact"
            onClick={() => {
              setCards((current) => [...current, createDraftCard(current.length)]);
              setCardCount((current) => current + 1);
            }}
          >
            <Plus size={16} /> Adicionar carta manualmente
          </button>
        )}
      </section>

      <section className="card-order-total">
        <div>
          <span>{cards.reduce((sum, card) => sum + card.quantity, 0)} cartas</span>
          <strong>{formatMoney(totalCents)}</strong>
        </div>
        <button
          type="button"
          className="button button--primary"
          disabled={busy || saving}
          onClick={finalize}
        >
          {saving ? "Adicionando…" : "Adicionar à comanda"}
        </button>
      </section>
    </div>
  );
}
