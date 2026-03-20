import { useState, useCallback, useRef, useEffect, useReducer } from "react";
import { useDealPersistence, Deal } from "./useDealPersistence";
import type { LoadedDealData } from "./useDealPersistence";
import { isSupabaseConfigured } from "./supabaseClient";
import { useDropzone } from "react-dropzone";
import { Document, Page } from "react-pdf";
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import axios from "axios";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  AreaChart, Area, ScatterChart, Scatter, ComposedChart,
  RadarChart, Radar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
} from 'recharts';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// ── IndexedDB file cache ──────────────────────────────────────
// Persists File binaries across page refreshes, keyed by deal ID.
const IDB_NAME = 'cim-deal-files';
const IDB_STORE = 'files';

function openFileDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveFilesToIDB(dealId: string, files: File[]): Promise<void> {
  if (!files.length) return;
  try {
    const db = await openFileDB();
    const serialized = await Promise.all(
      files.map(async f => ({ name: f.name, type: f.type, buffer: await f.arrayBuffer() }))
    );
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(serialized, dealId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch (err) {
    console.warn('[IDB] saveFiles failed:', err);
  }
}

async function loadFilesFromIDB(dealId: string): Promise<File[] | null> {
  try {
    const db = await openFileDB();
    const result = await new Promise<any>((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(dealId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!result) return null;
    return (result as any[]).map(f => new File([f.buffer], f.name, { type: f.type }));
  } catch (err) {
    console.warn('[IDB] loadFiles failed:', err);
    return null;
  }
}

async function deleteFilesFromIDB(dealId: string): Promise<void> {
  try {
    const db = await openFileDB();
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(dealId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch (err) {
    console.warn('[IDB] deleteFiles failed:', err);
  }
}

// ── Brand ────────────────────────────────────────────────────
const RED    = "#913d3e";
const NAVY   = "#1a1a1a";
const OFFWHITE = "#f8f6f3";

// ── Types ────────────────────────────────────────────────────
interface Source { title: string; url: string; }

interface Claim {
  id: number;
  claim: string;
  page: number;
  category: string;
  verifiable: boolean;
  verdict: "verified" | "disputed" | "unverifiable";
  explanation: string;
  sources: Source[];
  confidence: number;
  materiality: "high" | "medium" | "low";
  why_it_matters: string;
  diligence_question: string;
}

interface Assessment {
  overall_verdict: "Worth deeper look" | "Borderline" | "Pass";
  company_snapshot: string;
  sellers_narrative: string;
  narrative_holds_up: { holds: boolean; explanation: string };
  reasoning: string;
  criteria_fit?: { fits: boolean; explanation: string };
  top_risks: string[];
  bull_case: string;
  key_questions: string[];
  summary_stats: { verified: number; disputed: number; unverifiable: number };
}

interface CrossDocumentConflict {
  doc1: string; doc2: string;
  claim1: string; claim2: string;
  severity: "high" | "medium" | "low";
  explanation: string;
}

interface AnalysisResult {
  assessment: Assessment;
  claims: Claim[];
  cross_document_conflicts: CrossDocumentConflict[];
  document_text?: string;
  charts_data?: any;
  documents_text?: Record<string, string>;
}

interface CompTransaction {
  company: string;
  acquirer: string;
  date: string;
  ev_millions: number | null;
  ev_ebitda: number | null;
  ev_revenue: number | null;
  why_comparable: string;
  key_difference: string;
  source_url: string | null;
}

interface CompsData {
  deal_profile: {
    sector: string;
    sub_sector: string;
    description: string;
    revenue_millions: number | null;
    ebitda_millions: number | null;
    ebitda_margin_pct: number | null;
    geography: string;
    business_model: string;
  };
  comps: CompTransaction[];
  sector_context: {
    typical_ev_ebitda_low: number;
    typical_ev_ebitda_high: number;
    multiple_drivers: string[];
    discount_drivers: string[];
  };
  this_deal_positioning: {
    implied_ev_ebitda: number | null;
    implied_ev_revenue: number | null;
    vs_comp_set: string;
    rationale: string;
  };
  valuation_context: string;
  data_quality_note: string;
}

type AppView = 'home' | 'deal';

interface TextSegment { type: 'text'; content: string; }
interface ChartSegment { type: 'chart'; chartData: any; }
type Segment = TextSegment | ChartSegment;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  segments?: Segment[];
  timestamp?: string;
}

interface UploadedDocument {
  file: File;
  name: string;
  url: string;
  pageCount: number | null;
}

interface InvestmentCriteria {
  minEbitda: string;
  dealSizeRange: string;
  targetSectors: string;
  geography: string;
}

// ── Config ───────────────────────────────────────────────────
const verdictConfig: Record<string, { color: string; bg: string; label: string; border: string }> = {
  verified:     { color: "#166534", bg: "#f0fdf4", label: "Verified",       border: "#bbf7d0" },
  disputed:     { color: "#92400e", bg: "#fffbeb", label: "Disputed",       border: "#fde68a" },
  unverifiable: { color: "#991b1b", bg: "#fdf2f2", label: "Ask Management", border: "#fecaca" },
};

const overallConfig: Record<string, { color: string; bg: string }> = {
  "Worth deeper look": { color: "#166534", bg: "#f0f7f0" },
  "Borderline":        { color: "#92400e", bg: "#fef9ec" },
  "Pass":              { color: "#991b1b", bg: "#fdf2f2" },
};

const severityConfig = {
  high:   { color: "#991b1b", border: "#fecaca", bg: "#fdf2f2", label: "High"   },
  medium: { color: "#92400e", border: "#fde68a", bg: "#fffbeb", label: "Medium" },
  low:    { color: "#6b7280", border: "#e5e7eb", bg: "#f9fafb", label: "Low"    },
};

const LOADING_STEPS = [
  "Extracting text from CIM...",
  "Identifying key claims...",
  "Searching live sources...",
  "Analyzing each claim...",
  "Building assessment...",
];

// ── File type helpers ─────────────────────────────────────────
type FileType = 'pdf' | 'xlsx' | 'pptx' | 'other';

function getFileType(name: string): FileType {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'pptx' || ext === 'ppt') return 'pptx';
  return 'other';
}

function getFileIcon(type: FileType): string {
  switch (type) {
    case 'xlsx': return '📊';
    case 'pptx': return '📑';
    default: return '📄';
  }
}

function getTypeBadgeColor(type: FileType): { bg: string; color: string } {
  switch (type) {
    case 'pdf':  return { bg: '#dc2626', color: '#fff' };
    case 'xlsx': return { bg: '#16a34a', color: '#fff' };
    case 'pptx': return { bg: '#d97706', color: '#fff' };
    default:     return { bg: '#6b7280', color: '#fff' };
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 2) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const dealVerdictPill: Record<string, { bg: string; color: string; border: string }> = {
  'Worth deeper look': { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
  'Borderline':        { bg: '#fffbeb', color: '#92400e', border: '#fde68a' },
  'Pass':              { bg: '#fdf2f2', color: '#991b1b', border: '#fecaca' },
};

const FONT_STACK = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const GLOBAL_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; font-family: inherit; }
  body { font-family: ${FONT_STACK}; background: ${OFFWHITE}; color: ${NAVY}; -webkit-font-smoothing: antialiased; }
  a:hover { opacity: 0.8; }
  textarea:focus { outline: 1px solid ${RED}; border-color: transparent; }
  .react-pdf__Page { display: block !important; }
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
  input, select, textarea, button { font-family: inherit; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1); } }
`;

// ── Utilities ────────────────────────────────────────────────
function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

const sectionLabel: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: 10, fontWeight: 700, color: RED,
  textTransform: "uppercase", letterSpacing: "2px",
};

// ── Collapsible Section ──────────────────────────────────────
function CollapsibleSection({
  title, defaultOpen = true, count, action, children,
}: {
  title: string; defaultOpen?: boolean;
  count?: string | number; action?: React.ReactNode; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid #f0ede8" }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "11px 20px", cursor: "pointer", userSelect: "none", background: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={sectionLabel}>{title}</span>
          {count !== undefined && (
            <span style={{ fontSize: 10, fontWeight: 700, background: "#f5f5f5", color: "#6b7280", borderRadius: 20, padding: "1px 7px" }}>
              {count}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={e => e.stopPropagation()}>
          {action}
          <span style={{ fontSize: 9, color: "#9ca3af", cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
            {open ? "▲" : "▼"}
          </span>
        </div>
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

// ── Upload Zone ──────────────────────────────────────────────
interface UploadZoneProps {
  files: File[];
  onAddFiles: (f: File[]) => void;
  onRemoveFile: (i: number) => void;
  onAnalyze: () => void;
  loading: boolean;
  loadingStep: number;
  error: string | null;
  sector: string;
  onSectorChange: (s: string) => void;
  criteria: InvestmentCriteria;
  onCriteriaChange: (c: InvestmentCriteria) => void;
  dealName?: string;
  onBackToHome?: () => void;
}

function UploadZone({
  files, onAddFiles, onRemoveFile, onAnalyze, loading, loadingStep,
  error, sector, onSectorChange, criteria, onCriteriaChange,
  dealName, onBackToHome,
}: UploadZoneProps) {
  const [criteriaOpen, setCriteriaOpen] = useState(false);

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length) onAddFiles(accepted);
  }, [onAddFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { "application/pdf": [".pdf"] }, multiple: true, disabled: loading,
  });

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 12px", borderRadius: 6,
    border: "1px solid #e5e7eb", fontSize: 13, fontFamily: "'Inter', sans-serif",
    background: "#fff", color: NAVY, outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: OFFWHITE }}>
      <style>{GLOBAL_STYLE}</style>

      {/* Nav bar — shown when inside a deal workspace */}
      {dealName && onBackToHome && (
        <div style={{
          background: NAVY, color: "#fff", display: "flex", alignItems: "center",
          padding: "0 24px", height: 52, gap: 16,
        }}>
          <button
            onClick={onBackToHome}
            style={{
              background: "none", border: "none", color: "#9ca3af", fontSize: 13,
              cursor: "pointer", fontFamily: "'Inter', sans-serif", padding: "4px 0",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            ← All Deals
          </button>
          <div style={{ width: 1, height: 20, background: "#374151" }} />
          <div style={{
            background: RED, color: "#fff", fontFamily: "'Inter', sans-serif",
            fontWeight: 800, fontSize: 12, padding: "4px 12px", borderRadius: 3, letterSpacing: "2px",
          }}>
            SAGARD
          </div>
          <span style={{ color: "#e5e7eb", fontSize: 14, fontFamily: "'Inter', sans-serif", fontWeight: 500 }}>
            {dealName}
          </span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
      <div style={{ width: "100%", maxWidth: 540 }}>
        {/* Wordmark */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            display: "inline-block", background: RED, color: "#fff",
            fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 15,
            padding: "11px 32px", borderRadius: 4, letterSpacing: "3px", marginBottom: 20,
          }}>
            SAGARD
          </div>
          <h1 style={{ fontFamily: "'Inter', sans-serif", fontSize: 32, fontWeight: 800, color: NAVY, margin: "0 0 8px", letterSpacing: "-0.5px" }}>
            CIM Analyzer
          </h1>
          <p style={{ color: "#6b7280", fontSize: 13, margin: 0, fontFamily: "'Inter', sans-serif" }}>
            AI-powered first-pass investment analysis
          </p>
        </div>

        {/* Drop zone */}
        <div
          {...getRootProps()}
          style={{
            border: `2px dashed ${isDragActive ? RED : "#c8c0b8"}`,
            borderRadius: 8, padding: files.length ? "20px 28px" : "48px 28px",
            textAlign: "center", background: isDragActive ? "#fdf5f5" : "#fff",
            cursor: loading ? "not-allowed" : "pointer", transition: "all 0.2s",
          }}
        >
          <input {...getInputProps()} />
          {loading ? (
            <div>
              <div style={{ width: 34, height: 34, border: `3px solid #e5e7eb`, borderTop: `3px solid ${RED}`, borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 14px" }} />
              <p style={{ color: RED, fontWeight: 600, fontSize: 14, margin: "0 0 5px", fontFamily: "'Inter', sans-serif" }}>
                {LOADING_STEPS[loadingStep] ?? "Analyzing..."}
              </p>
              <p style={{ color: "#9ca3af", fontSize: 12, margin: 0 }}>This takes about 60–90 seconds</p>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 26, marginBottom: 10 }}>📄</div>
              <p style={{ color: NAVY, fontWeight: 600, fontSize: 14, margin: "0 0 4px", fontFamily: "'Inter', sans-serif" }}>
                {isDragActive ? "Drop PDFs here" : files.length ? "Drop more documents to add" : "Drag & drop PDFs here"}
              </p>
              <p style={{ color: "#9ca3af", fontSize: 12, margin: "0 0 14px" }}>or click to browse</p>
              {!files.length && (
                <button style={{ background: RED, color: "#fff", border: "none", borderRadius: 6, padding: "9px 22px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>
                  Select PDF
                </button>
              )}
            </div>
          )}
        </div>

        {/* Staged file list */}
        {files.length > 0 && !loading && (
          <div style={{ marginTop: 10 }}>
            {files.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 7, padding: "8px 12px", marginBottom: 5 }}>
                <span style={{ fontSize: 14 }}>📄</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</p>
                  <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{formatBytes(f.size)}</p>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", padding: "2px 8px", borderRadius: 20, background: i === 0 ? RED : "#f5f5f5", color: i === 0 ? "#fff" : "#6b7280" }}>
                  {i === 0 ? "Primary CIM" : "Supporting Doc"}
                </span>
                <button onClick={() => onRemoveFile(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>×</button>
              </div>
            ))}
            {files.length > 1 && (
              <p style={{ fontSize: 11, color: "#6b7280", margin: "5px 0 0", textAlign: "center" }}>Cross-document conflict detection enabled</p>
            )}
          </div>
        )}

        {/* Strategy selector */}
        <div style={{ marginTop: 16 }}>
          <label style={{ display: "block", marginBottom: 5, ...sectionLabel }}>Strategy Focus</label>
          <select
            value={sector}
            onChange={e => onSectorChange(e.target.value)}
            style={{ ...inputStyle, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", appearance: "none" }}
          >
            <option>Private Equity</option>
            <option>Private Credit</option>
            <option>Venture Capital</option>
            <option>Real Estate</option>
          </select>
        </div>

        {/* Investment Criteria (collapsible) */}
        <div style={{ marginTop: 12, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 7, overflow: "hidden" }}>
          <div
            onClick={() => setCriteriaOpen(o => !o)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", cursor: "pointer", userSelect: "none" }}
          >
            <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Inter', sans-serif" }}>⚙ Customize investment criteria <span style={{ color: "#9ca3af" }}>(optional)</span></span>
            <span style={{ fontSize: 9, color: "#9ca3af" }}>{criteriaOpen ? "▲" : "▼"}</span>
          </div>
          {criteriaOpen && (
            <div style={{ padding: "4px 14px 14px", borderTop: "1px solid #f3f4f6", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px" }}>
              {[
                { label: "Minimum EBITDA", key: "minEbitda", placeholder: "$10M" },
                { label: "Deal size range", key: "dealSizeRange", placeholder: "$50M — $250M" },
                { label: "Target sectors", key: "targetSectors", placeholder: "Healthcare, Technology" },
                { label: "Geography", key: "geography", placeholder: "North America" },
              ].map(field => (
                <div key={field.key}>
                  <label style={{ display: "block", marginBottom: 4, fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {field.label}
                  </label>
                  <input
                    type="text"
                    placeholder={field.placeholder}
                    value={criteria[field.key as keyof InvestmentCriteria]}
                    onChange={e => onCriteriaChange({ ...criteria, [field.key]: e.target.value })}
                    style={{ ...inputStyle, fontSize: 12, padding: "7px 10px" }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Analyze button */}
        {files.length > 0 && !loading && (
          <button
            onClick={onAnalyze}
            style={{ width: "100%", marginTop: 14, background: RED, color: "#fff", border: "none", borderRadius: 7, padding: "13px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}
          >
            Analyze {files.length} document{files.length > 1 ? "s" : ""}
          </button>
        )}

        {error && <p style={{ textAlign: "center", color: "#991b1b", marginTop: 14, fontSize: 13 }}>{error}</p>}
        <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 11, marginTop: 14 }}>
          Documents are processed in real time and not stored.
        </p>
      </div>
      </div>
    </div>
  );
}

// ── Verdict Badge ────────────────────────────────────────────
function VerdictBadge({ verdict }: { verdict: string }) {
  const cfg = verdictConfig[verdict] ?? verdictConfig.unverifiable;
  return (
    <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", fontFamily: "'Inter', sans-serif" }}>
      {cfg.label}
    </span>
  );
}

// ── Claim Card ───────────────────────────────────────────────
function ClaimCard({ claim, index, isActive, onClick }: { claim: Claim; index: number; isActive: boolean; onClick: () => void }) {
  const [note, setNote] = useState("");
  const cfg = verdictConfig[claim.verdict] ?? verdictConfig.unverifiable;

  return (
    <div
      onClick={onClick}
      style={{ border: `1px solid ${isActive ? cfg.color : "#f0ede8"}`, borderLeft: `3px solid ${cfg.color}`, borderRadius: 7, padding: isActive ? "13px" : "9px 13px", marginBottom: 6, background: isActive ? cfg.bg : "#fff", cursor: "pointer", transition: "all 0.15s" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <p style={{
          flex: 1, margin: 0, fontSize: 12, color: "#374151", lineHeight: 1.5, fontStyle: "italic", fontFamily: "'Inter', sans-serif",
          ...(isActive ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } as React.CSSProperties),
        }}>
          "{claim.claim}"
        </p>
        <VerdictBadge verdict={claim.verdict} />
      </div>

      {isActive && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <span style={{ background: "#f5f5f5", color: "#6b7280", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 600 }}>p.{claim.page}</span>
            <span style={{ background: "#f5f5f5", color: "#6b7280", borderRadius: 4, padding: "1px 6px", fontSize: 10 }}>{claim.category}</span>
            {claim.materiality === "high" && (
              <span style={{ background: RED, color: "#fff", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                High Impact
              </span>
            )}
          </div>

          {claim.diligence_question && (
            <div style={{ background: "#fef9f0", border: "1px solid #fde68a", borderRadius: 6, padding: "9px 12px", marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.5px" }}>❓ Ask management</span>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{claim.diligence_question}</p>
            </div>
          )}

          <p style={{ color: "#4b5563", fontSize: 12, margin: "0 0 10px", lineHeight: 1.6 }}>{claim.explanation}</p>

          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 10 }}>
            <span style={{ fontSize: 10, color: "#9ca3af" }}>Confidence:</span>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: i <= claim.confidence ? cfg.color : "#e5e7eb" }} />
            ))}
            <span style={{ fontSize: 10, color: "#9ca3af" }}>{claim.confidence}/5</span>
          </div>

          {claim.sources?.filter(s => s.url).length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, marginRight: 6 }}>Sources:</span>
              {claim.sources.filter(s => s.url).map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                  style={{ display: "inline-block", background: "#f5f5f5", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 20, padding: "1px 9px", fontSize: 10, textDecoration: "none", marginRight: 5, marginBottom: 4 }}>
                  {(s.title || "Source").slice(0, 32)}{(s.title || "").length > 32 ? "…" : ""} ↗
                </a>
              ))}
            </div>
          )}

          <textarea
            placeholder="Add analyst note..."
            value={note}
            onChange={e => { e.stopPropagation(); setNote(e.target.value); }}
            onClick={e => e.stopPropagation()}
            style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 10px", fontSize: 11, color: "#374151", resize: "vertical", minHeight: 44, boxSizing: "border-box", fontFamily: "'Inter', sans-serif", background: "#fafafa" }}
          />
        </div>
      )}
    </div>
  );
}

// ── PDF Viewer ───────────────────────────────────────────────
function PDFViewer({ file, claims, activePage, currentPage, onPageChange, onNumPages }: {
  file: string; claims: Claim[]; activePage: number | null;
  currentPage: number; onPageChange: (p: number) => void; onNumPages: (n: number) => void;
}) {
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [jumpInput, setJumpInput] = useState("1");
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(400);
  const prevUrlRef = useRef('');
  const isNavigatingRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width - 16));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Track file URL changes (needed by IntersectionObserver dep array)
  useEffect(() => { prevUrlRef.current = file; }, [file]);

  // Keep jump input in sync with external page changes (citations, doc switch, nav buttons)
  useEffect(() => {
    setJumpInput(String(currentPage));
  }, [currentPage]);

  // Scroll to active claim's page when user clicks a claim card
  const prevActivePageRef = useRef<number | null>(null);
  useEffect(() => {
    if (activePage === null || activePage === prevActivePageRef.current) return;
    prevActivePageRef.current = activePage;
    let attempts = 0;
    const iv = setInterval(() => {
      attempts++;
      const el = containerRef.current?.querySelector(`[data-page-number="${activePage}"]`);
      if (el) { (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' }); clearInterval(iv); }
      else if (attempts >= 20) clearInterval(iv);
    }, 100);
    return () => clearInterval(iv);
  }, [activePage]);

  // IntersectionObserver: update page indicator as user manually scrolls
  // Debounced 200ms so rapid programmatic scrolls don't flicker the indicator
  useEffect(() => {
    const container = containerRef.current;
    if (!container || numPages === 0) return;
    const ratioMap = new Map<number, number>();
    let debounceTimer: ReturnType<typeof setTimeout>;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const pn = parseInt(entry.target.getAttribute('data-page-number') || '0');
        if (pn > 0) ratioMap.set(pn, entry.intersectionRatio);
      });
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (isNavigatingRef.current) return;
        let bestRatio = 0, bestPage = 0;
        ratioMap.forEach((r, p) => { if (r > bestRatio) { bestRatio = r; bestPage = p; } });
        if (bestPage > 0) onPageChange(bestPage);
      }, 200);
    }, { root: container, threshold: [0, 0.25, 0.5, 0.75, 1.0] });
    container.querySelectorAll('[data-page-number]').forEach(el => observer.observe(el));
    return () => { observer.disconnect(); clearTimeout(debounceTimer); };
  }, [numPages, file]); // eslint-disable-line react-hooks/exhaustive-deps

  // Report numPages up so the outer indicator can show "of N"
  useEffect(() => {
    if (numPages > 0) onNumPages(numPages);
  }, [numPages]); // eslint-disable-line react-hooks/exhaustive-deps

  const jumpToPage = (page: number) => {
    const p = Math.max(1, Math.min(numPages || 1, page));
    setJumpInput(String(p));
    onPageChange(p);
    const tryScroll = () => {
      const el = containerRef.current?.querySelector(`[data-page-number="${p}"]`);
      if (el) {
        isNavigatingRef.current = true;
        (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => { isNavigatingRef.current = false; }, 800);
        return true;
      }
      return false;
    };
    if (!tryScroll()) {
      let attempts = 0;
      const iv = setInterval(() => {
        attempts++;
        if (tryScroll() || attempts >= 30) clearInterval(iv);
      }, 100);
    }
  };

  const claimsByPage: Record<number, Claim[]> = {};
  claims.forEach(c => { if (!claimsByPage[c.page]) claimsByPage[c.page] = []; claimsByPage[c.page].push(c); });

  const btnStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
    color: "#fff", borderRadius: 4, width: 26, height: 26, cursor: "pointer",
    fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600,
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#3c3f41" }}>
      <div style={{ flexShrink: 0, background: "#2b2d2f", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <button style={btnStyle} onClick={() => jumpToPage(currentPage - 1)}>‹</button>
          <input type="number" value={jumpInput}
            onChange={e => setJumpInput(e.target.value)}
            onBlur={() => jumpToPage(parseInt(jumpInput) || 1)}
            onKeyDown={e => { if (e.key === "Enter") jumpToPage(parseInt(jumpInput) || 1); }}
            style={{ width: 36, textAlign: "center", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 4, color: "#fff", fontSize: 12, padding: "2px 4px" }}
          />
          <span style={{ color: "#888", fontSize: 11 }}>/ {numPages}</span>
          <button style={btnStyle} onClick={() => jumpToPage(currentPage + 1)}>›</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <button style={btnStyle} onClick={() => setZoom(z => Math.max(50, z - 25))}>−</button>
          <span style={{ color: "#ccc", fontSize: 11, width: 38, textAlign: "center" }}>{zoom}%</span>
          <button style={btnStyle} onClick={() => setZoom(z => Math.min(150, z + 25))}>+</button>
        </div>
      </div>

      <div ref={containerRef} style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: "12px 8px" }}>
        <Document file={file} onLoadSuccess={({ numPages }) => setNumPages(numPages)} onLoadError={err => console.error(err)}
          loading={<div style={{ color: "#aaa", textAlign: "center", padding: 40, fontSize: 13 }}>Loading PDF...</div>}>
          {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => {
            const pageClaims = claimsByPage[pageNum] || [];
            const isActive = activePage === pageNum;
            const borderColor = isActive ? RED
              : pageClaims.some(c => c.verdict === "disputed")    ? "#d97706"
              : pageClaims.some(c => c.verdict === "unverifiable") ? "#dc2626"
              : pageClaims.some(c => c.verdict === "verified")    ? "#16a34a"
              : "transparent";
            const pageWidth = containerWidth * (zoom / 100);

            return (
              <div key={pageNum} data-page-number={pageNum}
                style={{ position: "relative", marginBottom: 12, border: `3px solid ${borderColor}`, borderRadius: 3, transition: "border-color 0.2s", width: pageWidth, marginLeft: "auto", marginRight: "auto" }}>
                <div style={{ position: "absolute", top: 5, left: 5, zIndex: 10, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 10, padding: "1px 6px", borderRadius: 3 }}>
                  p.{pageNum}
                </div>
                {pageClaims.length > 0 && (
                  <div style={{ position: "absolute", top: 5, right: 5, zIndex: 10, display: "flex", gap: 3 }}>
                    {pageClaims.map((c, i) => (
                      <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: verdictConfig[c.verdict]?.color ?? "#6b7280", border: "1px solid rgba(255,255,255,0.5)" }} />
                    ))}
                  </div>
                )}
                <Page pageNumber={pageNum} width={pageWidth} rotate={0} renderTextLayer={false} renderAnnotationLayer={false} />
              </div>
            );
          })}
        </Document>
      </div>
    </div>
  );
}

// ── Export IC Brief ──────────────────────────────────────────
function buildICBrief(assessment: Assessment, claims: Claim[], conflicts: CrossDocumentConflict[], filename: string): string {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const sec = (label: string, content: string) =>
    `<div class="s"><div class="sl">${label}</div>${content}</div>`;

  const ol = (items: string[]) =>
    `<ol>${items.map(i => `<li>${escHtml(i)}</li>`).join("")}</ol>`;

  const conflictTable = conflicts.length === 0 ? "" : sec("Cross-Document Conflicts",
    `<table><thead><tr><th>Doc 1</th><th>Doc 2</th><th>Severity</th><th>Explanation</th></tr></thead><tbody>
    ${conflicts.map(c => `<tr><td>${escHtml(c.doc1)}</td><td>${escHtml(c.doc2)}</td><td>${c.severity}</td><td>${escHtml(c.explanation)}</td></tr>`).join("")}
    </tbody></table>`
  );

  const diligenceItems = claims.filter(c => c.diligence_question).map(c => c.diligence_question);
  const holds = assessment.narrative_holds_up;

  return `
<style>
  @media print {
    body > *:not(#ic-brief-print) { display: none !important; }
    #ic-brief-print { display: block !important; }
  }
  #ic-brief-print {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 760px; margin: 0 auto; padding: 40px; color: #1a1a1a;
  }
  #ic-brief-print .hdr h1 { font-size: 20px; font-weight: 800; margin: 0 0 4px; letter-spacing: -0.3px; }
  #ic-brief-print .hdr .meta { font-size: 11px; color: #666; }
  #ic-brief-print hr { border: none; border-top: 1px solid #ccc; margin: 16px 0; }
  #ic-brief-print .s { margin-bottom: 20px; }
  #ic-brief-print .sl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 8px; color: #333; }
  #ic-brief-print p { font-size: 11px; line-height: 1.6; margin: 0 0 5px; }
  #ic-brief-print ol { margin: 0; padding-left: 20px; }
  #ic-brief-print li { font-size: 11px; line-height: 1.6; margin-bottom: 4px; }
  #ic-brief-print .verdict { font-size: 18px; font-weight: 800; margin: 0 0 6px; letter-spacing: -0.3px; }
  #ic-brief-print table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
  #ic-brief-print th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #ccc; padding: 4px 8px; }
  #ic-brief-print td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  #ic-brief-print .footer { font-size: 9px; color: #999; text-align: center; margin-top: 32px; border-top: 1px solid #eee; padding-top: 10px; }
</style>
<div class="hdr"><h1>SAGARD — Investment Committee Brief</h1><p class="meta">${today} · ${escHtml(filename)}</p></div>
<hr />
${sec("Company", `<p>${escHtml(assessment.company_snapshot || "—")}</p>`)}
${sec("Seller Narrative", `<p>${escHtml(assessment.sellers_narrative || "—")}${holds ? ` — <em>${holds.holds ? "Holds up" : "Does not hold up"}: ${escHtml(holds.explanation)}</em>` : ""}</p>`)}
${sec("First-Pass Verdict", `<p class="verdict">${escHtml(assessment.overall_verdict)}</p><p>${escHtml(assessment.reasoning)}</p>${assessment.criteria_fit ? `<p><strong>Criteria fit:</strong> ${assessment.criteria_fit.fits ? "✓" : "✗"} ${escHtml(assessment.criteria_fit.explanation)}</p>` : ""}`)}
${sec("Must Answer Before Proceeding", ol(assessment.key_questions || []))}
${sec("Key Risks", ol(assessment.top_risks || []))}
${sec("Bull Case", `<p>${escHtml(assessment.bull_case || "—")}</p>`)}
${conflictTable}
${sec("Diligence Checklist", ol(diligenceItems))}
<div class="footer">Generated by Sagard CIM Analyzer — AI-assisted analysis. Human judgment required for all investment decisions.</div>`;
}

// ── Citation formatter ───────────────────────────────────────
function formatCitations(text: string): string {
  if (!text) return '';
  let f = text;

  // Bold and italic
  f = f.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  f = f.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Headers
  f = f.replace(/^## (.+)$/gm, '<div style="font-weight:700;font-size:14px;color:#1a1a1a;margin:14px 0 6px 0;font-family:Inter,sans-serif;border-bottom:1px solid #f3f4f6;padding-bottom:4px;">$1</div>');
  f = f.replace(/^### (.+)$/gm, '<div style="font-weight:600;font-size:13px;color:#374151;margin:10px 0 4px 0;font-family:Inter,sans-serif;">$1</div>');
  f = f.replace(/^#### (.+)$/gm, '<div style="font-weight:600;font-size:11px;color:#6b7280;margin:8px 0 3px 0;font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:0.5px;">$1</div>');

  // Markdown tables — convert rows to <tr>
  f = f.replace(/^\|(.+)\|$/gm, (match) => {
    const cells = match.split('|').filter(c => c.trim() !== '');
    return '<tr>' + cells.map(c => `<td style="padding:6px 10px;border:1px solid #e5e7eb;font-size:12px;font-family:Inter,sans-serif;">${c.trim()}</td>`).join('') + '</tr>';
  });
  // Remove separator rows (|---|---|) — now rendered as <tr><td>---</td></tr>
  f = f.replace(/<tr>(<td[^>]*>[\s\-:]+<\/td>)+<\/tr>/g, '');
  // Wrap consecutive <tr> blocks in a <table>, promoting first row to header
  f = f.replace(/(<tr>(?:<td[^>]*>.*?<\/td>)+<\/tr>\n?)+/gs, (block) => {
    const rows = block.trim().split('\n').filter(r => r.startsWith('<tr>'));
    if (rows.length === 0) return block;
    const header = rows[0]
      .replace(/<td([^>]*)>/g, '<th style="padding:6px 10px;border:1px solid #e5e7eb;background:#f8f6f3;font-size:11px;font-weight:600;font-family:Inter,sans-serif;color:#374151;">')
      .replace(/<\/td>/g, '</th>');
    const body = rows.slice(1).join('');
    return `<div style="overflow-x:auto;margin:8px 0;"><table style="border-collapse:collapse;width:100%;">${header}${body}</table></div>`;
  });

  // Citations [[Page X, DocName]]
  f = f.replace(/\[\[Page\s+(\d+),\s*([^\]]+)\]\]/gi,
    '<span onclick="window.jumpToPage($1,\'$2\')" style="display:inline-block;background:#fef3f2;color:#913d3e;border:1px solid #fecaca;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;margin:0 2px;cursor:pointer;user-select:none;" title="Jump to page $1 in $2">p.$1↗</span>');
  // Citations [[Page X]]
  f = f.replace(/\[\[Page\s+(\d+)\]\]/gi,
    '<span onclick="window.jumpToPage($1)" style="display:inline-block;background:#fef3f2;color:#913d3e;border:1px solid #fecaca;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;margin:0 2px;cursor:pointer;user-select:none;" title="Jump to page $1">p.$1↗</span>');
  // Citations [[Slide X]]
  f = f.replace(/\[\[Slide\s+(\d+)\]\]/gi,
    '<span onclick="window.jumpToPage($1)" style="display:inline-block;background:#fef3f2;color:#913d3e;border:1px solid #fecaca;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;margin:0 2px;cursor:pointer;user-select:none;" title="Jump to slide $1">slide $1↗</span>');

  // Horizontal rules
  f = f.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;">');

  // Bullet points
  f = f.replace(/^[-•]\s(.+)$/gm,
    '<div style="padding-left:16px;margin:3px 0;font-family:Inter,sans-serif;font-size:13px;line-height:1.5;">• $1</div>');

  // Numbered lists
  f = f.replace(/^(\d+)\.\s(.+)$/gm,
    '<div style="padding-left:16px;margin:3px 0;font-family:Inter,sans-serif;font-size:13px;line-height:1.5;"><span style="color:#913d3e;font-weight:600;min-width:16px;display:inline-block;">$1.</span> $2</div>');

  // Paragraphs — wrap bare text lines that aren't already HTML
  f = f.replace(/^(?!<)(.+)$/gm, (match) => {
    if (!match.trim()) return '';
    return `<p style="margin:4px 0;font-family:Inter,sans-serif;font-size:13px;line-height:1.6;color:#374151;">${match}</p>`;
  });

  return f;
}

// ── Chart parsing helpers ────────────────────────────────────
function fixChartJson(str: string): string {
  let fixed = str.replace(/\n/g, ' ');
  // Fix colors not in an array: "colors":"#aaa","#bbb" -> "colors":["#aaa","#bbb"]
  fixed = fixed.replace(/"colors"\s*:\s*"(#[^"]+)"(\s*,\s*"#[^"]+")*(?=[,}])/g, (match) => {
    const colors = match.match(/#[a-fA-F0-9]{3,8}/g) || [];
    return `"colors":[${colors.map(c => `"${c}"`).join(',')}]`;
  });
  return fixed;
}

function parseResponseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const chartRegex = /CHART:(\{(?:[^{}]|\{[^{}]*\})*\})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = chartRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textContent = text.slice(lastIndex, match.index).trim();
      if (textContent) segments.push({ type: 'text', content: textContent });
    }
    try {
      segments.push({ type: 'chart', chartData: JSON.parse(fixChartJson(match[1])) });
    } catch {
      segments.push({ type: 'text', content: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) segments.push({ type: 'text', content: remaining });
  }
  return segments;
}

// recharts React 19 compat casts
const RC = {
  LineChart:       LineChart       as React.ComponentType<any>,
  Line:            Line            as React.ComponentType<any>,
  BarChart:        BarChart        as React.ComponentType<any>,
  Bar:             Bar             as React.ComponentType<any>,
  PieChart:        PieChart        as React.ComponentType<any>,
  Pie:             Pie             as React.ComponentType<any>,
  Cell:            Cell            as React.ComponentType<any>,
  AreaChart:       AreaChart       as React.ComponentType<any>,
  Area:            Area            as React.ComponentType<any>,
  ScatterChart:    ScatterChart    as React.ComponentType<any>,
  Scatter:         Scatter         as React.ComponentType<any>,
  ComposedChart:   ComposedChart   as React.ComponentType<any>,
  XAxis:           XAxis           as React.ComponentType<any>,
  YAxis:           YAxis           as React.ComponentType<any>,
  CartesianGrid:   CartesianGrid   as React.ComponentType<any>,
  Tooltip:         Tooltip         as React.ComponentType<any>,
  Legend:          Legend          as React.ComponentType<any>,
  RadarChart:      RadarChart      as React.ComponentType<any>,
  Radar:           Radar           as React.ComponentType<any>,
  PolarGrid:       PolarGrid       as React.ComponentType<any>,
  PolarAngleAxis:  PolarAngleAxis  as React.ComponentType<any>,
  PolarRadiusAxis: PolarRadiusAxis as React.ComponentType<any>,
};

// ── Chat Chart Renderer ──────────────────────────────────────
function ChartRenderer({ chartData }: { chartData: any }) {
  if (!chartData || !chartData.type) return null;
  try {
    return <ChartRendererInner chartData={chartData} />;
  } catch (err) {
    console.error("ChartRenderer error:", err, chartData);
    return (
      <div style={{ padding: 16, background: "#fef3f2", borderRadius: 8, color: RED, fontSize: 12, fontFamily: "'Inter', sans-serif" }}>
        Could not render chart — data may be incomplete. Try rephrasing your request.
      </div>
    );
  }
}

function ChartRendererInner({ chartData }: { chartData: any }) {
  // Normalize: backend may return single object instead of array for bars/lines/areas/data
  const normalizedData: any[] = Array.isArray(chartData.data)
    ? chartData.data
    : chartData.data && typeof chartData.data === 'object'
    ? Object.values(chartData.data)
    : [];

  const normalizedBars: any[] = !chartData.config?.bars ? [] :
    Array.isArray(chartData.config.bars) ? chartData.config.bars : [chartData.config.bars];

  const normalizedLines: any[] = !chartData.config?.lines ? [] :
    Array.isArray(chartData.config.lines) ? chartData.config.lines : [chartData.config.lines];

  const normalizedAreas: any[] = !chartData.config?.areas ? [] :
    Array.isArray(chartData.config.areas) ? chartData.config.areas : [chartData.config.areas];

  const chartTitle = (
    <div>
      <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 700, color: NAVY, margin: "0 0 4px", letterSpacing: "-0.3px" }}>{chartData.title}</p>
      {chartData.description && (
        <p style={{ fontSize: 11, color: "#6b7280", margin: "0 0 12px", fontFamily: "'Inter', sans-serif" }}>{chartData.description}</p>
      )}
    </div>
  );

  const wrap = (inner: React.ReactNode) => (
    <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: "1px solid #e5e7eb", marginTop: 8 }}>
      {chartTitle}
      <ResponsiveContainer width="100%" height={300}>
        {inner as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );

  switch (chartData.type) {
    case 'line':
      return wrap(
        <RC.LineChart data={normalizedData}>
          <RC.CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <RC.XAxis dataKey={chartData.config.xKey} tick={{ fontSize: 11 }} />
          <RC.YAxis tick={{ fontSize: 11 }} label={{ value: chartData.config.yAxisLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
          <RC.Tooltip formatter={(v: any) => [`${v}`, '']} />
          <RC.Legend wrapperStyle={{ fontSize: 11 }} />
          {normalizedLines.map((l: any) => (
            <RC.Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color} strokeWidth={2} dot={{ r: 3 }} name={l.label} connectNulls={false} />
          ))}
        </RC.LineChart>
      );

    case 'bar':
      return wrap(
        <RC.BarChart data={normalizedData}>
          <RC.CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <RC.XAxis dataKey={chartData.config.xKey} tick={{ fontSize: 11 }} />
          <RC.YAxis tick={{ fontSize: 11 }} label={{ value: chartData.config.yAxisLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
          <RC.Tooltip />
          <RC.Legend wrapperStyle={{ fontSize: 11 }} />
          {normalizedBars.map((b: any) => (
            <RC.Bar key={b.key} dataKey={b.key} fill={b.color} name={b.label} radius={[3, 3, 0, 0]} />
          ))}
        </RC.BarChart>
      );

    case 'radar':
      return wrap(
        <RC.RadarChart data={normalizedData}>
          <RC.PolarGrid stroke="#e5e7eb" />
          <RC.PolarAngleAxis dataKey={chartData.config.angleKey} tick={{ fontSize: 10 }} />
          <RC.PolarRadiusAxis domain={[0, chartData.config.maxValue ?? 10]} tick={false} />
          <RC.Radar dataKey={chartData.config.valueKey} stroke={RED} fill={RED} fillOpacity={0.25} strokeWidth={2} />
          <RC.Tooltip />
        </RC.RadarChart>
      );

    case 'pie': {
      const pieColors = chartData.config?.colors ?? [RED, "#6b7280", "#d97706", "#16a34a", "#3b82f6"];
      return wrap(
        <RC.PieChart>
          <RC.Pie
            data={normalizedData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={100}
            label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
            labelLine={true}
          >
            {normalizedData.map((_: any, i: number) => (
              <RC.Cell key={i} fill={pieColors[i % pieColors.length]} />
            ))}
          </RC.Pie>
          <RC.Tooltip formatter={(v: any) => [`${v} ${chartData.config?.valueLabel ?? ''}`, '']} />
        </RC.PieChart>
      );
    }

    case 'area':
      return wrap(
        <RC.AreaChart data={normalizedData}>
          <RC.CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <RC.XAxis dataKey={chartData.config.xKey} tick={{ fontSize: 11 }} />
          <RC.YAxis tick={{ fontSize: 11 }} label={{ value: chartData.config.yAxisLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
          <RC.Tooltip />
          <RC.Legend wrapperStyle={{ fontSize: 11 }} />
          {normalizedAreas.map((a: any) => (
            <RC.Area key={a.key} type="monotone" dataKey={a.key} stroke={a.color} fill={a.color} fillOpacity={0.15} name={a.label} />
          ))}
        </RC.AreaChart>
      );

    case 'scatter':
      return wrap(
        <RC.ScatterChart>
          <RC.CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <RC.XAxis type="number" dataKey={chartData.config.xKey} name={chartData.config.xAxisLabel} tick={{ fontSize: 11 }} label={{ value: chartData.config.xAxisLabel, position: 'bottom', style: { fontSize: 11 } }} />
          <RC.YAxis type="number" dataKey={chartData.config.yKey} name={chartData.config.yAxisLabel} tick={{ fontSize: 11 }} label={{ value: chartData.config.yAxisLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
          <RC.Tooltip cursor={{ strokeDasharray: '3 3' }} />
          <RC.Scatter data={normalizedData} fill={RED} />
        </RC.ScatterChart>
      );

    case 'waterfall': {
      let running = 0;
      const wfData = normalizedData.map((item: any) => {
        let base: number, barValue: number;
        if (item.type === 'total') {
          base = 0; barValue = item.value; running = item.value;
        } else if (item.type === 'subtotal') {
          base = 0; barValue = running;
        } else if (item.value < 0) {
          base = running + item.value; barValue = Math.abs(item.value); running += item.value;
        } else {
          base = running; barValue = item.value; running += item.value;
        }
        return { ...item, _base: base, _barValue: barValue };
      });
      const cfg = chartData.config ?? {};
      const WFTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload?.length) return null;
        const entry = payload.find((p: any) => p.dataKey === '_barValue');
        if (!entry) return null;
        return (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
            <p style={{ fontWeight: 600, margin: '0 0 2px' }}>{label}</p>
            <p style={{ margin: 0, color: entry.payload.value < 0 ? (cfg.negativeColor ?? '#dc2626') : (cfg.positiveColor ?? '#16a34a') }}>
              {entry.payload.value}
            </p>
          </div>
        );
      };
      return (
        <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: "1px solid #e5e7eb", marginTop: 8 }}>
          {chartTitle}
          <ResponsiveContainer width="100%" height={300}>
            <RC.BarChart data={wfData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <RC.CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <RC.XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <RC.YAxis tick={{ fontSize: 11 }} label={{ value: cfg.yAxisLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
              <RC.Tooltip content={<WFTooltip />} />
              <RC.Bar dataKey="_base" stackId="wf" fill="transparent" legendType="none" />
              <RC.Bar dataKey="_barValue" stackId="wf" radius={[3, 3, 0, 0]} legendType="none">
                {wfData.map((entry: any, i: number) => {
                  const color = entry.type === 'total' ? (cfg.totalColor ?? '#1a1a1a')
                    : entry.type === 'subtotal' ? (cfg.subtotalColor ?? RED)
                    : entry.value < 0 ? (cfg.negativeColor ?? '#dc2626')
                    : (cfg.positiveColor ?? '#16a34a');
                  return <RC.Cell key={i} fill={color} />;
                })}
              </RC.Bar>
            </RC.BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    case 'combo':
      return wrap(
        <RC.ComposedChart data={normalizedData}>
          <RC.CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <RC.XAxis dataKey={chartData.config.xKey} tick={{ fontSize: 11 }} />
          <RC.YAxis yAxisId="left" tick={{ fontSize: 11 }} label={{ value: chartData.config.leftAxisLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
          <RC.YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} label={{ value: chartData.config.rightAxisLabel, angle: 90, position: 'insideRight', style: { fontSize: 11 } }} />
          <RC.Tooltip />
          <RC.Legend wrapperStyle={{ fontSize: 11 }} />
          {normalizedBars.map((b: any) => (
            <RC.Bar key={b.key} yAxisId="left" dataKey={b.key} fill={b.color} name={b.label} radius={[3, 3, 0, 0]} />
          ))}
          {normalizedLines.map((l: any) => (
            <RC.Line key={l.key} yAxisId="right" type="monotone" dataKey={l.key} stroke={l.color} strokeWidth={2} dot={{ r: 3 }} name={l.label} connectNulls={false} />
          ))}
        </RC.ComposedChart>
      );

    default:
      return (
        <div style={{ background: "#f9fafb", borderRadius: 8, padding: 12, marginTop: 8 }}>
          <p style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Inter', sans-serif" }}>Chart type "{chartData.type}" is not yet supported.</p>
        </div>
      );
  }
}

// ── Charts Section ────────────────────────────────────────────
function ChartsSection({ chartsData }: { chartsData: any }) {
  const { margin_trend, deal_scorecard } = chartsData;

  const marginData = (margin_trend.years || []).map((year: number, i: number) => ({
    year,
    ebitda_margin: margin_trend.ebitda_margin[i] ?? null,
    revenue_growth: margin_trend.revenue_growth[i] ?? null,
  }));

  const radarData = (deal_scorecard.dimensions || []).map((d: any) => ({
    name: d.name,
    score: d.score,
  }));

  const overallScore = deal_scorecard.overall_score ?? 0;
  const scoreColor = overallScore < 5 ? "#dc2626" : overallScore <= 7 ? "#d97706" : "#16a34a";

  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", margin: "12px 20px 16px" }}>

      {/* Chart 1: Margin Trend */}
      <div>
        <p style={{ ...sectionLabel, margin: "0 0 2px" }}>MARGIN TREND</p>
        <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 12px", fontFamily: "'Inter', sans-serif" }}>Historical performance extracted from documents</p>
        {marginData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <RC.LineChart data={marginData} margin={{ top: 5, right: 36, left: 0, bottom: 5 }}>
              <RC.CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
              <RC.XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <RC.YAxis yAxisId="left" domain={[0, 40]} tickFormatter={(v: any) => `${v}%`} tick={{ fontSize: 11 }} label={{ value: "EBITDA Margin %", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 10, fill: "#6b7280" } }} />
              <RC.YAxis yAxisId="right" orientation="right" domain={[-20, 40]} tickFormatter={(v: any) => `${v}%`} tick={{ fontSize: 11 }} label={{ value: "Revenue Growth %", angle: 90, position: "insideRight", offset: 10, style: { fontSize: 10, fill: "#6b7280" } }} />
              <RC.Tooltip formatter={(value: any) => value !== null && value !== undefined ? `${value}%` : "N/A"} />
              <RC.Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <RC.Line yAxisId="left" type="monotone" dataKey="ebitda_margin" stroke={RED} strokeWidth={2.5} dot={{ fill: RED, r: 4 }} name="EBITDA Margin %" connectNulls={false} />
              <RC.Line yAxisId="right" type="monotone" dataKey="revenue_growth" stroke="#6b7280" strokeWidth={2} strokeDasharray="5 5" dot={{ fill: "#6b7280", r: 4 }} name="Revenue Growth %" connectNulls={false} />
            </RC.LineChart>
          </ResponsiveContainer>
        ) : (
          <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "20px 0", fontFamily: "'Inter', sans-serif" }}>No historical financial data found in documents.</p>
        )}
      </div>

      {/* Divider + Overall Deal Score */}
      <div style={{ borderTop: "1px solid #f0ede8", margin: "16px 0", paddingTop: 16, textAlign: "center" }}>
        <p style={{ ...sectionLabel, margin: "0 0 6px" }}>DEAL SCORE</p>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 48, fontWeight: 800, color: scoreColor, lineHeight: 1, letterSpacing: "-1px" }}>
            {overallScore}
          </span>
          <span style={{ fontSize: 20, color: "#9ca3af", fontFamily: "'Inter', sans-serif" }}>/10</span>
        </div>
      </div>

      {/* Chart 2: Deal Scorecard */}
      <div>
        <p style={{ ...sectionLabel, margin: "0 0 2px" }}>DEAL SCORECARD</p>
        <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 12px", fontFamily: "'Inter', sans-serif" }}>AI-scored across six dimensions</p>
        {radarData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <RC.RadarChart data={radarData}>
              <RC.PolarGrid stroke="#e5e7eb" />
              <RC.PolarAngleAxis dataKey="name" tick={{ fontSize: 11 }} />
              <RC.PolarRadiusAxis domain={[0, 10]} tick={false} />
              <RC.Radar name="Score" dataKey="score" stroke={RED} fill={RED} fillOpacity={0.25} strokeWidth={2} />
            </RC.RadarChart>
          </ResponsiveContainer>
        ) : (
          <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "20px 0", fontFamily: "'Inter', sans-serif" }}>No scorecard data available.</p>
        )}
        {deal_scorecard.dimensions?.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            {deal_scorecard.dimensions.map((d: any) => {
              const sc = d.score;
              const sColor = sc <= 4 ? "#dc2626" : sc <= 6 ? "#d97706" : "#16a34a";
              return (
                <div key={d.name} title={d.reasoning} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, padding: "8px 10px", cursor: "default" }}>
                  <p style={{ margin: "0 0 2px", fontSize: 11, color: "#6b7280", fontFamily: "'Inter', sans-serif" }}>{d.name}</p>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: sColor, fontFamily: "'Inter', sans-serif", lineHeight: 1 }}>{sc}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Document state (useReducer) ──────────────────────────────
interface DocEntry {
  file: File | null;   // null when restored from DB (no binary available)
  name: string;
  url: string;         // empty string when no PDF available
  numPages: number | null;
  extractedText: string;
  isProcessing: boolean;
  fileType: FileType;
}

interface DocumentState {
  documents: DocEntry[];
  activeIndex: number;
  currentPage: number;
}

type DocumentAction =
  | { type: 'LOAD_DOCUMENTS'; payload: DocEntry[] }
  | { type: 'SWITCH_DOCUMENT'; payload: number }
  | { type: 'SET_PAGE'; payload: number }
  | { type: 'SET_NUM_PAGES'; payload: number }
  | { type: 'ADD_DOCUMENTS'; payload: DocEntry[] }
  | { type: 'REMOVE_DOCUMENT'; payload: number }
  | { type: 'SET_EXTRACTED_TEXT'; payload: { name: string; text: string } }
  | { type: 'SET_PROCESSING'; payload: { name: string; isProcessing: boolean } };

function documentReducer(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    case 'LOAD_DOCUMENTS':
      return { documents: action.payload, activeIndex: 0, currentPage: 1 };
    case 'SWITCH_DOCUMENT':
      return { ...state, activeIndex: action.payload, currentPage: 1 };
    case 'SET_PAGE':
      return { ...state, currentPage: action.payload };
    case 'SET_NUM_PAGES':
      return {
        ...state,
        documents: state.documents.map((d, i) =>
          i === state.activeIndex ? { ...d, numPages: action.payload } : d
        ),
      };
    case 'ADD_DOCUMENTS': {
      const existingNames = new Set(state.documents.map(d => d.name));
      const newDocs = action.payload.filter(d => !existingNames.has(d.name));
      return { ...state, documents: [...state.documents, ...newDocs] };
    }
    case 'REMOVE_DOCUMENT': {
      const newDocs = state.documents.filter((_, i) => i !== action.payload);
      if (newDocs.length === 0) return { ...state, documents: [], activeIndex: 0, currentPage: 1 };
      const newActive = action.payload <= state.activeIndex
        ? Math.max(0, state.activeIndex - 1)
        : state.activeIndex;
      return { ...state, documents: newDocs, activeIndex: Math.min(newActive, newDocs.length - 1), currentPage: 1 };
    }
    case 'SET_EXTRACTED_TEXT':
      return {
        ...state,
        documents: state.documents.map(d =>
          d.name === action.payload.name ? { ...d, extractedText: action.payload.text } : d
        ),
      };
    case 'SET_PROCESSING':
      return {
        ...state,
        documents: state.documents.map(d =>
          d.name === action.payload.name ? { ...d, isProcessing: action.payload.isProcessing } : d
        ),
      };
    default:
      return state;
  }
}

// ── Drag Divider ──────────────────────────────────────────────
function DragDivider({ onDrag, dark = false }: { onDrag: (dx: number) => void; dark?: boolean }) {
  const divRef = useRef<HTMLDivElement>(null);
  const bg = dark ? '#2d2d2d' : '#ddd9d4';
  const bgHover = dark ? '#484848' : '#bbb5ae';
  const dotColor = dark ? '#555' : '#9ca3af';

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    let lastX = e.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    if (divRef.current) divRef.current.style.background = bgHover;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      onDrag(dx);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (divRef.current) divRef.current.style.background = bg;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={divRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = bgHover; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = bg; }}
      style={{ width: 6, flexShrink: 0, cursor: 'col-resize', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
        {[0, 1, 2].map(i => <div key={i} style={{ width: 2, height: 2, borderRadius: '50%', background: dotColor }} />)}
      </div>
    </div>
  );
}

// ── FileExplorer ──────────────────────────────────────────────
function FileExplorer({ docState, docDispatch, collapsed, onToggle, onDocumentExtracted, expandedWidth }: {
  docState: DocumentState;
  docDispatch: React.Dispatch<DocumentAction>;
  collapsed: boolean;
  onToggle: () => void;
  onDocumentExtracted?: (filename: string, fileType: FileType, text: string) => void;
  expandedWidth: number;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    e.target.value = '';

    const newEntries: DocEntry[] = files.map(f => ({
      file: f,
      name: f.name,
      url: URL.createObjectURL(f),
      numPages: null,
      extractedText: '',
      isProcessing: true,
      fileType: getFileType(f.name),
    }));

    docDispatch({ type: 'ADD_DOCUMENTS', payload: newEntries });

    for (const entry of newEntries) {
      try {
        const formData = new FormData();
        formData.append('file', entry.file!);
        const { data } = await axios.post<{ text: string }>(`${API_BASE_URL}/extract`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        docDispatch({ type: 'SET_EXTRACTED_TEXT', payload: { name: entry.name, text: data.text } });
        onDocumentExtracted?.(entry.name, entry.fileType, data.text);
      } catch {
        // leave extractedText empty on failure
      } finally {
        docDispatch({ type: 'SET_PROCESSING', payload: { name: entry.name, isProcessing: false } });
      }
    }
  };

  return (
    <div style={{
      width: collapsed ? 36 : expandedWidth,
      flexShrink: 0,
      background: '#1e1e1e',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      {collapsed ? (
        /* ── Collapsed strip ── */
        <div
          onClick={onToggle}
          style={{
            width: 36, height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', paddingTop: 8, cursor: 'pointer', gap: 10,
          }}
        >
          <button
            onClick={e => { e.stopPropagation(); onToggle(); }}
            title="Expand file explorer"
            style={{
              background: 'none', border: 'none', color: RED, cursor: 'pointer',
              fontSize: 20, padding: 0, lineHeight: 1, flexShrink: 0,
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ›
          </button>
          <span style={{
            fontSize: 9, fontWeight: 700, color: '#555555', letterSpacing: '2px',
            fontFamily: "'Inter', sans-serif", textTransform: 'uppercase',
            writingMode: 'vertical-rl', transform: 'rotate(180deg)',
            userSelect: 'none',
          }}>
            FILES
          </span>
        </div>
      ) : (
        /* ── Expanded panel ── */
        <>
          {/* Header */}
          <div style={{
            padding: '10px 10px 8px 12px', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', borderBottom: '1px solid #2d2d2d', flexShrink: 0,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '1px',
              fontFamily: "'Inter', sans-serif", textTransform: 'uppercase',
            }}>
              Deal Documents
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Add document"
                style={{
                  background: 'none', border: '1px solid #3d3d3d', borderRadius: 4,
                  color: '#9ca3af', fontSize: 16, cursor: 'pointer', width: 22, height: 22,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                  padding: 0,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#555'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.borderColor = '#3d3d3d'; }}
              >
                +
              </button>
              <button
                onClick={onToggle}
                title="Collapse file explorer"
                style={{
                  background: 'none', border: 'none', color: RED, cursor: 'pointer',
                  fontSize: 20, padding: 0, lineHeight: 1,
                  width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ‹
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.pptx,.ppt"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>

          {/* File list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
            {docState.documents.length === 0 ? (
              <p style={{ fontSize: 11, color: '#555', textAlign: 'center', padding: '20px 12px', fontFamily: "'Inter', sans-serif" }}>
                No documents
              </p>
            ) : (
              docState.documents.map((doc, index) => {
                const isActive = index === docState.activeIndex;
                const isHovered = hoveredIndex === index;
                const badge = getTypeBadgeColor(doc.fileType);
                return (
                  <div
                    key={index}
                    onClick={() => docDispatch({ type: 'SWITCH_DOCUMENT', payload: index })}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    style={{
                      padding: '7px 28px 7px 8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 7,
                      background: isActive ? '#2d1f1f' : isHovered ? '#252525' : 'transparent',
                      borderLeft: isActive ? '2px solid #913d3e' : '2px solid transparent',
                      position: 'relative',
                    }}
                  >
                    <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{getFileIcon(doc.fileType)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11.5, color: isActive ? '#fff' : '#d1d5db',
                        fontFamily: "'Inter', sans-serif", fontWeight: isActive ? 600 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        lineHeight: 1.3,
                      }}>
                        {doc.name.length > 22 ? doc.name.substring(0, 20) + '…' : doc.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                          background: badge.bg, color: badge.color, fontFamily: "'Inter', sans-serif",
                          textTransform: 'uppercase',
                        }}>
                          {doc.fileType}
                        </span>
                        <span style={{ fontSize: 10, color: '#6b7280', fontFamily: "'Inter', sans-serif" }}>
                          {doc.file ? formatFileSize(doc.file.size) : 'saved'}
                        </span>
                        {doc.isProcessing && (
                          <span style={{ fontSize: 9, color: '#d97706', fontFamily: "'Inter', sans-serif" }}>
                            Processing…
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Remove button (only show when hovered/active and not the last doc) */}
                    {(isHovered || isActive) && docState.documents.length > 1 && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          docDispatch({ type: 'REMOVE_DOCUMENT', payload: index });
                        }}
                        title="Remove"
                        style={{
                          background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer',
                          fontSize: 16, padding: '0 2px', lineHeight: 1, flexShrink: 0,
                          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#6b7280'; }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── New Deal Modal ────────────────────────────────────────────
function NewDealModal({ onConfirm, onCancel }: {
  onConfirm: (name: string, sector: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [sector, setSector] = useState('Private Equity');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed, sector);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 6,
    border: '1px solid #e5e7eb', fontSize: 13, fontFamily: "'Inter', sans-serif",
    background: '#fff', color: NAVY, outline: 'none',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <p style={{ margin: '0 0 18px', fontSize: 16, fontWeight: 700, color: NAVY, fontFamily: "'Inter', sans-serif" }}>New Deal</p>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', marginBottom: 5, fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', fontFamily: "'Inter', sans-serif" }}>
            Deal Name *
          </label>
          <input
            ref={inputRef}
            type="text"
            placeholder="e.g. Acme Healthcare Services"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel(); }}
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: 22 }}>
          <label style={{ display: 'block', marginBottom: 5, fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', fontFamily: "'Inter', sans-serif" }}>
            Strategy
          </label>
          <select value={sector} onChange={e => setSector(e.target.value)} style={{ ...inputStyle, appearance: 'none' }}>
            <option>Private Equity</option>
            <option>Private Credit</option>
            <option>Venture Capital</option>
            <option>Real Estate</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '9px 18px', background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, fontFamily: "'Inter', sans-serif", cursor: 'pointer', color: '#6b7280' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!name.trim()} style={{ padding: '9px 22px', background: RED, color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: name.trim() ? 'pointer' : 'not-allowed', opacity: name.trim() ? 1 : 0.5, fontFamily: "'Inter', sans-serif" }}>
            Create Deal
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Home Screen ───────────────────────────────────────────────
function HomeScreen({ deals, loading, onNewDeal, onOpenDeal, onDeleteDeal }: {
  deals: Deal[];
  loading: boolean;
  onNewDeal: () => void;
  onOpenDeal: (deal: Deal) => void;
  onDeleteDeal: (dealId: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const sectorBadgeStyle = (sector: string): React.CSSProperties => ({
    fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
    background: '#f5f5f5', color: '#6b7280', border: '1px solid #e5e7eb',
    fontFamily: "'Inter', sans-serif", whiteSpace: 'nowrap',
  });

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: OFFWHITE }}>
      <style>{GLOBAL_STYLE}</style>

      {/* Header */}
      <div style={{ height: 52, background: RED, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ color: '#fff', fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: '3px' }}>SAGARD</span>
          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontFamily: "'Inter', sans-serif", fontWeight: 600, letterSpacing: '2px' }}>DEAL ROOM</span>
        </div>
        <button
          onClick={onNewDeal}
          style={{ background: '#fff', color: RED, border: `1px solid ${RED}`, borderRadius: 6, padding: '7px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'Inter', sans-serif", letterSpacing: '0.5px' }}
        >
          + NEW DEAL
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 0', maxWidth: 760, margin: '0 auto', width: '100%' }}>
        <p style={{ margin: '0 0 20px 28px', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '2px', fontFamily: "'Inter', sans-serif" }}>
          {loading ? 'Loading…' : `${deals.length} deal${deals.length !== 1 ? 's' : ''}`}
        </p>

        {loading && (
          <div style={{ padding: '0 28px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 76, background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', opacity: 0.5 + i * 0.15 }} />
            ))}
          </div>
        )}

        {!loading && deals.length === 0 && (
          <div style={{ textAlign: 'center', padding: '72px 20px' }}>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#374151', fontFamily: "'Inter', sans-serif", margin: '0 0 8px' }}>No deals yet.</p>
            <p style={{ fontSize: 13, color: '#9ca3af', fontFamily: "'Inter', sans-serif", margin: '0 0 24px' }}>Start by analyzing your first CIM.</p>
            <button onClick={onNewDeal} style={{ background: RED, color: '#fff', border: 'none', borderRadius: 7, padding: '11px 28px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>
              + Analyze your first CIM
            </button>
          </div>
        )}

        {!loading && deals.length > 0 && (
          <div style={{ padding: '0 28px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {deals.map(deal => {
              const isHovered = hoveredId === deal.id;
              const pill = deal.verdict ? dealVerdictPill[deal.verdict] : null;
              const statusColor: Record<string, string> = {
                'Active': '#6b7280', 'Worth Deeper Look': '#166534', 'Passed': '#991b1b', 'Closed': '#374151',
              };
              return (
                <div
                  key={deal.id}
                  onClick={() => onOpenDeal(deal)}
                  onMouseEnter={() => setHoveredId(deal.id)}
                  onMouseLeave={() => { setHoveredId(null); setConfirmDeleteId(null); }}
                  style={{
                    background: isHovered ? '#fef3f2' : '#fff',
                    border: `1px solid ${isHovered ? '#fecaca' : '#e5e7eb'}`,
                    borderRadius: 8, padding: '14px 18px',
                    display: 'flex', alignItems: 'center', gap: 14,
                    cursor: 'pointer', transition: 'all 0.15s',
                    boxShadow: isHovered ? '0 2px 8px rgba(145,61,62,0.08)' : '0 1px 2px rgba(0,0,0,0.04)',
                  }}
                >
                  {/* Deal name + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: NAVY, fontFamily: "'Inter', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                        {deal.name}
                      </span>
                      <span style={sectorBadgeStyle(deal.sector)}>{deal.sector}</span>
                      {pill && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: pill.bg, color: pill.color, border: `1px solid ${pill.border}`, fontFamily: "'Inter', sans-serif" }}>
                          {deal.verdict}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: statusColor[deal.status] ?? '#6b7280', fontFamily: "'Inter', sans-serif", fontWeight: 500 }}>
                        {deal.status}
                      </span>
                      <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: "'Inter', sans-serif" }}>
                        Updated {formatRelativeTime(deal.updated_at)}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    {confirmDeleteId === deal.id ? (
                      <>
                        <span style={{ fontSize: 11, color: '#6b7280', fontFamily: "'Inter', sans-serif" }}>Delete?</span>
                        <button
                          onClick={() => { onDeleteDeal(deal.id); setConfirmDeleteId(null); }}
                          style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <>
                        {isHovered && (
                          <button
                            onClick={() => setConfirmDeleteId(deal.id)}
                            style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 5, padding: '4px 8px', fontSize: 11, color: '#9ca3af', cursor: 'pointer', fontFamily: "'Inter', sans-serif", transition: 'all 0.15s' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#dc2626'; (e.currentTarget as HTMLButtonElement).style.color = '#dc2626'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#e5e7eb'; (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; }}
                          >
                            Delete
                          </button>
                        )}
                        <span style={{ color: isHovered ? RED : '#d1d5db', fontSize: 18, fontWeight: 300, transition: 'color 0.15s' }}>→</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Results ──────────────────────────────────────────────────
type ClaimFilter = "all" | "disputed" | "unverifiable" | "verified";
type ResultTab = "overview" | "claims" | "conflicts" | "chat" | "comps";

// ── Comps Tab ─────────────────────────────────────────────────
function CompsTab({ compsData, loading }: { compsData: CompsData | null; loading: boolean }) {
  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: OFFWHITE, padding: 40 }}>
        <div style={{ width: 32, height: 32, border: `3px solid #e5e7eb`, borderTop: `3px solid ${RED}`, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <p style={{ color: '#6b7280', fontSize: 13, fontFamily: 'Inter, sans-serif', margin: 0 }}>Searching for comparable transactions…</p>
        <p style={{ color: '#9ca3af', fontSize: 11, fontFamily: 'Inter, sans-serif', margin: 0 }}>Running targeted M&A database searches</p>
      </div>
    );
  }

  if (!compsData) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: OFFWHITE }}>
        <p style={{ color: '#9ca3af', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>No comparable transaction data available.</p>
      </div>
    );
  }

  const { deal_profile, comps, sector_context, this_deal_positioning, valuation_context, data_quality_note } = compsData;
  const validComps = (comps ?? []).filter(c => c.ev_ebitda !== null);
  const impliedMultiple = this_deal_positioning?.implied_ev_ebitda;

  // Build chart data — comps + "This Deal" if we have implied multiple
  const chartData = [
    ...validComps.map(c => ({
      name: c.company.length > 22 ? c.company.slice(0, 20) + '…' : c.company,
      multiple: c.ev_ebitda,
      isThisDeal: false,
    })),
    ...(impliedMultiple ? [{ name: 'This Deal', multiple: impliedMultiple, isThisDeal: true }] : []),
  ];

  const sectorLow = sector_context?.typical_ev_ebitda_low ?? null;
  const sectorHigh = sector_context?.typical_ev_ebitda_high ?? null;
  const maxMultiple = Math.max(
    ...(chartData.map(d => d.multiple ?? 0)),
    sectorHigh ?? 0,
    12
  ) + 1;

  const fmt = (v: number | null | undefined, suffix = 'x') =>
    v == null ? 'N/A' : `${v.toFixed(1)}${suffix}`;
  const fmtEV = (v: number | null | undefined) =>
    v == null ? 'N/A' : v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(0)}M`;

  const vsColor = this_deal_positioning?.vs_comp_set === 'Premium' ? '#d97706'
    : this_deal_positioning?.vs_comp_set === 'Discount' ? '#16a34a'
    : this_deal_positioning?.vs_comp_set === 'In line' ? '#166534'
    : '#6b7280';

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: OFFWHITE }}>

      {/* Deal Profile Header */}
      <div style={{ background: '#fff', padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
        <p style={{ margin: '0 0 8px', ...sectionLabel }}>SEARCH PROFILE</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, background: '#1a1a1a', color: '#fff', borderRadius: 4, padding: '2px 8px', fontFamily: 'Inter, sans-serif' }}>
            {deal_profile?.sector}
          </span>
          {deal_profile?.sub_sector && (
            <span style={{ fontSize: 11, fontWeight: 600, background: '#f5f5f5', color: '#374151', borderRadius: 4, padding: '2px 8px', border: '1px solid #e5e7eb', fontFamily: 'Inter, sans-serif' }}>
              {deal_profile.sub_sector}
            </span>
          )}
          {deal_profile?.geography && (
            <span style={{ fontSize: 11, color: '#6b7280', background: '#f5f5f5', borderRadius: 4, padding: '2px 8px', border: '1px solid #e5e7eb', fontFamily: 'Inter, sans-serif' }}>
              {deal_profile.geography}
            </span>
          )}
        </div>
        <p style={{ margin: '0 0 6px', fontSize: 12, color: '#374151', lineHeight: 1.5, fontFamily: 'Inter, sans-serif' }}>
          {deal_profile?.description}
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {deal_profile?.revenue_millions && (
            <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'Inter, sans-serif' }}>
              Revenue: <strong style={{ color: '#1a1a1a' }}>${deal_profile.revenue_millions}M</strong>
            </span>
          )}
          {deal_profile?.ebitda_millions && (
            <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'Inter, sans-serif' }}>
              EBITDA: <strong style={{ color: '#1a1a1a' }}>${deal_profile.ebitda_millions}M</strong>
            </span>
          )}
          {deal_profile?.ebitda_margin_pct && (
            <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'Inter, sans-serif' }}>
              Margin: <strong style={{ color: '#1a1a1a' }}>{deal_profile.ebitda_margin_pct}%</strong>
            </span>
          )}
        </div>
      </div>

      {/* Comps Table */}
      <div style={{ background: '#fff', margin: '6px 0', padding: '14px 16px', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
        <p style={{ margin: '0 0 10px', ...sectionLabel }}>COMPARABLE TRANSACTIONS ({comps?.length ?? 0})</p>
        {(comps?.length ?? 0) === 0 ? (
          <p style={{ fontSize: 12, color: '#9ca3af', fontFamily: 'Inter, sans-serif' }}>No confirmed comparable transactions found in public sources.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'Inter, sans-serif' }}>
              <thead>
                <tr style={{ background: '#f8f6f3', borderBottom: '2px solid #e5e7eb' }}>
                  {['Company', 'Acquirer', 'Date', 'EV', 'EV/EBITDA', 'EV/Rev', 'Notes'].map(h => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: h === 'EV' || h === 'EV/EBITDA' || h === 'EV/Rev' ? 'right' : 'left', fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comps.map((comp, i) => {
                  const multipleColor = comp.ev_ebitda == null ? '#9ca3af'
                    : sectorLow && comp.ev_ebitda < sectorLow ? '#16a34a'
                    : sectorHigh && comp.ev_ebitda > sectorHigh ? '#dc2626'
                    : '#1a1a1a';
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #f0ede8', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1a1a1a' }}>
                        {comp.source_url ? (
                          <a href={comp.source_url} target="_blank" rel="noreferrer" style={{ color: '#1a1a1a', textDecoration: 'none' }}>
                            {comp.company} <span style={{ color: RED, fontSize: 9 }}>↗</span>
                          </a>
                        ) : comp.company}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#374151' }}>{comp.acquirer}</td>
                      <td style={{ padding: '8px 10px', color: '#6b7280', whiteSpace: 'nowrap' }}>{comp.date}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151', whiteSpace: 'nowrap' }}>{fmtEV(comp.ev_millions)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: multipleColor, whiteSpace: 'nowrap' }}>{fmt(comp.ev_ebitda)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151', whiteSpace: 'nowrap' }}>{fmt(comp.ev_revenue)}</td>
                      <td style={{ padding: '8px 10px', color: '#6b7280', maxWidth: 140 }}>
                        <div title={comp.why_comparable} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {comp.why_comparable}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {/* Sector range row */}
                {sectorLow && sectorHigh && (
                  <tr style={{ borderTop: '2px solid #e5e7eb', background: '#f8f6f3' }}>
                    <td colSpan={4} style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Sector Range
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: '#374151', fontSize: 11 }}>
                      {sectorLow.toFixed(1)}x – {sectorHigh.toFixed(1)}x
                    </td>
                    <td colSpan={2} />
                  </tr>
                )}
                {/* This Deal row */}
                {impliedMultiple && (
                  <tr style={{ background: '#fef3f2', borderTop: '1px solid #fecaca' }}>
                    <td colSpan={4} style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, color: RED, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      This Deal (Implied)
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: RED, fontSize: 11 }}>
                      {impliedMultiple.toFixed(1)}x
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: RED, fontSize: 11 }}>
                      {fmt(this_deal_positioning?.implied_ev_revenue)}
                    </td>
                    <td style={{ padding: '7px 10px', fontSize: 10, color: RED, fontStyle: 'italic' }}>
                      {this_deal_positioning?.vs_comp_set}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Multiple Range Chart */}
      {chartData.length > 0 && (
        <div style={{ background: '#fff', margin: '6px 0', padding: '14px 16px', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
          <p style={{ margin: '0 0 4px', ...sectionLabel }}>EV/EBITDA MULTIPLE RANGE</p>
          <p style={{ margin: '0 0 12px', fontSize: 11, color: '#9ca3af', fontFamily: 'Inter, sans-serif' }}>
            Comparable transactions vs. this deal
          </p>
          <ResponsiveContainer width="100%" height={chartData.length * 36 + 50}>
            <BarChart layout="vertical" data={chartData} margin={{ top: 5, right: 40, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0ede8" />
              <XAxis
                type="number"
                domain={[0, maxMultiple]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `${v}x`}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                tick={{ fontSize: 10, fontFamily: 'Inter, sans-serif' }}
              />
              <Tooltip
                formatter={(v: any) => [`${(v as number).toFixed(1)}x EV/EBITDA`, '']}
                contentStyle={{ fontFamily: 'Inter, sans-serif', fontSize: 11 }}
              />
              <Bar dataKey="multiple" radius={[0, 3, 3, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.isThisDeal ? RED : entry.multiple && sectorHigh && entry.multiple > sectorHigh ? '#d97706' : NAVY} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {sectorLow && sectorHigh && (
            <p style={{ margin: '4px 0 0', fontSize: 10, color: '#9ca3af', fontFamily: 'Inter, sans-serif', textAlign: 'center' }}>
              Sector range: {sectorLow.toFixed(1)}x – {sectorHigh.toFixed(1)}x EV/EBITDA
            </p>
          )}
        </div>
      )}

      {/* Deal Positioning */}
      {this_deal_positioning?.vs_comp_set && this_deal_positioning.vs_comp_set !== 'Cannot determine' && (
        <div style={{ background: '#fff', margin: '6px 0', padding: '14px 16px', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <p style={{ margin: 0, ...sectionLabel }}>DEAL POSITIONING</p>
            <span style={{ fontSize: 11, fontWeight: 700, color: vsColor, background: vsColor + '15', border: `1px solid ${vsColor}40`, borderRadius: 4, padding: '2px 8px', fontFamily: 'Inter, sans-serif' }}>
              {this_deal_positioning.vs_comp_set.toUpperCase()}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.6, fontFamily: 'Inter, sans-serif' }}>
            {this_deal_positioning.rationale}
          </p>
        </div>
      )}

      {/* Sector Context */}
      {sector_context && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '6px', margin: '0 0 6px' }}>
          <div style={{ background: '#fff', padding: '12px', borderRadius: 6, border: '1px solid #e5e7eb' }}>
            <p style={{ margin: '0 0 8px', ...sectionLabel, color: '#16a34a' }}>PREMIUM DRIVERS</p>
            {(sector_context.multiple_drivers ?? []).map((d, i) => (
              <div key={i} style={{ borderLeft: '2px solid #16a34a', paddingLeft: 8, marginBottom: 6 }}>
                <p style={{ margin: 0, fontSize: 11, color: '#374151', lineHeight: 1.4, fontFamily: 'Inter, sans-serif' }}>{d}</p>
              </div>
            ))}
          </div>
          <div style={{ background: '#fff', padding: '12px', borderRadius: 6, border: '1px solid #e5e7eb' }}>
            <p style={{ margin: '0 0 8px', ...sectionLabel, color: '#dc2626' }}>DISCOUNT DRIVERS</p>
            {(sector_context.discount_drivers ?? []).map((d, i) => (
              <div key={i} style={{ borderLeft: '2px solid #dc2626', paddingLeft: 8, marginBottom: 6 }}>
                <p style={{ margin: 0, fontSize: 11, color: '#374151', lineHeight: 1.4, fontFamily: 'Inter, sans-serif' }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Valuation Context */}
      {valuation_context && (
        <div style={{ background: '#fff', margin: '0 0 6px', padding: '14px 16px', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
          <p style={{ margin: '0 0 10px', ...sectionLabel }}>VALUATION CONTEXT</p>
          {valuation_context.split('\n\n').filter(Boolean).map((para, i) => (
            <p key={i} style={{ margin: '0 0 10px', fontSize: 12, color: '#374151', lineHeight: 1.7, fontFamily: 'Inter, sans-serif' }}>{para}</p>
          ))}
        </div>
      )}

      {/* Data Quality Notice */}
      <div style={{ margin: '0 0 16px', padding: '10px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, marginLeft: 16, marginRight: 16 }}>
        <p style={{ margin: 0, fontSize: 11, color: '#92400e', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
          <strong>Data Quality:</strong> {data_quality_note ?? 'Comps are sourced from public web data and may be incomplete. Verify with PitchBook or CapIQ before use in any IC memo.'}
        </p>
      </div>

    </div>
  );
}

function Results({
  data, uploadedFiles, onReset, documentText, documentsText, chartsData,
  compsData, compsLoading, savedDocEntries, initialChatMessages,
  dealName, dealStatus, onStatusChange, onSaveChatMessage, saveError, onBackToHome,
  onDocumentExtracted,
}: {
  data: AnalysisResult;
  uploadedFiles: File[];
  onReset: () => void;
  documentText: string;
  documentsText: Record<string, string>;
  chartsData: any;
  compsData: CompsData | null;
  compsLoading: boolean;
  savedDocEntries?: DocEntry[];
  initialChatMessages?: ChatMessage[];
  dealName: string;
  dealStatus: string;
  onStatusChange: (s: string) => void;
  onSaveChatMessage: (msg: ChatMessage) => void;
  saveError: boolean;
  onBackToHome: () => void;
  onDocumentExtracted?: (filename: string, fileType: FileType, text: string) => void;
}) {
  const { assessment, claims, cross_document_conflicts } = data;
  const [activeClaim, setActiveClaim] = useState<number | null>(null);
  const [claimFilter, setClaimFilter] = useState<ClaimFilter>("all");
  const overallCfg = overallConfig[assessment.overall_verdict] ?? overallConfig["Pass"];
  const stats = assessment.summary_stats ?? { verified: 0, disputed: 0, unverifiable: 0 };
  const conflicts = cross_document_conflicts ?? [];
  const activePage = activeClaim !== null ? (claims[activeClaim]?.page ?? null) : null;
  const [activeTab, setActiveTab] = useState<ResultTab>("overview");
  const dealScore: number = chartsData?.deal_scorecard?.overall_score ?? 0;
  const dealScoreColor = dealScore < 5 ? '#dc2626' : dealScore <= 7 ? '#d97706' : '#16a34a';
  const companyName = dealName || uploadedFiles[0]?.name.replace(/\.[^.]+$/, '') || 'Analysis';

  // File explorer collapse state
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);

  // ── Resize state ──────────────────────────────────────────────
  const mainContainerRef = useRef<HTMLDivElement>(null);

  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem('cim-right-panel-width'));
      return n >= 380 && n <= 1400 ? n : 480;
    } catch { return 480; }
  });
  const [explorerWidth, setExplorerWidth] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem('cim-explorer-width'));
      return n >= 140 && n <= 400 ? n : 220;
    } catch { return 220; }
  });

  useEffect(() => { try { localStorage.setItem('cim-right-panel-width', String(rightPanelWidth)); } catch {} }, [rightPanelWidth]);
  useEffect(() => { try { localStorage.setItem('cim-explorer-width', String(explorerWidth)); } catch {} }, [explorerWidth]);

  // Clamp panels when window is resized
  useEffect(() => {
    const clamp = () => {
      const total = mainContainerRef.current?.offsetWidth ?? window.innerWidth;
      setRightPanelWidth(w => Math.max(380, Math.min(w, total - 300)));
      setExplorerWidth(w => Math.max(140, Math.min(w, 360)));
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  // Stable refs so drag callbacks don't go stale
  const explorerWidthRef = useRef(explorerWidth);
  useEffect(() => { explorerWidthRef.current = explorerWidth; }, [explorerWidth]);
  const explorerCollapsedRef = useRef(explorerCollapsed);
  useEffect(() => { explorerCollapsedRef.current = explorerCollapsed; }, [explorerCollapsed]);

  const handleMainDividerDrag = useCallback((dx: number) => {
    setRightPanelWidth(prev => {
      const total = mainContainerRef.current?.offsetWidth ?? window.innerWidth;
      const explorerW = explorerCollapsedRef.current ? 36 : explorerWidthRef.current;
      return Math.max(380, Math.min(prev - dx, total - explorerW - 300));
    });
  }, []);

  const handleExplorerDividerDrag = useCallback((dx: number) => {
    setExplorerWidth(prev => Math.max(140, Math.min(prev + dx, 360)));
  }, []);

  // Document state via useReducer — single source of truth, eliminates stale closure issues
  const [docState, docDispatch] = useReducer(documentReducer, {
    documents: [], activeIndex: 0, currentPage: 1,
  });
  const docStateRef = useRef(docState);
  useEffect(() => { docStateRef.current = docState; }, [docState]);

  // Holds the page to jump to after a cross-doc switch completes (set by jumpToPage, consumed by onNumPages)
  const pendingPageAfterSwitchRef = useRef<number | null>(null);

  // Reliable navigation: dispatches state update + polls querySelector until the page div exists, then scrolls
  const navigateTo = useCallback((page: number) => {
    const state = docStateRef.current;
    const maxPage = state.documents[state.activeIndex]?.numPages;
    const target = maxPage ? Math.max(1, Math.min(page, maxPage)) : Math.max(1, page);
    docDispatch({ type: 'SET_PAGE', payload: target });
    let attempts = 0;
    const iv = setInterval(() => {
      attempts++;
      const el = document.querySelector(`[data-page-number="${target}"]`);
      if (el) { (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' }); clearInterval(iv); }
      else if (attempts >= 30) clearInterval(iv);
    }, 100);
  }, [docDispatch]); // docStateRef and docDispatch are both stable
  const navigateToRef = useRef(navigateTo);
  useEffect(() => { navigateToRef.current = navigateTo; }, [navigateTo]);

  // Create object URLs when uploaded files change; revoke on cleanup.
  // Falls back to savedDocEntries when there are no live files (loaded from DB).
  useEffect(() => {
    if (uploadedFiles.length > 0) {
      const docs: DocEntry[] = uploadedFiles.map(f => ({
        file: f, name: f.name, url: URL.createObjectURL(f), numPages: null,
        extractedText: documentsText[f.name] ?? '',
        isProcessing: false,
        fileType: getFileType(f.name),
      }));
      docDispatch({ type: 'LOAD_DOCUMENTS', payload: docs });
      return () => { docs.forEach(d => URL.revokeObjectURL(d.url)); };
    } else if (savedDocEntries && savedDocEntries.length > 0) {
      docDispatch({ type: 'LOAD_DOCUMENTS', payload: savedDocEntries });
    }
  }, [uploadedFiles, savedDocEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose window.jumpToPage — registered once, reads only docStateRef (always current)
  useEffect(() => {
    (window as any).jumpToPage = (page: number, docName?: string) => {
      const state = docStateRef.current;
      let targetIndex = state.activeIndex;

      if (docName) {
        const clean = docName.trim().toLowerCase()
          .replace(/\.(pdf|pptx|xlsx|docx)$/i, '')
          .replace(/[-_]/g, ' ')
          .trim();
        const words = clean.split(/\s+/).filter((w: string) => w.length > 2);

        const scored = state.documents.map((doc: DocEntry, index: number) => {
          const docClean = doc.name.toLowerCase()
            .replace(/\.(pdf|pptx|xlsx|docx)$/i, '')
            .replace(/[-_]/g, ' ')
            .trim();
          const docWords = docClean.split(/\s+/).filter((w: string) => w.length > 2);

          let score = 0;
          if (docClean === clean) score += 100;
          if (docClean.includes(clean)) score += 50;
          if (clean.includes(docClean)) score += 50;
          const matchingWords = words.filter((w: string) =>
            docWords.some((dw: string) => dw.includes(w) || w.includes(dw))
          );
          score += matchingWords.length * 20;
          if (clean === 'cim' && index === 0) score += 40;
          if ((clean.includes('management') || clean.includes('presentation')) &&
              (docClean.includes('management') || docClean.includes('presentation'))) score += 40;
          return { index, score };
        });

        scored.sort((a: { index: number; score: number }, b: { index: number; score: number }) => b.score - a.score);

        if (scored[0].score > 0 && scored[0].index !== state.activeIndex) {
          targetIndex = scored[0].index;
        } else if (scored[0].score === 0 && state.documents.length === 2) {
          // Last resort: 2 docs, no match — switch to the other one
          targetIndex = state.activeIndex === 0 ? 1 : 0;
        }
      }

      if (targetIndex !== state.activeIndex) {
        // Store the target page; it will be applied once the new PDF fires onNumPages
        pendingPageAfterSwitchRef.current = page;
        docDispatch({ type: 'SWITCH_DOCUMENT', payload: targetIndex });
      } else {
        navigateToRef.current(page);
      }

      setTimeout(() => {
        document.getElementById('pdf-viewer-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    };
    return () => { delete (window as any).jumpToPage; };
  }, []); // empty deps — reads docStateRef (always current) and docDispatch (stable)

  // Chat state — seeded from DB when loading a saved deal
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialChatMessages ?? []);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    const historySnapshot = [...chatMessages];
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsgObj: ChatMessage = { role: 'user', content: userMsg, timestamp: ts };
    setChatMessages(prev => [...prev, userMsgObj]);
    onSaveChatMessage(userMsgObj);
    setChatInput('');
    setChatLoading(true);
    try {
      const formData = new FormData();
      formData.append('message', userMsg);
      const allDocText = docStateRef.current.documents
        .filter(d => d.extractedText)
        .map(d => `${'#'.repeat(60)}\nDOCUMENT: ${d.name}\n${'#'.repeat(60)}\n${d.extractedText}`)
        .join('\n\n');
      formData.append('document_text', allDocText || documentText);
      formData.append('history', JSON.stringify(historySnapshot));
      formData.append('document_names', docStateRef.current.documents.map(d => d.name).join(', '));
      const { data: resp } = await axios.post<{ response: string }>(`${API_BASE_URL}/chat`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: resp.response,
        segments: parseResponseSegments(resp.response),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages(prev => [...prev, assistantMsg]);
      onSaveChatMessage(assistantMsg);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.', timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
    } finally {
      setChatLoading(false);
    }
  };

  const copyDiligenceQuestions = (e: React.MouseEvent) => {
    e.stopPropagation();
    const q = claims.filter(c => c.diligence_question).map((c, i) => `${i + 1}. ${c.diligence_question}`).join("\n");
    navigator.clipboard.writeText(q);
    alert("Diligence questions copied!");
  };

  const exportICBrief = () => {
    const div = document.createElement("div");
    div.id = "ic-brief-print";
    div.style.cssText = "display:none;";
    div.innerHTML = buildICBrief(assessment, claims, conflicts, uploadedFiles[0]?.name ?? 'Document');
    document.body.appendChild(div);
    window.print();
    document.body.removeChild(div);
  };

  const filteredClaims = claims.filter(c =>
    claimFilter === "all" ? true : claimFilter === "unverifiable" ? c.verdict === "unverifiable" : c.verdict === claimFilter
  );

  const panelBtnBase: React.CSSProperties = {
    padding: '4px 10px', border: '1px solid #e5e7eb', borderRadius: 4,
    fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <style>{GLOBAL_STYLE}</style>

      {/* Nav bar */}
      <div style={{ height: 48, background: RED, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", flexShrink: 0 }}>
        {/* Left: back button + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={onBackToHome}
            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', borderRadius: 5, padding: '4px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter', sans-serif", whiteSpace: 'nowrap' }}
          >
            ← All Deals
          </button>
          <span style={{ color: "#fff", fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: "3px" }}>SAGARD</span>
          {dealName && (
            <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "'Inter', sans-serif", fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
              {dealName}
            </span>
          )}
        </div>
        {/* Right: save error + status dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {saveError && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,200,0.9)', fontFamily: "'Inter', sans-serif", animation: 'pulse 1s ease-in-out' }}>
              ⚠ Not saved
            </span>
          )}
          <select
            value={dealStatus}
            onChange={e => onStatusChange(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', borderRadius: 5, padding: '4px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter', sans-serif", outline: 'none' }}
          >
            <option style={{ background: '#913d3e', color: '#fff' }}>Active</option>
            <option style={{ background: '#913d3e', color: '#fff' }}>Worth Deeper Look</option>
            <option style={{ background: '#913d3e', color: '#fff' }}>Passed</option>
            <option style={{ background: '#913d3e', color: '#fff' }}>Closed</option>
          </select>
        </div>
      </div>

      {/* Main split */}
      <div ref={mainContainerRef} style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* File Explorer */}
        <FileExplorer
          docState={docState}
          docDispatch={docDispatch}
          collapsed={explorerCollapsed}
          onToggle={() => setExplorerCollapsed(c => !c)}
          onDocumentExtracted={onDocumentExtracted}
          expandedWidth={explorerWidth}
        />

        {/* Drag divider: Explorer | PDF */}
        <DragDivider onDrag={handleExplorerDividerDrag} dark={true} />

        {/* Center: PDF */}
        <div id="pdf-viewer-panel" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: '#ffffff', borderBottom: '1px solid #e5e7eb', fontSize: 11, fontFamily: 'Inter, sans-serif', color: '#6b7280' }}>
            <button onClick={() => navigateTo(docState.currentPage - 1)} disabled={docState.currentPage <= 1}
              style={{ background: 'none', border: 'none', cursor: docState.currentPage <= 1 ? 'default' : 'pointer', color: RED, fontWeight: 600, fontSize: 13, padding: '0 4px', opacity: docState.currentPage <= 1 ? 0.3 : 1 }}>←</button>
            <span>Page {docState.currentPage}{docState.documents[docState.activeIndex]?.numPages ? ` of ${docState.documents[docState.activeIndex].numPages}` : ''}</span>
            <button onClick={() => navigateTo(docState.currentPage + 1)}
              disabled={!!(docState.documents[docState.activeIndex]?.numPages && docState.currentPage >= (docState.documents[docState.activeIndex].numPages ?? Infinity))}
              style={{ background: 'none', border: 'none', cursor: (docState.documents[docState.activeIndex]?.numPages && docState.currentPage >= (docState.documents[docState.activeIndex].numPages ?? Infinity)) ? 'default' : 'pointer', color: RED, fontWeight: 600, fontSize: 13, padding: '0 4px', opacity: (docState.documents[docState.activeIndex]?.numPages && docState.currentPage >= (docState.documents[docState.activeIndex].numPages ?? Infinity)) ? 0.3 : 1 }}>→</button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {docState.documents[docState.activeIndex]?.url ? (
              <PDFViewer
                file={docState.documents[docState.activeIndex].url}
                claims={claims}
                activePage={activePage}
                currentPage={docState.currentPage}
                onPageChange={(p) => docDispatch({ type: 'SET_PAGE', payload: p })}
                onNumPages={(n) => {
                  docDispatch({ type: 'SET_NUM_PAGES', payload: n });
                  if (pendingPageAfterSwitchRef.current !== null) {
                    const targetPage = pendingPageAfterSwitchRef.current;
                    pendingPageAfterSwitchRef.current = null;
                    navigateToRef.current(targetPage);
                  }
                }}
              />
            ) : docState.documents.length > 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#3c3f41', gap: 10 }}>
                <span style={{ fontSize: 28, opacity: 0.4 }}>📄</span>
                <p style={{ color: '#9ca3af', fontSize: 13, fontFamily: 'Inter, sans-serif', margin: 0, textAlign: 'center', lineHeight: 1.5 }}>
                  PDF not available
                </p>
                <p style={{ color: '#6b7280', fontSize: 11, fontFamily: 'Inter, sans-serif', margin: 0, textAlign: 'center' }}>
                  Re-upload this document to view it.<br />Text content is still available for chat.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Drag divider: PDF | Analysis */}
        <DragDivider onDrag={handleMainDividerDrag} dark={false} />

        {/* Right: Analysis — tabbed dashboard */}
        <div style={{ width: rightPanelWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

          {/* Panel header — company name + verdict pill + actions */}
          <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#fff', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, overflow: 'hidden' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {companyName}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: overallCfg.bg, color: overallCfg.color, border: `1px solid ${overallCfg.color}40`, fontFamily: 'Inter, sans-serif', letterSpacing: '0.5px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {assessment.overall_verdict.toUpperCase()}
              </span>
              {dealScore > 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, color: dealScoreColor, fontFamily: 'Inter, sans-serif', flexShrink: 0 }}>{dealScore}/10</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
              <button onClick={exportICBrief} style={{ ...panelBtnBase, background: '#f8f6f3', color: '#374151' }}>Export IC</button>
              <button onClick={onReset} style={{ ...panelBtnBase, background: RED, color: '#fff', border: 'none' }}>New CIM</button>
            </div>
          </div>

          {/* Tab bar */}
          <div style={{ background: '#f8f6f3', borderBottom: '1px solid #e5e7eb', padding: '0 16px', height: 40, display: 'flex', alignItems: 'flex-end', flexShrink: 0 }}>
            {(['overview', 'claims', 'conflicts', 'chat', 'comps'] as ResultTab[]).map(tab => {
              let label: string;
              if (tab === 'conflicts') label = `CONFLICTS${conflicts.length > 0 ? ` (${conflicts.length})` : ''}`;
              else if (tab === 'comps') {
                if (compsLoading) label = 'COMPS…';
                else if (compsData) label = `COMPS (${compsData.comps?.length ?? 0})`;
                else label = 'COMPS';
              } else {
                label = tab.toUpperCase();
              }
              return (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  padding: '0 13px 10px 13px', fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
                  letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer',
                  color: activeTab === tab ? RED : '#6b7280',
                  border: 'none', borderBottom: activeTab === tab ? `2px solid ${RED}` : '2px solid transparent',
                  background: 'transparent',
                }}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* Tab content area */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {/* ── OVERVIEW TAB ── */}
            {activeTab === 'overview' && (
              <div style={{ flex: 1, overflowY: 'auto', background: OFFWHITE }}>
                {/* Verdict + stats */}
                <div style={{ background: '#fff', padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
                  <p style={{ margin: '0 0 8px', ...sectionLabel }}>FIRST-PASS VERDICT</p>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4, background: overallCfg.bg, color: overallCfg.color, border: `1px solid ${overallCfg.color}40`, fontFamily: 'Inter, sans-serif', flexShrink: 0 }}>
                      {assessment.overall_verdict.toUpperCase()}
                    </span>
                    <p style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.5, fontFamily: 'Inter, sans-serif' }}>{assessment.reasoning}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[
                      { label: 'VERIFIED', count: stats.verified, color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
                      { label: 'DISPUTED', count: stats.disputed, color: '#92400e', bg: '#fffbeb', border: '#fde68a' },
                      { label: 'ASK MGMT', count: stats.unverifiable, color: '#991b1b', bg: '#fdf2f2', border: '#fecaca' },
                    ].map(s => (
                      <div key={s.label} style={{ flex: 1, textAlign: 'center', padding: '6px 8px', background: s.bg, border: `1px solid ${s.border}`, borderRadius: 4 }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: 'Inter, sans-serif', lineHeight: 1 }}>{s.count}</div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: s.color, fontFamily: 'Inter, sans-serif', marginTop: 3, letterSpacing: '0.5px' }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {assessment.criteria_fit && (
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: assessment.criteria_fit.fits ? '#f0fdf4' : '#fdf2f2', color: assessment.criteria_fit.fits ? '#166534' : '#991b1b', border: `1px solid ${assessment.criteria_fit.fits ? '#bbf7d0' : '#fecaca'}`, fontFamily: 'Inter, sans-serif' }}>
                        {assessment.criteria_fit.fits ? 'Fits criteria' : 'Outside criteria'}
                      </span>
                      <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'Inter, sans-serif' }}>{assessment.criteria_fit.explanation}</span>
                    </div>
                  )}
                </div>

                {/* Company snapshot */}
                {assessment.company_snapshot && (
                  <div style={{ background: '#fff', padding: '12px 16px', borderBottom: '1px solid #e5e7eb', marginTop: 6 }}>
                    <p style={{ margin: '0 0 6px', ...sectionLabel }}>COMPANY</p>
                    <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.6, fontFamily: 'Inter, sans-serif' }}>{assessment.company_snapshot}</p>
                  </div>
                )}

                {/* Seller narrative */}
                {assessment.sellers_narrative && (
                  <div style={{ background: '#fff', padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <p style={{ margin: 0, ...sectionLabel }}>SELLER NARRATIVE</p>
                      {assessment.narrative_holds_up && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: assessment.narrative_holds_up.holds ? '#166534' : '#991b1b', fontFamily: 'Inter, sans-serif' }}>
                          {assessment.narrative_holds_up.holds ? 'Holds up' : 'Does not hold'}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.5, fontFamily: 'Inter, sans-serif', borderLeft: '2px solid #e5e7eb', paddingLeft: 10 }}>{assessment.sellers_narrative}</p>
                    {assessment.narrative_holds_up?.explanation && (
                      <p style={{ margin: '6px 0 0', fontSize: 11, color: '#6b7280', fontFamily: 'Inter, sans-serif' }}>{assessment.narrative_holds_up.explanation}</p>
                    )}
                  </div>
                )}

                {/* Risks + Bull case two-column */}
                {(assessment.top_risks?.length > 0 || assessment.bull_case) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '6px', marginTop: 6 }}>
                    <div style={{ background: '#fff', padding: '12px', borderRadius: 6, border: '1px solid #e5e7eb', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
                      <p style={{ margin: '0 0 8px', ...sectionLabel }}>RISKS</p>
                      {assessment.top_risks?.map((risk, i) => (
                        <div key={i} style={{ borderLeft: '2px solid #dc2626', paddingLeft: 8, marginBottom: 6 }}>
                          <p style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.4, fontFamily: 'Inter, sans-serif' }}>{risk}</p>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: '#fff', padding: '12px', borderRadius: 6, border: '1px solid #e5e7eb', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
                      <p style={{ margin: '0 0 8px', ...sectionLabel, color: '#16a34a' }}>BULL CASE</p>
                      {assessment.bull_case && (
                        <div style={{ borderLeft: '2px solid #16a34a', paddingLeft: 8 }}>
                          <p style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.4, fontFamily: 'Inter, sans-serif' }}>{assessment.bull_case}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Key questions */}
                {assessment.key_questions?.length > 0 && (
                  <div style={{ background: '#fff', padding: '12px 16px', margin: '6px 0', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
                    <p style={{ margin: '0 0 8px', ...sectionLabel }}>MUST ANSWER</p>
                    {assessment.key_questions.map((q, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: RED, flexShrink: 0, fontFamily: 'Inter, sans-serif' }}>{i + 1}.</span>
                        <p style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.5, fontFamily: 'Inter, sans-serif' }}>{q}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Charts */}
                {chartsData && <ChartsSection chartsData={chartsData} />}
              </div>
            )}

            {/* ── CLAIMS TAB ── */}
            {activeTab === 'claims' && (
              <div style={{ flex: 1, overflowY: 'auto', background: OFFWHITE }}>
                {/* Filter row */}
                <div style={{ background: '#fff', padding: '10px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'Inter, sans-serif', marginRight: 4 }}>{claims.length} claims</span>
                  {(["all", "disputed", "unverifiable", "verified"] as ClaimFilter[]).map(tab => (
                    <button key={tab} onClick={() => setClaimFilter(tab)} style={{
                      padding: '3px 9px', fontSize: 10, fontWeight: 600, letterSpacing: '0.5px',
                      textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'Inter, sans-serif', borderRadius: 4,
                      background: claimFilter === tab ? RED : 'transparent',
                      color: claimFilter === tab ? '#fff' : '#6b7280',
                      border: `1px solid ${claimFilter === tab ? RED : '#e5e7eb'}`,
                    }}>
                      {tab === 'unverifiable' ? 'Ask Mgmt' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                      {tab !== 'all' && <span style={{ marginLeft: 3, opacity: 0.7 }}>({claims.filter(c => c.verdict === tab).length})</span>}
                    </button>
                  ))}
                </div>
                <div style={{ padding: '8px 12px' }}>
                  {filteredClaims.length === 0 ? (
                    <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', padding: '20px 0', fontFamily: 'Inter, sans-serif' }}>No claims in this category.</p>
                  ) : filteredClaims.map(claim => {
                    const idx = claims.indexOf(claim);
                    return <ClaimCard key={claim.id ?? idx} claim={claim} index={idx} isActive={activeClaim === idx} onClick={() => setActiveClaim(activeClaim === idx ? null : idx)} />;
                  })}
                </div>
                {claims.filter(c => c.diligence_question).length > 0 && (
                  <div style={{ background: '#fff', margin: '6px 0', padding: '12px 16px', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <p style={{ margin: 0, ...sectionLabel }}>DILIGENCE CHECKLIST</p>
                      <button onClick={copyDiligenceQuestions} style={{ background: RED, color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Copy all</button>
                    </div>
                    {claims.filter(c => c.diligence_question).map((c, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                        <span style={{ flexShrink: 0, width: 16, height: 16, borderRadius: '50%', background: RED, color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>{i + 1}</span>
                        <p style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.5, fontFamily: 'Inter, sans-serif' }}>{c.diligence_question}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── CONFLICTS TAB ── */}
            {activeTab === 'conflicts' && (
              <div style={{ flex: 1, overflowY: 'auto', background: OFFWHITE }}>
                {conflicts.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px 20px', color: '#6b7280', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
                    No cross-document conflicts detected.
                  </div>
                ) : (
                  <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {conflicts.map((c, i) => {
                      const sev = severityConfig[c.severity] ?? severityConfig.low;
                      return (
                        <div key={i} style={{ background: '#fff', borderRadius: 6, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
                          <div style={{ borderLeft: `3px solid ${sev.color}`, padding: '10px 12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>{c.doc1} vs {c.doc2}</span>
                              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: sev.color, background: sev.bg, border: `1px solid ${sev.border}`, borderRadius: 3, padding: '1px 6px', fontFamily: 'Inter, sans-serif' }}>{sev.label}</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                              {[{ label: c.doc1, text: c.claim1 }, { label: c.doc2, text: c.claim2 }].map((side, j) => (
                                <div key={j} style={{ background: '#f8f6f3', borderRadius: 4, padding: '6px 8px', border: '1px solid #e5e7eb' }}>
                                  <p style={{ margin: '0 0 2px', fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif' }}>{side.label}</p>
                                  <p style={{ margin: 0, fontSize: 11, color: '#374151', lineHeight: 1.4, fontFamily: 'Inter, sans-serif' }}>{side.text}</p>
                                </div>
                              ))}
                            </div>
                            <p style={{ margin: 0, fontSize: 11, color: sev.color, fontWeight: 500, fontFamily: 'Inter, sans-serif' }}>{c.explanation}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── COMPS TAB ── */}
            {activeTab === 'comps' && (
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <CompsTab compsData={compsData} loading={compsLoading} />
              </div>
            )}

            {/* ── CHAT TAB ── */}
            {activeTab === 'chat' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' }}>
                {/* Message history */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 4px' }}>
                  {chatMessages.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '48px 20px', color: '#9ca3af', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
                      Ask anything about this deal
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {chatMessages.map((msg, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        {msg.role === 'user' ? (
                          <div style={{ maxWidth: '75%' }}>
                            <div style={{ background: RED, color: '#fff', borderRadius: '12px 12px 2px 12px', padding: '8px 12px', fontSize: 13, fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
                              {msg.content}
                            </div>
                            {msg.timestamp && <div style={{ fontSize: 10, color: '#9ca3af', textAlign: 'right', marginTop: 3, fontFamily: 'Inter, sans-serif' }}>{msg.timestamp}</div>}
                          </div>
                        ) : (
                          <div style={{ maxWidth: msg.segments?.some(s => s.type === 'chart') ? '100%' : '92%' }}>
                            <div style={{ borderLeft: '2px solid #e5e7eb', paddingLeft: 12, marginLeft: 4 }}>
                              {msg.segments ? (
                                msg.segments.map((segment, si) =>
                                  segment.type === 'chart' ? (
                                    <ChartRenderer key={si} chartData={segment.chartData} />
                                  ) : (
                                    <div key={si} dangerouslySetInnerHTML={{ __html: formatCitations(segment.content) }} />
                                  )
                                )
                              ) : (
                                <div dangerouslySetInnerHTML={{ __html: formatCitations(msg.content) }} />
                              )}
                            </div>
                            {msg.timestamp && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3, marginLeft: 16, fontFamily: 'Inter, sans-serif' }}>{msg.timestamp}</div>}
                          </div>
                        )}
                      </div>
                    ))}
                    {chatLoading && (
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <div style={{ borderLeft: '2px solid #e5e7eb', paddingLeft: 12, marginLeft: 4 }}>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 20 }}>
                            {[0, 1, 2].map(i => (
                              <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: RED, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>

                {/* Suggested questions */}
                <div style={{ padding: '8px 12px', borderTop: '1px solid #e5e7eb', background: '#f8f6f3', display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0 }}>
                  {[
                    'What are the three biggest red flags?',
                    'Show me a margin trend chart',
                    'Plot EBITDA by business unit as a bar chart',
                    'Does the narrative match the numbers?',
                    'What questions should I ask management?',
                    'Show me a deal scorecard radar chart',
                    'What is the revenue and EBITDA waterfall?',
                    'Where are the contradictions between documents?',
                  ].map((q, i) => (
                    <button key={i} onClick={() => { setChatInput(q); chatInputRef.current?.focus(); }}
                      style={{ padding: '4px 10px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11, fontFamily: 'Inter, sans-serif', fontWeight: 500, color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {q}
                    </button>
                  ))}
                </div>

                {/* Input row */}
                <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderTop: '1px solid #e5e7eb', background: '#fff', flexShrink: 0, alignItems: 'center' }}>
                  {chatMessages.length > 0 && (
                    <button onClick={() => setChatMessages([])} style={{ background: 'none', border: 'none', fontSize: 10, color: '#9ca3af', cursor: 'pointer', fontFamily: 'Inter, sans-serif', flexShrink: 0, padding: 0 }}>Clear</button>
                  )}
                  <input
                    ref={chatInputRef}
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') sendChatMessage(); }}
                    placeholder="Ask anything about this deal..."
                    style={{ flex: 1, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, fontFamily: 'Inter, sans-serif', outline: 'none', color: '#1a1a1a' }}
                    disabled={chatLoading}
                  />
                  <button onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()}
                    style={{ padding: '8px 16px', background: RED, color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: 'Inter, sans-serif', cursor: chatLoading || !chatInput.trim() ? 'not-allowed' : 'pointer', opacity: chatLoading || !chatInput.trim() ? 0.55 : 1 }}>
                    Send
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────
export default function App() {
  // Persistence
  const {
    loadDeals, loadDeal, createDeal, saveDeal,
    saveDocument, saveAnalysis, saveChatMessage, deleteDeal, saveError,
  } = useDealPersistence();

  // ── View routing ─────────────────────────────────────────────
  const [appView, setAppView]           = useState<AppView>('home');
  const [deals, setDeals]               = useState<Deal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [activeDealName, setActiveDealName]     = useState('');
  const [activeDealStatus, setActiveDealStatus] = useState('Active');
  const [showNewDealModal, setShowNewDealModal] = useState(false);
  const [dealWorkspaceLoading, setDealWorkspaceLoading] = useState(false);

  // ── Analysis state ───────────────────────────────────────────
  const [loading, setLoading]             = useState(false);
  const [loadingStep, setLoadingStep]     = useState(0);
  const [results, setResults]             = useState<AnalysisResult | null>(null);
  const [stagedFiles, setStagedFiles]     = useState<File[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [error, setError]                 = useState<string | null>(null);
  const [sector, setSector]               = useState("Private Equity");
  const [criteria, setCriteria]           = useState<InvestmentCriteria>({ minEbitda: "", dealSizeRange: "", targetSectors: "", geography: "" });
  const [documentText, setDocumentText]   = useState('');
  const [documentsText, setDocumentsText] = useState<Record<string, string>>({});
  const [chartsData, setChartsData]       = useState<any>(null);
  const [compsData, setCompsData]         = useState<CompsData | null>(null);
  const [compsLoading, setCompsLoading]   = useState(false);
  // Restored from DB (no File objects)
  const [savedDocEntries, setSavedDocEntries]         = useState<DocEntry[]>([]);
  const [initialChatMessages, setInitialChatMessages] = useState<ChatMessage[]>([]);

  // Refs to latest state for use inside async callbacks
  const resultsRef   = useRef<AnalysisResult | null>(null);
  const chartsDataRef = useRef<any>(null);
  useEffect(() => { resultsRef.current    = results;    }, [results]);
  useEffect(() => { chartsDataRef.current = chartsData; }, [chartsData]);

  // Cache uploaded File objects by deal ID so PDFs survive back-navigation within the session
  const dealFilesCache = useRef<Map<string, File[]>>(new Map());

  // ── Load deals on mount ──────────────────────────────────────
  useEffect(() => {
    loadDeals().then(d => { setDeals(d); setDealsLoading(false); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset all deal-level state ───────────────────────────────
  const resetDealState = useCallback(() => {
    setResults(null);
    setStagedFiles([]);
    setUploadedFiles([]);
    setError(null);
    setDocumentText('');
    setDocumentsText({});
    setChartsData(null);
    setCompsData(null);
    setCompsLoading(false);
    setSavedDocEntries([]);
    setInitialChatMessages([]);
  }, []);

  // ── Home screen actions ──────────────────────────────────────
  const handleNewDeal = () => setShowNewDealModal(true);

  const handleCreateDeal = async (name: string, dealSector: string) => {
    setShowNewDealModal(false);
    console.log('[Deal] Creating deal:', { name, dealSector, supabaseConfigured: isSupabaseConfigured });
    const deal = await createDeal(name, dealSector);
    if (deal) {
      console.log('[Deal] Saved to DB:', deal.id);
      setDeals(prev => [deal, ...prev]);
      setActiveDealId(deal.id);
    } else {
      // No Supabase — create a local-only deal so it shows on the home screen
      const localDeal: Deal = {
        id: `local_${Date.now()}`,
        name,
        sector: dealSector,
        status: 'Active',
        verdict: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      console.log('[Deal] No DB — using local deal:', localDeal.id);
      setDeals(prev => [localDeal, ...prev]);
      setActiveDealId(localDeal.id);
    }
    setActiveDealName(name);
    setActiveDealStatus('Active');
    setSector(dealSector);
    resetDealState();
    setAppView('deal');
  };

  const handleOpenDeal = async (deal: Deal) => {
    setDealWorkspaceLoading(true);
    setActiveDealId(deal.id);
    setActiveDealName(deal.name);
    setActiveDealStatus(deal.status);
    setSector(deal.sector);
    resetDealState();

    const loaded: LoadedDealData | null = await loadDeal(deal.id);
    if (loaded) {
      if (loaded.analysis) {
        const restored: AnalysisResult = {
          assessment: loaded.analysis.assessment,
          claims: loaded.analysis.claims ?? [],
          cross_document_conflicts: loaded.analysis.conflicts ?? [],
          charts_data: loaded.analysis.charts_data,
        };
        setResults(restored);
        setChartsData(loaded.analysis.charts_data ?? null);
        setCompsData(loaded.analysis.comps_data ?? null);
        // Rebuild documentText from saved docs for chat
        const docTexts: Record<string, string> = {};
        loaded.documents.forEach(d => { docTexts[d.filename] = d.extracted_text; });
        setDocumentsText(docTexts);
        setDocumentText(Object.values(docTexts).join('\n\n'));
      }
      if (loaded.documents.length > 0) {
        const memoryCached = dealFilesCache.current.get(deal.id) ?? [];
        const cachedFiles = memoryCached.length > 0 ? memoryCached : (await loadFilesFromIDB(deal.id) ?? []);
        if (cachedFiles.length > 0) {
          // Restore files into memory cache and uploadedFiles — Results useEffect
          // will create object URLs and show the real PDF viewer
          dealFilesCache.current.set(deal.id, cachedFiles);
          setUploadedFiles(cachedFiles);
        } else {
          // No cached files anywhere — fall back to text-only entries (PDF not available)
          setSavedDocEntries(loaded.documents.map(d => ({
            file: null,
            name: d.filename,
            url: '',
            numPages: null,
            extractedText: d.extracted_text,
            isProcessing: false,
            fileType: getFileType(d.filename),
          })));
        }
      }
      if (loaded.chatMessages.length > 0) {
        const msgs: ChatMessage[] = loaded.chatMessages.map(m => ({
          role: m.role,
          content: m.content,
          segments: m.segments ? m.segments as Segment[] : undefined,
          timestamp: m.timestamp,
        }));
        setInitialChatMessages(msgs);
      }
    }
    setDealWorkspaceLoading(false);
    setAppView('deal');
  };

  const handleBackToHome = useCallback(() => {
    // Cache current files so PDFs are still viewable if the user re-opens this deal
    if (activeDealId && uploadedFiles.length > 0) {
      dealFilesCache.current.set(activeDealId, uploadedFiles);
    }
    resetDealState();
    setActiveDealId(null);
    setActiveDealName('');
    // Only refresh from DB if Supabase is configured — otherwise loadDeals() returns []
    // and would wipe locally-tracked deals from state
    if (isSupabaseConfigured) {
      console.log('[Deal] Refreshing deals list from DB');
      loadDeals().then(d => {
        console.log('[Deal] Loaded', d.length, 'deals from DB');
        setDeals(d);
      });
    }
    setAppView('home');
  }, [resetDealState, loadDeals, activeDealId, uploadedFiles]);

  // ── Delete deal ──────────────────────────────────────────────
  const handleDeleteDeal = useCallback(async (dealId: string) => {
    setDeals(prev => prev.filter(d => d.id !== dealId));
    dealFilesCache.current.delete(dealId);
    deleteFilesFromIDB(dealId);
    await deleteDeal(dealId);
  }, [deleteDeal]);

  // ── Status change ────────────────────────────────────────────
  const handleStatusChange = useCallback(async (status: string) => {
    setActiveDealStatus(status);
    if (activeDealId) {
      await saveDeal(activeDealId, { status } as any);
      setDeals(prev => prev.map(d => d.id === activeDealId ? { ...d, status, updated_at: new Date().toISOString() } : d));
    }
  }, [activeDealId, saveDeal]);

  // ── Chat message persistence ─────────────────────────────────
  const handleSaveChatMessage = useCallback(async (msg: ChatMessage) => {
    if (activeDealId) await saveChatMessage(activeDealId, msg);
  }, [activeDealId, saveChatMessage]);

  // ── Document extraction (from FileExplorer post-analysis adds) ──
  const handleDocumentExtracted = useCallback(async (filename: string, fileType: FileType, text: string) => {
    if (activeDealId) await saveDocument(activeDealId, filename, fileType, text);
  }, [activeDealId, saveDocument]);

  // ── File staging ─────────────────────────────────────────────
  const handleAddFiles = useCallback((incoming: File[]) => {
    setStagedFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      return [...prev, ...incoming.filter(f => !existing.has(f.name))];
    });
  }, []);

  const handleRemoveFile = useCallback((i: number) => {
    setStagedFiles(prev => prev.filter((_, j) => j !== i));
  }, []);

  // ── Comps fetch ───────────────────────────────────────────────
  const fetchComps = useCallback(async (assessment: Assessment, docTextPreview: string, activeSector: string) => {
    setCompsLoading(true);
    setCompsData(null);
    try {
      const fd = new FormData();
      fd.append("assessment_json", JSON.stringify(assessment));
      fd.append("document_text_preview", docTextPreview.slice(0, 8000));
      fd.append("sector", activeSector);
      const { data } = await axios.post<CompsData>(`${API_BASE_URL}/comps`, fd, {
        headers: { "Content-Type": "multipart/form-data" }, timeout: 180000,
      });
      setCompsData(data);
      // Persist comps into the analysis record
      if (activeDealId) {
        const r = resultsRef.current;
        await saveAnalysis(
          activeDealId,
          r?.assessment, r?.claims, r?.cross_document_conflicts,
          chartsDataRef.current, data,
        );
      }
    } catch (err) {
      console.error("Comps fetch failed:", err);
    } finally {
      setCompsLoading(false);
    }
  }, [activeDealId, saveAnalysis]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Main analysis ─────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!stagedFiles.length) return;
    setLoading(true); setError(null); setResults(null);
    setCompsData(null); setCompsLoading(false);
    setUploadedFiles(stagedFiles); setLoadingStep(0);

    const stepInterval = setInterval(() => {
      setLoadingStep(prev => Math.min(prev + 1, LOADING_STEPS.length - 1));
    }, 12000);

    try {
      const formData = new FormData();
      stagedFiles.forEach(f => formData.append("files", f));
      formData.append("sector", sector);
      formData.append("min_ebitda", criteria.minEbitda);
      formData.append("deal_size_range", criteria.dealSizeRange);
      formData.append("target_sectors", criteria.targetSectors);
      formData.append("geography", criteria.geography);
      const { data } = await axios.post<AnalysisResult>(`${API_BASE_URL}/analyze`, formData, {
        headers: { "Content-Type": "multipart/form-data" }, timeout: 300000,
      });
      setResults(data);
      setDocumentText(data.document_text ?? '');
      setDocumentsText(data.documents_text ?? {});
      setChartsData(data.charts_data ?? null);

      // Cache files in IDB so PDFs survive page refreshes
      if (activeDealId) saveFilesToIDB(activeDealId, stagedFiles);

      // Persist
      if (activeDealId) {
        // Save all documents
        for (const f of stagedFiles) {
          const text = data.documents_text?.[f.name] ?? '';
          await saveDocument(activeDealId, f.name, getFileType(f.name), text);
        }
        // Save analysis (comps_data = null for now; updated after fetchComps)
        await saveAnalysis(
          activeDealId,
          data.assessment, data.claims, data.cross_document_conflicts,
          data.charts_data, null,
        );
        // Update deal verdict + timestamp
        await saveDeal(activeDealId, { verdict: data.assessment.overall_verdict } as any);
        setDeals(prev => prev.map(d =>
          d.id === activeDealId
            ? { ...d, verdict: data.assessment.overall_verdict, updated_at: new Date().toISOString() }
            : d
        ));
      }

      // Fire comps in background
      fetchComps(data.assessment, data.document_text ?? '', sector);
    } catch (err) {
      setError("Something went wrong. Make sure the backend is running and try again.");
      console.error(err);
    } finally {
      clearInterval(stepInterval); setLoading(false);
    }
  };

  // ── Rendering ─────────────────────────────────────────────────
  if (appView === 'home') {
    return (
      <>
        <HomeScreen
          deals={deals}
          loading={dealsLoading}
          onNewDeal={handleNewDeal}
          onOpenDeal={handleOpenDeal}
          onDeleteDeal={handleDeleteDeal}
        />
        {showNewDealModal && (
          <NewDealModal
            onConfirm={handleCreateDeal}
            onCancel={() => setShowNewDealModal(false)}
          />
        )}
      </>
    );
  }

  // Deal workspace loading spinner
  if (dealWorkspaceLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: OFFWHITE, gap: 16 }}>
        <style>{GLOBAL_STYLE}</style>
        <div style={{ width: 36, height: 36, border: `3px solid #e5e7eb`, borderTop: `3px solid ${RED}`, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <p style={{ color: '#6b7280', fontSize: 13, fontFamily: "'Inter', sans-serif" }}>Loading deal…</p>
      </div>
    );
  }

  const hasResults = results !== null;
  const hasDocs = uploadedFiles.length > 0 || savedDocEntries.length > 0;

  if (hasResults && hasDocs) {
    return (
      <Results
        data={results!}
        uploadedFiles={uploadedFiles}
        onReset={handleBackToHome}
        documentText={documentText}
        documentsText={documentsText}
        chartsData={chartsData}
        compsData={compsData}
        compsLoading={compsLoading}
        savedDocEntries={savedDocEntries}
        initialChatMessages={initialChatMessages}
        dealName={activeDealName}
        dealStatus={activeDealStatus}
        onStatusChange={handleStatusChange}
        onSaveChatMessage={handleSaveChatMessage}
        saveError={saveError}
        onBackToHome={handleBackToHome}
        onDocumentExtracted={handleDocumentExtracted}
      />
    );
  }

  return (
    <UploadZone
      files={stagedFiles}
      onAddFiles={handleAddFiles}
      onRemoveFile={handleRemoveFile}
      onAnalyze={handleAnalyze}
      loading={loading}
      loadingStep={loadingStep}
      error={error}
      sector={sector}
      onSectorChange={setSector}
      criteria={criteria}
      onCriteriaChange={setCriteria}
      dealName={activeDealName || undefined}
      onBackToHome={activeDealName ? handleBackToHome : undefined}
    />
  );
}
