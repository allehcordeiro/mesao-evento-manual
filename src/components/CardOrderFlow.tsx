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
  ocrCandidates: string[];
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
  photoDataUrl: string | null;
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
    ocrCandidates: [],
    cardName: "",
    selectedCard: null,
    printOptions: [],
    showPrints: false,
    quantity: 1,
    finish: "normal",
    condition: "NM",
    priceText: "",
    searching: false,
    error: "",
    photoDataUrl: null
  };
}

function parseMoneyToCents(value: string): number {
  if (!/\d/.test(value)) return -1;
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
    let quality = 0.84;
    let result = "";

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Seu navegador não conseguiu preparar a fotografia.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      result = canvas.toDataURL("image/jpeg", quality);
      if (result.length <= 700_000) return result;
      quality = Math.max(0.48, quality - 0.08);
      if (attempt >= 4) scale *= 0.88;
    }

    if (result.length > 780_000) {
      throw new Error("A fotografia ficou muito grande. Afaste um pouco a câmera e tente novamente.");
    }
    return result;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function prepareFullCardForOcr(photoDataUrl: string): Promise<string> {
  const image = await loadImage(photoDataUrl);

  // O Tesseract recebe a carta inteira. A ordem natural da leitura (topo para
  // baixo) é usada para considerar o título como o primeiro texto plausível.
  const minimumWidth = 1500;
  const scale = image.naturalWidth < minimumWidth
    ? Math.min(2.4, minimumWidth / Math.max(1, image.naturalWidth))
    : 1;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar a fotografia para leitura.");

  // Um tratamento moderado conserva tanto o título quanto os demais textos.
  // Exagerar no contraste pode apagar letras claras ou textos de cartas antigas.
  context.filter = "grayscale(1) contrast(1.28) brightness(1.04)";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/png");
}

function normalizeOcrLine(line: string): string {
  return line
    .replace(/^[\s>|»•*#~_]+/, "")
    .replace(/^\d{1,3}\s*[).:\]\-]\s*/, "")
    .replace(/[^A-Za-zÀ-ÿ0-9,'’\-:!?.&/ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function extractOcrCandidates(text: string): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = normalizeOcrLine(rawLine);
    if (line.length < 2 || !/[A-Za-zÀ-ÿ]{2}/.test(line)) continue;

    const words = line.split(" ").filter(Boolean);
    const oneCharacterWords = words.filter((word) => word.length === 1).length;
    const letterCount = (line.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;

    // Descarta linhas que são predominantemente símbolos/letras isoladas, um
    // padrão comum na leitura de ícones, custo de mana e moldura da carta.
    if (words.length >= 3 && oneCharacterWords >= Math.ceil(words.length / 2)) continue;
    if (letterCount < Math.max(2, Math.floor(line.length * 0.45))) continue;
    if (/^(copyright|illustrated by|artist|collector|wizards of the coast)$/i.test(line)) continue;

    const key = line.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(line);

    // O título está no topo. Limitar as tentativas evita que um trecho longo das
    // regras seja confundido com o nome de outra carta real.
    if (candidates.length >= 8) break;
  }

  return candidates;
}

async function composeOrderPhoto(cards: DraftCard[]): Promise<string | null> {
  const photos = cards.map((card) => card.photoDataUrl).filter((value): value is string => Boolean(value));
  if (photos.length === 0) return null;
  if (photos.length === 1) return photos[0];

  const images = await Promise.all(photos.map(loadImage));
  const columns = Math.min(3, images.length);
  const rows = Math.ceil(images.length / columns);
  const cellWidth = columns === 1 ? 540 : 300;
  const cellHeight = Math.round(cellWidth * 1.4);
  const canvas = document.createElement("canvas");
  canvas.width = columns * cellWidth;
  canvas.height = rows * cellHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível montar o registro fotográfico do lote.");

  context.fillStyle = "#f4efe5";
  context.fillRect(0, 0, canvas.width, canvas.height);

  images.forEach((image, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const padding = 10;
    const areaWidth = cellWidth - padding * 2;
    const areaHeight = cellHeight - padding * 2;
    const scale = Math.min(areaWidth / image.naturalWidth, areaHeight / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const x = column * cellWidth + (cellWidth - drawWidth) / 2;
    const y = row * cellHeight + (cellHeight - drawHeight) / 2;
    context.drawImage(image, x, y, drawWidth, drawHeight);
  });

  let quality = 0.82;
  let result = canvas.toDataURL("image/jpeg", quality);
  while (result.length > 760_000 && quality > 0.44) {
    quality -= 0.08;
    result = canvas.toDataURL("image/jpeg", quality);
  }
  return result;
}

export function CardOrderFlow({ tabId, busy, onCompleted }: CardOrderFlowProps) {
  const [folders, setFolders] = useState<CardFolder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [confirmedCards, setConfirmedCards] = useState<DraftCard[]>([]);
  const [currentCard, setCurrentCard] = useState<DraftCard>(() => createDraftCard(0));
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

  const totalCents = useMemo(
    () =>
      confirmedCards.reduce((total, card) => {
        const cents = parseMoneyToCents(card.priceText);
        return total + (cents >= 0 ? cents * card.quantity : 0);
      }, 0),
    [confirmedCards]
  );

  const confirmedQuantity = useMemo(
    () => confirmedCards.reduce((sum, card) => sum + card.quantity, 0),
    [confirmedCards]
  );

  function updateCurrentCard(patch: Partial<DraftCard>) {
    setCurrentCard((current) => ({ ...current, ...patch }));
  }

  async function handlePhoto(file: File | undefined) {
    if (!file) return;
    setError("");
    setOcrProgress("");
    try {
      const photoDataUrl = await compressPhoto(file);
      setCurrentCard((current) => ({
        ...current,
        photoDataUrl,
        rawOcrText: "",
        ocrCandidates: [],
        cardName: "",
        selectedCard: null,
        printOptions: [],
        showPrints: false,
        error: ""
      }));
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

  async function searchCurrentCard(queryOverride?: string) {
    const query = (queryOverride ?? currentCard.cardName).trim();
    if (query.length < 2) {
      updateCurrentCard({ error: "Digite pelo menos duas letras." });
      return;
    }

    updateCurrentCard({ searching: true, error: "", cardName: query });
    try {
      const result = await resolveScryfallCard(query);
      updateCurrentCard({
        searching: false,
        cardName: result.name,
        selectedCard: result,
        printOptions: [],
        showPrints: false
      });
    } catch (caught) {
      updateCurrentCard({
        searching: false,
        selectedCard: null,
        error: caught instanceof Error ? caught.message : "Carta não encontrada."
      });
    }
  }

  async function openPrints() {
    if (!currentCard.cardName) return;
    updateCurrentCard({ searching: true, error: "" });
    try {
      const prints = await listScryfallPrints(currentCard.cardName);
      updateCurrentCard({
        searching: false,
        printOptions: prints,
        showPrints: true
      });
    } catch (caught) {
      updateCurrentCard({
        searching: false,
        error: caught instanceof Error ? caught.message : "Não foi possível carregar as edições."
      });
    }
  }

  async function getOcrWorker(): Promise<OcrWorker> {
    if (ocrWorkerRef.current) return ocrWorkerRef.current;
    if (!window.Tesseract) {
      throw new Error("O OCR não carregou. Digite o nome manualmente.");
    }

    setOcrProgress("Carregando o leitor de texto…");
    const worker = await window.Tesseract.createWorker("eng");
    await worker.setParameters({
      tessedit_pageseg_mode: "3",
      preserve_interword_spaces: "1"
    });
    ocrWorkerRef.current = worker;
    return worker;
  }

  async function runOcr() {
    if (!currentCard.photoDataUrl) {
      setError("Fotografe a carta antes de iniciar a leitura.");
      return;
    }

    setOcrRunning(true);
    setError("");
    updateCurrentCard({ error: "" });
    try {
      const worker = await getOcrWorker();
      setOcrProgress("Lendo todos os textos da carta…");
      const preparedImage = await prepareFullCardForOcr(currentCard.photoDataUrl);
      const result = await worker.recognize(preparedImage);
      const rawText = result.data.text.trim();
      const candidates = extractOcrCandidates(rawText);
      const firstCandidate = candidates[0] ?? "";

      updateCurrentCard({
        rawOcrText: rawText,
        ocrCandidates: candidates,
        cardName: firstCandidate,
        selectedCard: null,
        printOptions: [],
        showPrints: false,
        error: firstCandidate ? "" : "Não foi possível localizar uma primeira linha legível. Digite o nome manualmente."
      });

      if (!firstCandidate) {
        setOcrProgress("Não conseguimos ler uma linha utilizável. Digite o nome manualmente.");
        return;
      }

      let matchedCard: ScryfallCardOption | null = null;
      let matchedCandidate = "";

      // A primeira linha é sempre tentada primeiro. As seguintes funcionam como
      // contingência para casos em que o OCR produziu um pequeno ruído acima do título.
      for (const candidate of candidates) {
        setOcrProgress(`Conferindo “${candidate}” no Scryfall…`);
        try {
          matchedCard = await resolveScryfallCard(candidate);
          matchedCandidate = candidate;
          break;
        } catch {
          // Tenta a próxima linha plausível. O erro final é exibido abaixo.
        }
      }

      if (matchedCard) {
        updateCurrentCard({
          rawOcrText: rawText,
          ocrCandidates: candidates,
          cardName: matchedCard.name,
          selectedCard: matchedCard,
          printOptions: [],
          showPrints: false,
          searching: false,
          error: ""
        });
        setOcrProgress(`O OCR sugeriu “${matchedCandidate}”. Confirme a carta e a edição.`);
      } else {
        updateCurrentCard({
          rawOcrText: rawText,
          ocrCandidates: candidates,
          cardName: firstCandidate,
          selectedCard: null,
          searching: false,
          error: "O Scryfall não reconheceu as primeiras linhas. Corrija o nome ou escolha outro candidato abaixo."
        });
        setOcrProgress(`Primeira linha lida: ${firstCandidate}.`);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `O OCR não concluiu: ${caught.message}`
          : "O OCR não concluiu. Digite o nome manualmente."
      );
    } finally {
      setOcrRunning(false);
    }
  }

  function confirmAndNext() {
    setError("");
    const unitPriceCents = parseMoneyToCents(currentCard.priceText);

    if (!currentCard.photoDataUrl) {
      setError("Fotografe a carta antes de confirmá-la.");
      return;
    }
    if (!currentCard.selectedCard) {
      setError("Confirme a carta correta no Scryfall antes de avançar.");
      return;
    }
    if (unitPriceCents < 0) {
      setError("Informe o valor da carta antes de avançar.");
      return;
    }

    setConfirmedCards((current) => [...current, currentCard]);
    setCurrentCard(createDraftCard(confirmedCards.length + 1));
    setOcrProgress("");
  }

  async function finalize() {
    setError("");
    if (!folderId) {
      setError("Selecione a pasta das cartas.");
      return;
    }
    if (confirmedCards.length === 0) {
      setError("Confirme pelo menos uma carta antes de finalizar o lote.");
      return;
    }

    const items: CardOrderItemInput[] = confirmedCards.map((card) => {
      const selected = card.selectedCard;
      return {
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
        unitPriceCents: parseMoneyToCents(card.priceText)
      };
    });

    setSaving(true);
    try {
      const photoDataUrl = await composeOrderPhoto(confirmedCards);
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
      <div className="card-flow-version" role="status">Leitura individual · versão 2</div>
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
        <span className="eyebrow">2. Carta {confirmedCards.length + 1}</span>
        <h3>Fotografe uma carta</h3>
        <p className="card-help">
          Preencha quase toda a tela com uma única carta, mantendo o nome visível e evitando reflexos.
        </p>

        <label className="photo-picker photo-picker--single">
          {currentCard.photoDataUrl ? (
            <img src={currentCard.photoDataUrl} alt="Carta fotografada" />
          ) : (
            <Camera aria-hidden="true" />
          )}
          <span>{currentCard.photoDataUrl ? "Fotografar novamente" : "Fotografar carta"}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(event) => handlePhoto(event.target.files?.[0])}
          />
        </label>

        <button
          type="button"
          className="button button--full"
          disabled={!currentCard.photoDataUrl || ocrRunning}
          onClick={runOcr}
        >
          {ocrRunning ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
          {ocrRunning ? "Lendo nome…" : "Ler nome da carta"}
        </button>
        {ocrProgress && <small className="field-hint">{ocrProgress}</small>}

        {currentCard.rawOcrText && (
          <details className="ocr-reading-details">
            <summary>Ver leitura completa do OCR</summary>
            {currentCard.ocrCandidates.length > 0 && (
              <div className="ocr-candidate-list">
                <span>Linhas testadas, na ordem:</span>
                {currentCard.ocrCandidates.map((candidate, index) => (
                  <button
                    type="button"
                    key={`${candidate}_${index}`}
                    onClick={() => {
                      updateCurrentCard({ cardName: candidate, selectedCard: null, error: "" });
                      void searchCurrentCard(candidate);
                    }}
                  >
                    {index + 1}. {candidate}
                  </button>
                ))}
              </div>
            )}
            <pre>{currentCard.rawOcrText}</pre>
          </details>
        )}
      </section>

      <section className="card-step">
        <span className="eyebrow">3. Conferência</span>
        <h3>Confirme a carta e informe o preço</h3>

        <article className="card-draft card-draft--current">
          {currentCard.selectedCard?.imageUrl ? (
            <img className="card-thumb" src={currentCard.selectedCard.imageUrl} alt="" />
          ) : (
            <div className="card-thumb card-thumb--empty"><ImagePlus size={22} /></div>
          )}

          <div className="card-draft__body">
            <label className="field field--compact">
              <span>Nome da carta</span>
              <div className="card-search-row">
                <input
                  value={currentCard.cardName}
                  onChange={(event) => updateCurrentCard({
                    cardName: event.target.value,
                    selectedCard: null,
                    error: ""
                  })}
                  placeholder="Digite ou confira o nome"
                />
                <button
                  type="button"
                  className="icon-button"
                  disabled={currentCard.searching || currentCard.cardName.trim().length < 2}
                  aria-label="Buscar no Scryfall"
                  onClick={() => searchCurrentCard()}
                >
                  {currentCard.searching ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}
                </button>
              </div>
            </label>

            {currentCard.selectedCard && (
              <div className="card-match">
                <Check size={15} />
                <span>
                  {currentCard.selectedCard.setName} · #{currentCard.selectedCard.collectorNumber}
                </span>
                <button type="button" onClick={openPrints}>Trocar edição</button>
              </div>
            )}

            {currentCard.showPrints && (
              <div className="print-picker">
                {currentCard.printOptions.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={currentCard.selectedCard?.id === option.id ? "selected" : ""}
                    onClick={() => updateCurrentCard({
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

            {currentCard.error && <small className="card-error">{currentCard.error}</small>}

            <div className="card-option-grid">
              <label className="field field--compact">
                <span>Condição</span>
                <select
                  value={currentCard.condition}
                  onChange={(event) => updateCurrentCard({ condition: event.target.value as CardCondition })}
                >
                  {conditions.map((condition) => <option key={condition}>{condition}</option>)}
                </select>
              </label>
              <label className="field field--compact">
                <span>Acabamento</span>
                <select
                  value={currentCard.finish}
                  onChange={(event) => updateCurrentCard({ finish: event.target.value as Finish })}
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
                  value={currentCard.quantity}
                  onChange={(event) => updateCurrentCard({
                    quantity: Math.max(1, Math.min(20, Number(event.target.value) || 1))
                  })}
                />
              </label>
              <label className="field field--compact">
                <span>Valor unitário</span>
                <input
                  inputMode="decimal"
                  value={currentCard.priceText}
                  onChange={(event) => updateCurrentCard({
                    priceText: event.target.value.replace(/[^\d,.]/g, "")
                  })}
                  placeholder="0,00"
                />
              </label>
            </div>

            <a
              className={`button button--compact liga-button ${currentCard.cardName.trim().length < 2 ? "disabled" : ""}`}
              href={currentCard.cardName.trim().length >= 2 ? buildLigaMagicUrl(currentCard.cardName.trim()) : undefined}
              target="_blank"
              rel="noreferrer"
              onClick={() => {
                if (currentCard.cardName) {
                  navigator.clipboard?.writeText(currentCard.cardName).catch(() => undefined);
                }
              }}
            >
              <ExternalLink size={16} /> Abrir na LigaMagic
            </a>
          </div>
        </article>

        <button
          type="button"
          className="button button--primary button--full"
          disabled={!currentCard.photoDataUrl || !currentCard.selectedCard || parseMoneyToCents(currentCard.priceText) < 0}
          onClick={confirmAndNext}
        >
          <Check size={18} /> Confirmar carta e fotografar próxima
        </button>
      </section>

      <section className="card-step">
        <span className="eyebrow">4. Lote</span>
        <h3>Cartas confirmadas</h3>

        {confirmedCards.length === 0 ? (
          <p className="card-help">Nenhuma carta confirmada ainda.</p>
        ) : (
          <div className="confirmed-card-list">
            {confirmedCards.map((card, index) => {
              const unitPriceCents = parseMoneyToCents(card.priceText);
              return (
                <article className="confirmed-card" key={card.key}>
                  {card.selectedCard?.imageUrl ? (
                    <img src={card.selectedCard.imageUrl} alt="" />
                  ) : (
                    <div className="confirmed-card__empty"><ImagePlus size={18} /></div>
                  )}
                  <div>
                    <strong>{index + 1}. {card.selectedCard?.name ?? card.cardName}</strong>
                    <small>
                      {card.selectedCard?.setCode.toUpperCase()} · #{card.selectedCard?.collectorNumber} · {card.condition}
                    </small>
                    <span>{card.quantity} × {formatMoney(unitPriceCents)}</span>
                  </div>
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
                    aria-label={`Remover ${card.cardName}`}
                    onClick={() => setConfirmedCards((current) => current.filter((item) => item.key !== card.key))}
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="card-order-total">
        <div>
          <span>{confirmedQuantity} cartas confirmadas</span>
          <strong>{formatMoney(totalCents)}</strong>
        </div>
        <button
          type="button"
          className="button button--primary"
          disabled={busy || saving || confirmedCards.length === 0}
          onClick={finalize}
        >
          {saving ? "Finalizando…" : "Finalizar lote"}
        </button>
      </section>
    </div>
  );
}
