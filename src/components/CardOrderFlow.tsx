import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  ExternalLink,
  ImagePlus,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload
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
type OcrSource = "paddle-default" | "paddle-detailed";
type CardEntryMethod = "camera" | "manual";

interface PaddleOcrPoint {
  0: number;
  1: number;
}

interface PaddleOcrItem {
  poly: PaddleOcrPoint[];
  text: string;
  score: number;
}

interface PaddleOcrResult {
  image: { width: number; height: number };
  items: PaddleOcrItem[];
  metrics?: {
    detMs?: number;
    recMs?: number;
    totalMs?: number;
    detectedBoxes?: number;
    recognizedCount?: number;
  };
  runtime?: Record<string, unknown>;
}

interface PaddleOcrEngine {
  predict: (
    image: Blob | HTMLCanvasElement | HTMLImageElement,
    params?: Record<string, number | string | boolean>
  ) => Promise<PaddleOcrResult[]>;
  dispose: () => void;
}

interface PaddleOcrModule {
  PaddleOCR: {
    create: (options: Record<string, unknown>) => Promise<PaddleOcrEngine>;
  };
}

interface OcrAttempt {
  source: OcrSource;
  rawText: string;
  confidence: number | null;
  candidates: string[];
  recognizedLines: Array<{ text: string; score: number; top: number }>;
  metrics?: PaddleOcrResult["metrics"];
}

interface DraftCard {
  key: string;
  entryMethod: CardEntryMethod;
  rawOcrText: string;
  ocrCandidates: string[];
  ocrAttempts: OcrAttempt[];
  matchedCandidate: string;
  cardName: string;
  selectedCard: ScryfallCardOption | null;
  printOptions: ScryfallCardOption[];
  showPrints: boolean;
  showOptions: boolean;
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
  tabLabel?: string;
  busy: boolean;
  standalone?: boolean;
  onCompleted: (tab: TabDetail) => void;
  onCancel?: () => void;
}

const conditions: CardCondition[] = ["NM", "SP", "MP", "HP", "D"];
const finishes: Array<{ value: Finish; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "foil", label: "Foil" },
  { value: "etched", label: "Etched" }
];

const PADDLE_OCR_MODULE_URL =
  "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm";
const ONNX_WASM_PATHS =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";

let sharedPaddleOcr: PaddleOcrEngine | null = null;
let sharedPaddleOcrPromise: Promise<PaddleOcrEngine> | null = null;

function createDraftCard(index: number): DraftCard {
  return {
    key: `${Date.now()}_${index}_${Math.random()}`,
    entryMethod: "camera",
    rawOcrText: "",
    ocrCandidates: [],
    ocrAttempts: [],
    matchedCandidate: "",
    cardName: "",
    selectedCard: null,
    printOptions: [],
    showPrints: false,
    showOptions: false,
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

async function resizeWithoutVisualTreatment(
  source: HTMLImageElement | HTMLVideoElement,
  sourceWidth: number,
  sourceHeight: number,
  maxSide = 1600,
  quality = 0.9
): Promise<string> {
  let scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  let result = "";
  let currentQuality = quality;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Seu navegador não conseguiu preparar a fotografia.");

    // A imagem principal é apenas redimensionada/comprimida. Nenhum filtro de
    // brilho, contraste ou cor é aplicado antes da primeira tentativa do OCR.
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    result = canvas.toDataURL("image/jpeg", currentQuality);

    if (result.length <= 700_000) return result;
    currentQuality = Math.max(0.5, currentQuality - 0.07);
    if (attempt >= 3) scale *= 0.9;
  }

  if (result.length > 780_000) {
    throw new Error("A fotografia ficou muito grande. Aproxime a carta e tente novamente.");
  }
  return result;
}

async function compressPhoto(file: File): Promise<string> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    return resizeWithoutVisualTreatment(
      image,
      image.naturalWidth,
      image.naturalHeight
    );
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("A fotografia não pôde ser preparada para leitura.");

  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: match[1] });
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

function candidateVariants(line: string): string[] {
  const variants = [line];
  const withoutTrailingMana = line
    .replace(/\s+(?:\d+\s*)?(?:[WUBRGCXYZ]\s*){1,4}$/i, "")
    .replace(/\s+\d{1,3}$/i, "")
    .trim();

  if (withoutTrailingMana.length >= 2 && withoutTrailingMana !== line) {
    variants.push(withoutTrailingMana);
  }
  return variants;
}

interface PositionedOcrItem {
  text: string;
  score: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerY: number;
  height: number;
}

function getPositionedItem(item: PaddleOcrItem): PositionedOcrItem | null {
  const points = Array.isArray(item.poly) ? item.poly : [];
  if (!item.text?.trim() || points.length < 2) return null;

  const xs = points.map((point) => Number(point[0])).filter(Number.isFinite);
  const ys = points.map((point) => Number(point[1])).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;

  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const height = Math.max(1, bottom - top);

  return {
    text: item.text.trim(),
    score: Number.isFinite(item.score) ? item.score : 0,
    left,
    top,
    right,
    bottom,
    centerY: top + height / 2,
    height
  };
}

function groupPaddleLines(result: PaddleOcrResult) {
  const positioned = result.items
    .map(getPositionedItem)
    .filter((item): item is PositionedOcrItem => Boolean(item))
    .filter((item) => item.score >= 0.16)
    .sort((left, right) => left.top - right.top || left.left - right.left);

  const groups: PositionedOcrItem[][] = [];
  for (const item of positioned) {
    let bestGroup: PositionedOcrItem[] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const group of groups) {
      const center = group.reduce((sum, current) => sum + current.centerY, 0) / group.length;
      const averageHeight = group.reduce((sum, current) => sum + current.height, 0) / group.length;
      const distance = Math.abs(item.centerY - center);
      const tolerance = Math.max(10, Math.min(item.height, averageHeight) * 0.78);
      if (distance <= tolerance && distance < bestDistance) {
        bestGroup = group;
        bestDistance = distance;
      }
    }

    if (bestGroup) bestGroup.push(item);
    else groups.push([item]);
  }

  return groups
    .map((group) => {
      const ordered = [...group].sort((left, right) => left.left - right.left);
      const text = ordered.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
      const totalWeight = ordered.reduce((sum, item) => sum + Math.max(1, item.text.length), 0);
      const score = ordered.reduce(
        (sum, item) => sum + item.score * Math.max(1, item.text.length),
        0
      ) / totalWeight;
      const top = Math.min(...ordered.map((item) => item.top));
      const left = Math.min(...ordered.map((item) => item.left));

      return {
        text,
        score,
        top,
        left,
        topRatio: result.image.height > 0 ? top / result.image.height : 1
      };
    })
    .filter((line) => line.text.length > 0)
    .sort((left, right) => left.top - right.top || left.left - right.left);
}

function isPlausibleCardName(line: string): boolean {
  if (line.length < 2 || line.length > 90 || !/[A-Za-zÀ-ÿ]{2}/.test(line)) return false;

  const words = line.split(" ").filter(Boolean);
  const oneCharacterWords = words.filter((word) => word.length === 1).length;
  const letterCount = (line.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;

  if (words.length >= 3 && oneCharacterWords >= Math.ceil(words.length / 2)) return false;
  if (letterCount < Math.max(2, Math.floor(line.length * 0.38))) return false;
  if (/^(copyright|illustrated by|artist|collector|wizards of the coast)$/i.test(line)) return false;
  if (/^(creature|artifact|instant|sorcery|enchantment|land|planeswalker|battle)\b/i.test(line)) return false;
  return true;
}

function extractPaddleCandidates(result: PaddleOcrResult) {
  const visualLines = groupPaddleLines(result);
  const prioritized = [
    ...visualLines.filter((line) => line.topRatio <= 0.42),
    ...visualLines.filter((line) => line.topRatio > 0.42)
  ];
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const visualLine of prioritized) {
    const normalized = normalizeOcrLine(visualLine.text);
    if (!isPlausibleCardName(normalized)) continue;

    for (const variant of candidateVariants(normalized)) {
      const key = variant.toLocaleLowerCase("en-US");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(variant);
      if (candidates.length >= 12) break;
    }
    if (candidates.length >= 12) break;
  }

  const confidence = visualLines.length
    ? visualLines.reduce((sum, line) => sum + line.score, 0) / visualLines.length * 100
    : null;

  return {
    rawText: visualLines.map((line) => line.text).join("\n"),
    candidates,
    confidence,
    recognizedLines: visualLines.map((line) => ({
      text: line.text,
      score: line.score,
      top: line.topRatio
    }))
  };
}

async function composeOrderPhoto(cards: DraftCard[]): Promise<string | null> {
  const photos = cards
    .map((card) => card.photoDataUrl)
    .filter((value): value is string => Boolean(value));
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

export function CardOrderFlow({
  tabId,
  tabLabel,
  busy,
  standalone = false,
  onCompleted,
  onCancel
}: CardOrderFlowProps) {
  const [folders, setFolders] = useState<CardFolder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [confirmedCards, setConfirmedCards] = useState<DraftCard[]>([]);
  const [pendingCards, setPendingCards] = useState<DraftCard[]>([]);
  const [currentCard, setCurrentCard] = useState<DraftCard>(() => createDraftCard(0));
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [flowStarted, setFlowStarted] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraStatus, setCameraStatus] = useState("Posicione a carta e toque em Capturar carta.");
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrPreparing, setOcrPreparing] = useState(false);
  const [ocrReady, setOcrReady] = useState(Boolean(sharedPaddleOcr));
  const [ocrProgress, setOcrProgress] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureLockRef = useRef(false);
  const priceInputRef = useRef<HTMLInputElement | null>(null);
  const awaitingPriceFocusRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const manualNameInputRef = useRef<HTMLInputElement | null>(null);

  const debugEnabled = useMemo(
    () => new URLSearchParams(window.location.search).get("cardDebug") === "1",
    []
  );

  useEffect(() => {
    listCardFolders()
      .then((result) => {
        setFolders(result);
        if (result[0]) setFolderId(result[0].id);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível carregar as pastas."))
      .finally(() => setLoadingFolders(false));
  }, []);

  useEffect(() => {
    const focusPriceAfterReturn = () => {
      if (document.visibilityState === "visible" && awaitingPriceFocusRef.current) {
        awaitingPriceFocusRef.current = false;
        window.setTimeout(() => priceInputRef.current?.focus(), 220);
      }
    };
    document.addEventListener("visibilitychange", focusPriceAfterReturn);
    return () => document.removeEventListener("visibilitychange", focusPriceAfterReturn);
  }, []);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!flowStarted || streamRef.current) return;
    const timer = window.setTimeout(() => void startCamera(), 0);
    return () => window.clearTimeout(timer);
  }, [flowStarted]);

  useEffect(() => {
    if (ocrReady) return;

    let active = true;
    setOcrPreparing(true);
    setOcrProgress("Preparando o leitor em segundo plano…");
    void getPaddleOcr()
      .then(() => {
        if (!active) return;
        setOcrReady(true);
        setOcrProgress("Leitor pronto.");
      })
      .catch((caught) => {
        if (!active) return;
        setOcrProgress("");
        setError(caught instanceof Error ? caught.message : "O leitor não pôde ser preparado.");
      })
      .finally(() => {
        if (active) setOcrPreparing(false);
      });

    return () => {
      active = false;
    };
  }, [ocrReady]);

  useEffect(() => {
    if (
      !flowStarted ||
      currentCard.photoDataUrl ||
      !streamRef.current ||
      !videoRef.current
    ) return;

    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => undefined);
  }, [cameraActive, currentCard.photoDataUrl, flowStarted]);

  useEffect(() => {
    if (currentCard.entryMethod !== "manual" || currentCard.selectedCard) return;
    const timer = window.setTimeout(() => manualNameInputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [currentCard.entryMethod, currentCard.selectedCard]);

  const totalCents = useMemo(
    () => confirmedCards.reduce((total, card) => {
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

  async function startCamera() {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("A câmera não está disponível neste navegador. Use uma foto ou a inclusão manual.");
      return;
    }

    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setCameraStatus("Posicione a carta e toque em Capturar carta.");
    } catch {
      setCameraActive(false);
      setCameraError("Não foi possível abrir a câmera. Confira a permissão ou escolha uma foto.");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  async function getPaddleOcr(): Promise<PaddleOcrEngine> {
    if (sharedPaddleOcr) return sharedPaddleOcr;

    if (!sharedPaddleOcrPromise) {
      setOcrProgress("Preparando o PaddleOCR pela primeira vez…");
      sharedPaddleOcrPromise = (async () => {
        let paddleModule: PaddleOcrModule;
        try {
          paddleModule = await import(
            /* @vite-ignore */ PADDLE_OCR_MODULE_URL
          ) as PaddleOcrModule;
        } catch {
          throw new Error(
            "O leitor PaddleOCR não carregou. Confira a internet ou digite o nome manualmente."
          );
        }

        return paddleModule.PaddleOCR.create({
          textDetectionModelName: "PP-OCRv5_mobile_det",
          textRecognitionModelName: "PP-OCRv5_mobile_rec",
          textDetectionBatchSize: 1,
          textRecognitionBatchSize: 6,
          worker: false,
          ortOptions: {
            backend: "auto",
            wasmPaths: ONNX_WASM_PATHS,
            numThreads: window.crossOriginIsolated
              ? Math.min(2, Math.max(1, navigator.hardwareConcurrency || 1))
              : 1,
            simd: true
          }
        });
      })().catch((error) => {
        sharedPaddleOcrPromise = null;
        throw error;
      });
    }

    sharedPaddleOcr = await sharedPaddleOcrPromise;
    return sharedPaddleOcr;
  }

  async function findScryfallMatch(candidates: string[]) {
    for (const candidate of candidates.slice(0, 5)) {
      setOcrProgress(`Conferindo “${candidate}” no Scryfall…`);
      try {
        return {
          card: await resolveScryfallCard(candidate),
          candidate
        };
      } catch {
        // A próxima linha plausível será tentada automaticamente.
      }
    }
    return null;
  }

  async function runPaddleAttempt(
    engine: PaddleOcrEngine,
    photoBlob: Blob,
    source: OcrSource,
    detailed = false
  ): Promise<OcrAttempt> {
    const [result] = await engine.predict(photoBlob, detailed
      ? {
          textDetLimitSideLen: 1440,
          textDetLimitType: "max",
          textDetMaxSideLimit: 1800,
          textDetThresh: 0.18,
          textDetBoxThresh: 0.3,
          textDetUnclipRatio: 1.65,
          textRecScoreThresh: 0.12
        }
      : {
          textDetLimitSideLen: 1120,
          textDetLimitType: "max",
          textDetMaxSideLimit: 1440,
          textDetThresh: 0.25,
          textDetBoxThresh: 0.45,
          textRecScoreThresh: 0.25
        }
    );

    if (!result) {
      return {
        source,
        rawText: "",
        confidence: null,
        candidates: [],
        recognizedLines: []
      };
    }

    const extracted = extractPaddleCandidates(result);
    return {
      source,
      rawText: extracted.rawText,
      confidence: extracted.confidence,
      candidates: extracted.candidates,
      recognizedLines: extracted.recognizedLines,
      metrics: result.metrics
    };
  }

  async function analyzePhoto(photoDataUrl: string, detailed = false) {
    setOcrRunning(true);
    setError("");
    setCurrentCard((current) => ({
      ...current,
      entryMethod: "camera",
      photoDataUrl,
      rawOcrText: detailed ? current.rawOcrText : "",
      ocrCandidates: detailed ? current.ocrCandidates : [],
      ocrAttempts: detailed ? current.ocrAttempts : [],
      matchedCandidate: "",
      cardName: detailed ? current.cardName : "",
      selectedCard: null,
      printOptions: [],
      showPrints: false,
      error: ""
    }));

    try {
      const engine = await getPaddleOcr();
      setOcrReady(true);
      const photoBlob = dataUrlToBlob(photoDataUrl);

      setOcrProgress(
        detailed
          ? "Executando uma leitura detalhada da mesma fotografia…"
          : "Lendo a fotografia e procurando o nome da carta…"
      );

      const attempt = await runPaddleAttempt(
        engine,
        photoBlob,
        detailed ? "paddle-detailed" : "paddle-default",
        detailed
      );

      const previousAttempts = detailed ? currentCard.ocrAttempts : [];
      const attempts = [...previousAttempts, attempt];
      const previousCandidates = detailed ? currentCard.ocrCandidates : [];
      const candidates = Array.from(new Set([...previousCandidates, ...attempt.candidates]));
      const candidatesToCheck = attempt.candidates.filter(
        (candidate) => !previousCandidates.some(
          (existing) => existing.toLocaleLowerCase("en-US") === candidate.toLocaleLowerCase("en-US")
        )
      );
      const match = await findScryfallMatch(candidatesToCheck);

      if (match) {
        setCurrentCard((current) => ({
          ...current,
          entryMethod: "camera",
          photoDataUrl,
          rawOcrText: attempt.rawText || current.rawOcrText,
          ocrCandidates: candidates,
          ocrAttempts: attempts,
          matchedCandidate: match.candidate,
          cardName: match.card.name,
          selectedCard: match.card,
          printOptions: [],
          showPrints: false,
          searching: false,
          error: ""
        }));
        setOcrProgress(
          `Leitura concluída: “${match.card.name}”.`
        );
      } else {
        const firstCandidate = candidates[0] ?? "";
        setCurrentCard((current) => ({
          ...current,
          entryMethod: "camera",
          photoDataUrl,
          rawOcrText: attempt.rawText || current.rawOcrText,
          ocrCandidates: candidates,
          ocrAttempts: attempts,
          matchedCandidate: "",
          cardName: current.cardName || firstCandidate,
          selectedCard: null,
          searching: false,
          error: firstCandidate
            ? "Não confirmamos automaticamente a carta. Pesquise pelo nome, tente a leitura detalhada ou fotografe novamente."
            : "Não encontramos um nome utilizável. Adicione pelo nome, tente a leitura detalhada ou fotografe novamente."
        }));
        setOcrProgress(
          detailed
            ? "A leitura detalhada terminou sem uma correspondência segura."
            : "Leitura rápida concluída sem correspondência segura."
        );
      }
    } catch (caught) {
      setCurrentCard((current) => ({
        ...current,
        entryMethod: "camera",
        photoDataUrl,
        error: "A leitura automática não concluiu. Você ainda pode adicionar a carta pelo nome."
      }));
      setError(caught instanceof Error ? caught.message : "A leitura automática não concluiu.");
    } finally {
      setOcrRunning(false);
      captureLockRef.current = false;
    }
  }

  async function captureFromVideo() {
    if (captureLockRef.current || ocrRunning || currentCard.photoDataUrl) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    captureLockRef.current = true;
    setCameraStatus("Fotografia capturada. Lendo automaticamente…");
    try {
      const photoDataUrl = await resizeWithoutVisualTreatment(
        video,
        video.videoWidth,
        video.videoHeight
      );
      await analyzePhoto(photoDataUrl);
    } catch (caught) {
      captureLockRef.current = false;
      setError(caught instanceof Error ? caught.message : "Não foi possível capturar a carta.");
    }
  }

  async function handleFilePhoto(file: File | undefined) {
    if (!file) return;
    setError("");
    captureLockRef.current = true;
    try {
      const photoDataUrl = await compressPhoto(file);
      await analyzePhoto(photoDataUrl);
    } catch (caught) {
      captureLockRef.current = false;
      setError(caught instanceof Error ? caught.message : "Não foi possível preparar a fotografia.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
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
        showPrints: false,
        error: ""
      });
      setOcrProgress(`Carta definida como “${result.name}”.`);
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
      updateCurrentCard({ searching: false, printOptions: prints, showPrints: true });
    } catch (caught) {
      updateCurrentCard({
        searching: false,
        error: caught instanceof Error ? caught.message : "Não foi possível carregar as edições."
      });
    }
  }

  function resetForNextCard() {
    setCurrentCard(createDraftCard(confirmedCards.length + pendingCards.length + 1));
    setOcrProgress("");
    setReviewOpen(false);
    captureLockRef.current = false;
    setCameraStatus("Posicione a próxima carta e toque em Capturar carta.");
  }

  function beginManualEntry() {
    const manualCard = createDraftCard(confirmedCards.length + pendingCards.length + 1);
    manualCard.entryMethod = "manual";
    setCurrentCard(manualCard);
    setOcrProgress("Digite o nome e pesquise no Scryfall.");
    setReviewOpen(false);
    setError("");
  }

  function focusManualName() {
    manualNameInputRef.current?.focus();
    manualNameInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function confirmAndNext() {
    setError("");
    const unitPriceCents = parseMoneyToCents(currentCard.priceText);

    if (currentCard.entryMethod === "camera" && !currentCard.photoDataUrl) {
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
    resetForNextCard();
  }

  function deferCurrentCard() {
    if (!currentCard.photoDataUrl) return;
    setPendingCards((current) => [...current, currentCard]);
    resetForNextCard();
  }

  function editConfirmed(card: DraftCard) {
    setConfirmedCards((current) => current.filter((item) => item.key !== card.key));
    setCurrentCard({ ...card, error: "" });
    setReviewOpen(false);
    setOcrProgress("Edite a carta e confirme novamente.");
  }

  function reviewPending(card: DraftCard) {
    setPendingCards((current) => current.filter((item) => item.key !== card.key));
    setCurrentCard({ ...card, error: card.error || "Revise o nome desta carta." });
    setReviewOpen(false);
    setOcrProgress("Pendência aberta para revisão.");
  }

  async function beginFlow() {
    if (!folderId) {
      setError("Selecione a pasta antes de iniciar a leitura.");
      return;
    }
    setError("");
    setFlowStarted(true);
  }

  async function finalize() {
    setError("");
    if (!folderId) {
      setError("Selecione a pasta das cartas.");
      return;
    }
    if (pendingCards.length > 0) {
      setReviewOpen(true);
      setError("Resolva ou remova as cartas pendentes antes de finalizar.");
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
      const updated = await createCardOrder(tabId, { folderId, photoDataUrl, items });
      stopCamera();
      onCompleted(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível adicionar as cartas.");
    } finally {
      setSaving(false);
    }
  }

  const selectedFolder = folders.find((folder) => folder.id === folderId);
  const currentPriceCents = parseMoneyToCents(currentCard.priceText);
  const isCameraStep =
    currentCard.entryMethod === "camera" &&
    !currentCard.photoDataUrl &&
    !ocrRunning;
  const containerClass = `${standalone
    ? "card-order-flow card-order-flow--standalone"
    : "drawer-scroll card-order-flow"}${isCameraStep ? " card-order-flow--camera-step" : ""}`;

  if (!flowStarted) {
    return (
      <div className={containerClass}>
        {error && <div className="inline-error">{error}</div>}
        <section className="card-setup-card">
          <div className="scanner-version">Scanner de balcão · versão 6.2</div>
          <span className="eyebrow">Venda de cartas</span>
          <h2>Prepare o atendimento</h2>
          <p>
            Confirme a comanda e escolha a pasta uma única vez. Depois, fotografe ou adicione cada carta manualmente sem sair do atendimento.
          </p>

          {tabLabel && (
            <div className="card-context-choice">
              <span>Comanda</span>
              <strong>{tabLabel}</strong>
            </div>
          )}

          <label className="field">
            <span>Pasta de origem</span>
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

          <details className="secondary-settings">
            <summary>Cadastrar outra pasta</summary>
            <div className="folder-create-row">
              <input
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="Ex.: Multicoloridas"
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
          </details>

          <button className="button button--primary button--full" onClick={beginFlow} disabled={!folderId}>
            <Camera size={18} /> Iniciar atendimento de cartas
          </button>
          {onCancel && (
            <button type="button" className="text-button card-cancel-link" onClick={onCancel}>
              Cancelar
            </button>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <header className="scanner-context-bar">
        <div>
          <small>Scanner de balcão · PaddleOCR v6.2</small>
          <span>{tabLabel ?? "Comanda selecionada"}</span>
          <strong>{selectedFolder?.name ?? "Pasta"}</strong>
        </div>
        <div>
          <span>{confirmedQuantity} cartas</span>
          <strong>{formatMoney(totalCents)}</strong>
        </div>
        {onCancel && (
          <button
            type="button"
            className="scanner-exit-button"
            onClick={() => {
              stopCamera();
              onCancel();
            }}
          >
            Sair
          </button>
        )}
      </header>

      {error && <div className="inline-error">{error}</div>}

      {currentCard.entryMethod === "camera" && !currentCard.photoDataUrl && !ocrRunning && (
        <section className="scanner-camera-card">
          <div className="scanner-title-row">
            <div>
              <span className="eyebrow">Carta {confirmedCards.length + pendingCards.length + 1}</span>
              <h2>Posicione a carta</h2>
            </div>
            <span className={`reader-status ${ocrReady ? "reader-status--ready" : ""}`}>
              {ocrReady ? "Leitor pronto" : ocrPreparing ? "Preparando leitor…" : "Leitor sob demanda"}
            </span>
          </div>

          <div className="live-camera-frame">
            <video ref={videoRef} autoPlay muted playsInline />
            {!cameraActive && (
              <div className="camera-placeholder">
                <Camera size={34} />
                <span>Câmera não iniciada</span>
              </div>
            )}
          </div>

          <p className="camera-status">{cameraStatus}</p>
          {cameraError && <small className="card-error">{cameraError}</small>}

          <div className="camera-secondary-actions">
            <button className="text-button" onClick={() => fileInputRef.current?.click()}>
              <Upload size={16} /> Escolher uma foto
            </button>
          </div>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(event) => void handleFilePhoto(event.target.files?.[0])}
          />
        </section>
      )}

      {ocrRunning && currentCard.photoDataUrl && (
        <section className="scanner-processing-card">
          <img src={currentCard.photoDataUrl} alt="Carta capturada" />
          <div>
            <LoaderCircle className="spin" size={28} />
            <strong>Lendo com PaddleOCR</strong>
            <span>{ocrProgress || "Extraindo os textos e consultando o Scryfall…"}</span>
          </div>
        </section>
      )}

      {(currentCard.photoDataUrl || currentCard.entryMethod === "manual") && !ocrRunning && (
        <section className="scanner-result-card">
          <div className="scanner-title-row">
            <div>
              <span className="eyebrow">
                {currentCard.entryMethod === "manual" ? "Inclusão manual" : "Conferência"}
              </span>
              <h2>
                {currentCard.selectedCard
                  ? "Confira e informe o preço"
                  : currentCard.entryMethod === "manual"
                    ? "Pesquise a carta pelo nome"
                    : "Revise a identificação"}
              </h2>
            </div>
            <button type="button" className="text-button" onClick={resetForNextCard}>
              {currentCard.entryMethod === "manual" ? "Voltar para câmera" : "Fotografar novamente"}
            </button>
          </div>

          <div className={`recognition-comparison ${currentCard.entryMethod === "manual" ? "recognition-comparison--manual" : ""}`}>
            {currentCard.entryMethod === "camera" && currentCard.photoDataUrl && (
              <figure>
                <img src={currentCard.photoDataUrl} alt="Fotografia original" />
                <figcaption>Foto original</figcaption>
              </figure>
            )}
            <figure>
              {currentCard.selectedCard?.imageUrl ? (
                <img src={currentCard.selectedCard.imageUrl} alt={currentCard.selectedCard.name} />
              ) : (
                <div className="card-result-placeholder"><Search size={26} /></div>
              )}
              <figcaption>{currentCard.selectedCard ? "Scryfall" : "Pesquise pelo nome"}</figcaption>
            </figure>
          </div>

          <label className="field">
            <span>Nome da carta</span>
            <div className="card-search-row">
              <input
                ref={manualNameInputRef}
                value={currentCard.cardName}
                onChange={(event) => updateCurrentCard({
                  cardName: event.target.value,
                  selectedCard: null,
                  error: ""
                })}
                placeholder={currentCard.entryMethod === "manual" ? "Ex.: Sol Ring" : "Digite ou corrija o nome"}
              />
              <button
                type="button"
                className="icon-button"
                disabled={currentCard.searching || currentCard.cardName.trim().length < 2}
                aria-label="Buscar no Scryfall"
                onClick={() => void searchCurrentCard()}
              >
                {currentCard.searching ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}
              </button>
            </div>
          </label>

          {currentCard.selectedCard && (
            <div className="recognized-card-banner">
              <Check size={18} />
              <div>
                <strong>{currentCard.selectedCard.name}</strong>
                <span>{currentCard.selectedCard.setName} · #{currentCard.selectedCard.collectorNumber}</span>
              </div>
              <button type="button" onClick={() => void openPrints()}>Trocar edição</button>
            </div>
          )}

          {currentCard.showPrints && (
            <div className="print-picker print-picker--large">
              {currentCard.printOptions.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  className={currentCard.selectedCard?.id === option.id ? "selected" : ""}
                  onClick={() => updateCurrentCard({
                    selectedCard: option,
                    cardName: option.name,
                    showPrints: false,
                    error: ""
                  })}
                >
                  {option.imageUrl ? <img src={option.imageUrl} alt="" /> : <span>Sem imagem</span>}
                  <small>{option.setCode.toUpperCase()} · #{option.collectorNumber}</small>
                </button>
              ))}
            </div>
          )}

          {currentCard.error && <small className="card-error">{currentCard.error}</small>}
          {ocrProgress && <small className="field-hint">{ocrProgress}</small>}

          {!currentCard.selectedCard && currentCard.ocrCandidates.length > 0 && (
            <div className="ocr-candidate-actions">
              <span>Linhas reconhecidas</span>
              <div>
                {currentCard.ocrCandidates.slice(0, 6).map((candidate) => (
                  <button
                    type="button"
                    key={candidate}
                    onClick={() => void searchCurrentCard(candidate)}
                  >
                    {candidate}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(debugEnabled || currentCard.rawOcrText) && (
            <details className="ocr-debug-panel">
              <summary>Ver diagnóstico da leitura</summary>
              {currentCard.ocrAttempts.map((attempt, index) => (
                <div key={`${attempt.source}_${index}`}>
                  <strong>
                    {attempt.source === "paddle-default"
                      ? "PaddleOCR · leitura rápida da foto original"
                      : "PaddleOCR · leitura detalhada solicitada"}
                    {attempt.confidence !== null ? ` · confiança média ${Math.round(attempt.confidence)}%` : ""}
                  </strong>
                  {attempt.metrics?.totalMs !== undefined && (
                    <small>
                      {Math.round(attempt.metrics.totalMs)} ms · {attempt.metrics.recognizedCount ?? attempt.recognizedLines.length} linhas
                    </small>
                  )}
                  <pre>{attempt.rawText || "Nenhum texto extraído."}</pre>
                  {debugEnabled && attempt.recognizedLines.length > 0 && (
                    <div className="ocr-position-debug">
                      {attempt.recognizedLines.map((line, lineIndex) => (
                        <span key={`${attempt.source}_${lineIndex}_${line.text}`}>
                          topo {Math.round(line.top * 100)}% · {Math.round(line.score * 100)}% · {line.text}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </details>
          )}

          {currentCard.selectedCard && (
            <>
              <div className="price-focus-card">
                <a
                  className="button liga-button"
                  href={buildLigaMagicUrl(currentCard.cardName)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    awaitingPriceFocusRef.current = true;
                    navigator.clipboard?.writeText(currentCard.cardName).catch(() => undefined);
                  }}
                >
                  <ExternalLink size={17} /> Abrir na LigaMagic
                </a>
                <label className="field money-field">
                  <span>Valor unitário</span>
                  <input
                    ref={priceInputRef}
                    inputMode="decimal"
                    value={currentCard.priceText}
                    onChange={(event) => updateCurrentCard({
                      priceText: event.target.value.replace(/[^\d,.]/g, "")
                    })}
                    placeholder="0,00"
                  />
                </label>
              </div>

              <details
                className="secondary-settings"
                open={currentCard.showOptions}
                onToggle={(event) => updateCurrentCard({
                  showOptions: (event.currentTarget as HTMLDetailsElement).open
                })}
              >
                <summary>
                  <Settings2 size={16} /> {currentCard.condition} · {finishes.find((item) => item.value === currentCard.finish)?.label} · {currentCard.quantity} unidade
                </summary>
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
                    <span>Quantidade</span>
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
                </div>
              </details>

              <button
                type="button"
                className="button button--primary button--full scanner-next-button"
                disabled={currentPriceCents < 0}
                onClick={confirmAndNext}
              >
                <Check size={18} />
                {currentPriceCents >= 0
                  ? `Confirmar ${formatMoney(currentPriceCents * currentCard.quantity)} e ler próxima`
                  : "Informe o preço para continuar"
                }
              </button>
            </>
          )}

          {!currentCard.selectedCard && currentCard.entryMethod === "camera" && (
            <div className="unresolved-actions">
              <button
                className="button button--primary"
                onClick={focusManualName}
              >
                <Search size={17} /> Adicionar pelo nome
              </button>
              <button
                className="button"
                disabled={ocrRunning}
                onClick={() => void analyzePhoto(currentCard.photoDataUrl!, true)}
              >
                <RefreshCw size={17} /> Tentar leitura detalhada
              </button>
              <button className="button" onClick={deferCurrentCard}>
                Deixar pendente e continuar
              </button>
            </div>
          )}
        </section>
      )}

      {reviewOpen && (
        <section className="scanner-review-panel">
          <div className="scanner-title-row">
            <div>
              <span className="eyebrow">Lote</span>
              <h2>Revise antes de finalizar</h2>
            </div>
            <button className="text-button" onClick={() => setReviewOpen(false)}>Fechar</button>
          </div>

          {confirmedCards.length === 0 && pendingCards.length === 0 && (
            <p className="card-help">Nenhuma carta adicionada ainda.</p>
          )}

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
                    <small>{card.selectedCard?.setCode.toUpperCase()} · #{card.selectedCard?.collectorNumber} · {card.condition}</small>
                    <span>{card.quantity} × {formatMoney(unitPriceCents)}</span>
                  </div>
                  <div className="review-item-actions">
                    <button type="button" onClick={() => editConfirmed(card)}>Editar</button>
                    <button
                      type="button"
                      aria-label={`Remover ${card.cardName}`}
                      onClick={() => setConfirmedCards((current) => current.filter((item) => item.key !== card.key))}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              );
            })}

            {pendingCards.map((card, index) => (
              <article className="confirmed-card confirmed-card--pending" key={card.key}>
                {card.photoDataUrl ? <img src={card.photoDataUrl} alt="" /> : <div className="confirmed-card__empty" />}
                <div>
                  <strong>Pendente {index + 1}</strong>
                  <small>{card.cardName || "Nome não identificado"}</small>
                  <span>Precisa de revisão</span>
                </div>
                <div className="review-item-actions">
                  <button type="button" onClick={() => reviewPending(card)}>Resolver</button>
                  <button
                    type="button"
                    aria-label="Remover pendência"
                    onClick={() => setPendingCards((current) => current.filter((item) => item.key !== card.key))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <footer className={`scanner-sticky-footer ${isCameraStep ? "scanner-sticky-footer--capture" : ""}`}>
        {isCameraStep ? (
          <>
            <div className="scanner-capture-footer-summary">
              <button
                type="button"
                className="scanner-lot-summary"
                onClick={() => setReviewOpen((current) => !current)}
              >
                <span>{confirmedQuantity} cartas{pendingCards.length > 0 ? ` · ${pendingCards.length} pendentes` : ""}</span>
                <strong>{formatMoney(totalCents)}</strong>
                <small>Ver lote</small>
              </button>
              <button
                type="button"
                className="scanner-finish-compact"
                disabled={busy || saving || confirmedCards.length === 0 || pendingCards.length > 0}
                onClick={finalize}
              >
                {saving ? "Finalizando…" : "Finalizar"}
              </button>
            </div>
            <div className="scanner-fixed-capture-actions">
              <button
                type="button"
                className="button button--primary scanner-fixed-capture-button"
                onClick={() => cameraActive ? void captureFromVideo() : void startCamera()}
              >
                <Camera size={20} />
                {cameraActive ? "Capturar carta" : "Abrir câmera"}
              </button>
              <button
                type="button"
                className="button scanner-manual-button"
                onClick={beginManualEntry}
              >
                <Plus size={19} /> Manual
              </button>
            </div>
          </>
        ) : (
          <>
            <button type="button" className="scanner-lot-summary" onClick={() => setReviewOpen((current) => !current)}>
              <span>{confirmedQuantity} cartas{pendingCards.length > 0 ? ` · ${pendingCards.length} pendentes` : ""}</span>
              <strong>{formatMoney(totalCents)}</strong>
              <small>Ver lote</small>
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={busy || saving || confirmedCards.length === 0 || pendingCards.length > 0}
              onClick={finalize}
            >
              {saving ? "Finalizando…" : "Finalizar lote"}
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
