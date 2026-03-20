import { useState, useCallback, useRef, useEffect, useReducer } from "react";
import * as XLSX from "xlsx";
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
  page1?: number | null;
  page2?: number | null;
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  "Extracting document text",
  "Identifying key claims",
  "Verifying market data",
  "Running cross-document analysis",
  "Generating assessment",
  "Building comparable transactions",
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
    case 'xlsx': return 'XLS';
    case 'pptx': return 'PPT';
    default: return 'PDF';
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

const FONT_STACK = "'Open Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const GLOBAL_STYLE = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Open Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  body { font-family: ${FONT_STACK}; background: ${OFFWHITE}; color: ${NAVY}; -webkit-font-smoothing: antialiased; font-size: 13px; line-height: 1.6; }
  a:hover { opacity: 0.8; }
  textarea:focus { outline: 1px solid ${RED}; border-color: transparent; }
  input:focus, select:focus { outline: none; border-color: ${RED} !important; }
  .react-pdf__Page { display: block !important; }
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
  input, select, textarea, button { font-family: inherit; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1); } }
  @keyframes stepOn { from { opacity: 0.4; } to { opacity: 1; } }
`;

// ── Utilities ────────────────────────────────────────────────
function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

const sectionLabel: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: 10, fontWeight: 600, color: RED,
  textTransform: "uppercase", letterSpacing: "1.5px",
};

// ── Collapsible Section ──────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  onSetPrimary: (i: number) => void;
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
  files, onAddFiles, onRemoveFile, onSetPrimary, onAnalyze, loading, loadingStep,
  error, sector, onSectorChange, criteria, onCriteriaChange,
  dealName, onBackToHome,
}: UploadZoneProps) {
  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length) onAddFiles(accepted);
  }, [onAddFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.ms-excel.sheet.macroEnabled.12": [".xlsm"],
    },
    multiple: true,
    disabled: loading,
  });

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px", borderRadius: 6,
    border: "1px solid #e5e7eb", fontSize: 13, fontFamily: FONT_STACK,
    background: "#fff", color: NAVY, outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: OFFWHITE }}>
      <style>{GLOBAL_STYLE}</style>

      {/* Nav bar */}
      <div style={{ height: 52, background: "#fff", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", padding: "0 24px", gap: 14, flexShrink: 0 }}>
        {onBackToHome && (
          <>
            <button onClick={onBackToHome} style={{ background: "none", border: "none", color: "#6b7280", fontSize: 13, cursor: "pointer", fontFamily: FONT_STACK, padding: 0, display: "flex", alignItems: "center", gap: 4, fontWeight: 500 }}>
              ← Back
            </button>
            <div style={{ width: 1, height: 22, background: "#e5e7eb" }} />
          </>
        )}
        <img src={`${process.env.PUBLIC_URL}/sagard.svg`} alt="Sagard" style={{ height: 26 }} />
        {dealName && (
          <>
            <div style={{ width: 1, height: 22, background: "#e5e7eb" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: NAVY, fontFamily: FONT_STACK }}>{dealName}</span>
            <span style={{ fontSize: 10, fontWeight: 600, background: "#f5f5f5", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 8px", fontFamily: FONT_STACK }}>{sector}</span>
          </>
        )}
      </div>

      {loading ? (
        /* ── Loading state: step-by-step progress ── */
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 52px)", padding: "40px 20px" }}>
          <div style={{ width: "100%", maxWidth: 460 }}>
            <p style={{ margin: "0 0 4px", ...sectionLabel, textAlign: "left" }}>ANALYZING DEAL</p>
            <div style={{ borderBottom: "2px solid #e5e7eb", marginBottom: 28 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {LOADING_STEPS.map((step, i) => {
                const isDone = i < loadingStep;
                const isActive = i === loadingStep;
                return (
                  <div key={step} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, background: isDone || isActive ? RED : "#e5e7eb", transition: "background 0.4s" }} />
                    <span style={{ fontSize: 13, fontFamily: FONT_STACK, color: isDone || isActive ? NAVY : "#9ca3af", fontWeight: isDone || isActive ? 600 : 400, transition: "color 0.4s", flex: 1 }}>
                      {step}
                    </span>
                    {isDone && <span style={{ fontSize: 10, color: "#16a34a", fontFamily: FONT_STACK, fontWeight: 600, letterSpacing: "0.5px" }}>Done</span>}
                    {isActive && <span style={{ fontSize: 10, color: RED, fontFamily: FONT_STACK, fontWeight: 600, letterSpacing: "0.5px" }}>Running</span>}
                  </div>
                );
              })}
            </div>
            <p style={{ marginTop: 32, fontSize: 12, color: "#9ca3af", fontFamily: FONT_STACK, textAlign: "center" }}>Estimated time: 1–5 minutes</p>
          </div>
        </div>
      ) : (
        /* ── Main setup UI ── */
        <div style={{ padding: "36px 40px", maxWidth: 980, margin: "0 auto" }}>
          <p style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 700, color: NAVY, fontFamily: FONT_STACK, letterSpacing: "-0.5px" }}>Deal Setup</p>
          <div style={{ borderBottom: "2px solid #e5e7eb", marginBottom: 28 }} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>

            {/* Left: Documents */}
            <div>
              <p style={{ margin: "0 0 12px", ...sectionLabel }}>DOCUMENTS</p>
              <div
                {...getRootProps()}
                style={{
                  border: `1px dashed ${isDragActive ? RED : "#e5e7eb"}`,
                  borderRadius: 6, padding: files.length ? "16px 20px" : "32px 20px",
                  textAlign: "center", background: isDragActive ? "#fdf5f5" : "#fff",
                  cursor: "pointer", transition: "all 0.15s", marginBottom: files.length ? 10 : 0,
                }}
              >
                <input {...getInputProps()} />
                <p style={{ margin: "0 0 4px", color: NAVY, fontWeight: 600, fontSize: 13, fontFamily: FONT_STACK }}>
                  {isDragActive ? "Drop documents here" : "Drop documents here or browse"}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", fontFamily: FONT_STACK }}>
                  PDF or Excel — CIM, management presentations, financial models
                </p>
              </div>

              {files.length > 0 && (
                <div>
                  {files.map((f, i) => {
                    const ftype = getFileType(f.name);
                    const badge = getTypeBadgeColor(ftype);
                    const isPrimary = i === 0;
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: `1px solid ${isPrimary ? RED : "#e5e7eb"}`, borderLeft: `3px solid ${isPrimary ? RED : "#e5e7eb"}`, borderRadius: 6, padding: "8px 12px", marginBottom: 5 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 3, background: badge.bg, color: badge.color, fontFamily: FONT_STACK, textTransform: "uppercase" as const, flexShrink: 0 }}>
                          {ftype.toUpperCase()}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: FONT_STACK }}>{f.name}</p>
                          <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", fontFamily: FONT_STACK }}>{formatBytes(f.size)}</p>
                        </div>
                        {isPrimary ? (
                          <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.5px", padding: "2px 8px", borderRadius: 3, background: RED, color: "#fff", fontFamily: FONT_STACK, flexShrink: 0 }}>PRIMARY</span>
                        ) : (
                          <button onClick={() => onSetPrimary(i)} style={{ fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 3, background: "none", color: "#9ca3af", border: "1px solid #e5e7eb", cursor: "pointer", fontFamily: FONT_STACK, flexShrink: 0 }}>
                            Set Primary
                          </button>
                        )}
                        <button onClick={() => onRemoveFile(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>×</button>
                      </div>
                    );
                  })}
                  {files.length > 1 && (
                    <p style={{ fontSize: 11, color: "#6b7280", margin: "6px 0 0", fontFamily: FONT_STACK }}>Cross-document conflict detection enabled</p>
                  )}
                </div>
              )}
            </div>

            {/* Right: Investment Criteria */}
            <div>
              <p style={{ margin: "0 0 12px" }}>
                <span style={{ ...sectionLabel }}>INVESTMENT CRITERIA</span>
                <span style={{ fontSize: 10, fontWeight: 400, color: "#9ca3af", fontFamily: FONT_STACK, marginLeft: 6, textTransform: "none" as const, letterSpacing: 0 }}>(optional)</span>
              </p>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 8, fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: "1px", fontFamily: FONT_STACK }}>Strategy Focus</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {([
                    { value: "Private Equity", desc: "Buyout returns, EBITDA growth, exit multiples" },
                    { value: "Private Credit", desc: "Debt coverage, covenant protection, downside risk" },
                    { value: "Venture Capital", desc: "Growth rate, TAM, founder quality, burn rate" },
                    { value: "Real Estate", desc: "NOI, cap rates, occupancy, debt service" },
                  ] as { value: string; desc: string }[]).map(opt => {
                    const selected = sector === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => onSectorChange(opt.value)}
                        style={{
                          textAlign: "left", padding: "10px 12px", borderRadius: 6, cursor: "pointer",
                          border: `1.5px solid ${selected ? RED : "#e5e7eb"}`,
                          background: selected ? "#fdf5f5" : "#fff",
                          transition: "all 0.12s",
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: selected ? RED : NAVY, fontFamily: FONT_STACK, marginBottom: 2 }}>{opt.value}</div>
                        <div style={{ fontSize: 10, color: "#6b7280", fontFamily: FONT_STACK, lineHeight: 1.4 }}>{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px" }}>
                {[
                  { label: "Min EBITDA", key: "minEbitda", placeholder: "$10M" },
                  { label: "Deal Size", key: "dealSizeRange", placeholder: "$50M – $250M" },
                  { label: "Target Sectors", key: "targetSectors", placeholder: "Healthcare, Tech" },
                  { label: "Geography", key: "geography", placeholder: "North America" },
                ].map(field => (
                  <div key={field.key}>
                    <label style={{ display: "block", marginBottom: 4, fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: "0.5px", fontFamily: FONT_STACK }}>
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
            </div>
          </div>

          {/* Analyze button */}
          <div style={{ marginTop: 28 }}>
            <button
              onClick={onAnalyze}
              disabled={files.length === 0}
              style={{ width: "100%", background: files.length === 0 ? "#d1d5db" : RED, color: "#fff", border: "none", borderRadius: 6, padding: "14px 24px", fontSize: 14, fontWeight: 700, cursor: files.length === 0 ? "not-allowed" : "pointer", fontFamily: FONT_STACK, transition: "background 0.15s" }}
            >
              {files.length === 0 ? "Add documents to begin" : "Analyze Deal"}
            </button>
          </div>

          {error && <p style={{ textAlign: "center", color: "#991b1b", marginTop: 12, fontSize: 13, fontFamily: FONT_STACK }}>{error}</p>}
          <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 11, marginTop: 12, fontFamily: FONT_STACK }}>
            Documents are processed in real time and not stored.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Verdict Badge ────────────────────────────────────────────
function VerdictBadge({ verdict }: { verdict: string }) {
  const cfg = verdictConfig[verdict] ?? verdictConfig.unverifiable;
  return (
    <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", fontFamily: FONT_STACK }}>
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
      style={{
        borderBottom: '1px solid #e5e7eb', padding: isActive ? '12px 16px' : '10px 16px',
        background: isActive ? '#fafafa' : '#fff', cursor: 'pointer', transition: 'background 0.1s',
        borderLeft: `2px solid ${isActive ? cfg.color : 'transparent'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: cfg.color, fontFamily: FONT_STACK, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
          {cfg.label}
        </span>
        {claim.page && (
          <span style={{ fontSize: 10, color: '#9ca3af', background: '#f5f5f5', borderRadius: 3, padding: '1px 5px', fontFamily: FONT_STACK }}>
            p.{claim.page}
          </span>
        )}
        {claim.materiality === 'high' && (
          <span style={{ fontSize: 9, fontWeight: 700, color: RED, textTransform: 'uppercase' as const, letterSpacing: '0.5px', fontFamily: FONT_STACK }}>HIGH IMPACT</span>
        )}
      </div>
      <p style={{
        margin: '0 0 4px', fontSize: 13, color: '#374151', lineHeight: 1.5, fontFamily: FONT_STACK, fontWeight: 500,
        ...(isActive ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties),
      }}>
        {claim.claim}
      </p>

      {isActive && (
        <div style={{ marginTop: 8 }}>
          {claim.why_it_matters && (
            <p style={{ margin: '0 0 8px', fontSize: 12, color: '#6b7280', lineHeight: 1.5, fontFamily: FONT_STACK }}>{claim.why_it_matters}</p>
          )}
          {claim.explanation && (
            <p style={{ margin: '0 0 8px', fontSize: 12, color: '#374151', lineHeight: 1.5, fontFamily: FONT_STACK }}>{claim.explanation}</p>
          )}
          {claim.diligence_question && (
            <div style={{ borderLeft: '2px solid #e5e7eb', paddingLeft: 10, marginBottom: 8 }}>
              <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.5px', fontFamily: FONT_STACK }}>Diligence question</p>
              <p style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.5, fontFamily: FONT_STACK }}>{claim.diligence_question}</p>
            </div>
          )}
          {claim.sources?.filter(s => s.url).length > 0 && (
            <div style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {claim.sources.filter(s => s.url).map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                  style={{ fontSize: 10, color: RED, textDecoration: 'none', fontFamily: FONT_STACK }}>
                  {(s.title || 'Source').slice(0, 32)}{(s.title || '').length > 32 ? '…' : ''} ↗
                </a>
              ))}
            </div>
          )}
          <textarea
            placeholder="Add analyst note..."
            value={note}
            onChange={e => { e.stopPropagation(); setNote(e.target.value); }}
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 4, padding: '6px 10px', fontSize: 11, color: '#374151', resize: 'vertical', minHeight: 44, boxSizing: 'border-box', fontFamily: FONT_STACK, background: '#fafafa', marginTop: 4 }}
          />
        </div>
      )}
    </div>
  );
}

// ── Excel Viewer ─────────────────────────────────────────────
function ExcelViewer({ url, requestedSheet }: { url: string; requestedSheet?: string | null }) {
  const [sheets, setSheets] = useState<{ name: string; rows: any[][] }[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Jump to a sheet by name when requested externally
  useEffect(() => {
    if (!requestedSheet || sheets.length === 0) return;
    const idx = sheets.findIndex(s =>
      s.name.toLowerCase() === requestedSheet.toLowerCase()
    );
    if (idx !== -1) setActiveSheet(idx);
  }, [requestedSheet, sheets]);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetch(url)
      .then(r => r.arrayBuffer())
      .then(buf => {
        const wb = XLSX.read(buf, { type: 'array' });
        const parsed = wb.SheetNames.map(name => {
          const ws = wb.Sheets[name];
          const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          // trim trailing empty rows
          while (rows.length && rows[rows.length - 1].every((c: any) => c === '')) rows.pop();
          return { name, rows };
        }).filter(s => s.rows.length > 0);
        setSheets(parsed);
        setActiveSheet(0);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [url]);

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa' }}>
      <span style={{ fontSize: 12, color: '#9ca3af', fontFamily: FONT_STACK }}>Loading spreadsheet…</span>
    </div>
  );

  if (error || sheets.length === 0) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa' }}>
      <span style={{ fontSize: 12, color: '#9ca3af', fontFamily: FONT_STACK }}>Could not render this spreadsheet.</span>
    </div>
  );

  const { rows } = sheets[activeSheet];
  // Detect header row: first non-empty row
  const headerRow = rows[0] ?? [];
  const dataRows = rows.slice(1);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f8f9fa' }}>
      {/* Sheet tabs */}
      <div style={{ flexShrink: 0, display: 'flex', background: '#fff', borderBottom: '1px solid #e5e7eb', overflowX: 'auto', padding: '0 8px' }}>
        {sheets.map((s, i) => (
          <button key={i} onClick={() => setActiveSheet(i)} style={{
            padding: '7px 14px', fontSize: 11, fontWeight: 600, fontFamily: FONT_STACK,
            color: activeSheet === i ? RED : '#6b7280',
            borderBottom: activeSheet === i ? `2px solid ${RED}` : '2px solid transparent',
            background: 'none', border: 'none', borderRadius: 0,
            cursor: 'pointer', whiteSpace: 'nowrap', transition: 'color 0.1s',
          }}>
            {s.name}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: FONT_STACK, width: '100%', minWidth: 'max-content' }}>
          {/* Header row */}
          {headerRow.some((c: any) => c !== '') && (
            <thead>
              <tr>
                {headerRow.map((cell: any, ci: number) => (
                  <th key={ci} style={{
                    position: 'sticky', top: 0, zIndex: 2,
                    background: NAVY, color: '#fff',
                    padding: '6px 12px', textAlign: 'left',
                    fontWeight: 700, fontSize: 10, letterSpacing: '0.3px',
                    borderRight: '1px solid rgba(255,255,255,0.1)',
                    whiteSpace: 'nowrap',
                  }}>
                    {cell !== '' ? String(cell) : ''}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {dataRows.map((row, ri) => {
              const isEmpty = row.every((c: any) => c === '');
              if (isEmpty) return (
                <tr key={ri}><td colSpan={headerRow.length} style={{ height: 8 }} /></tr>
              );
              // Section header: first cell has content, rest are empty
              const isSectionHeader = row[0] !== '' && row.slice(1).every((c: any) => c === '');
              return (
                <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  {row.map((cell: any, ci: number) => {
                    const val = cell === '' ? '' : String(cell);
                    const isFirstCol = ci === 0;
                    return (
                      <td key={ci} style={{
                        padding: '5px 12px',
                        borderBottom: '1px solid #f0f0f0',
                        borderRight: '1px solid #f0f0f0',
                        color: isSectionHeader && isFirstCol ? RED
                          : isFirstCol ? NAVY : '#374151',
                        fontWeight: isSectionHeader ? 700 : isFirstCol ? 500 : 400,
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        background: isSectionHeader ? '#fdf5f5' : undefined,
                      }}>
                        {val}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
function buildICBrief(
  assessment: Assessment,
  claims: Claim[],
  conflicts: CrossDocumentConflict[],
  filename: string,
  compsData?: CompsData | null,
  dealName?: string,
  chartsData?: any,
): string {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Strip [[Page X, Doc]] and [[Slide X]] citation tags — they must never appear in print
  const strip = (s: string | null | undefined): string => {
    if (!s) return '';
    return s
      .replace(/\[\[Page \d+,?\s*[^\]]*\]\]/g, '')
      .replace(/\[\[Slide \d+\]\]/g, '')
      .trim();
  };

  // Strip citations then HTML-escape — safe to insert as element text content
  const esc = (s: string | null | undefined): string => {
    const t = strip(s);
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  const dealTitle = dealName || filename.replace(/\.[^.]+$/, '');
  const sector = compsData?.deal_profile?.sector || '';
  const holds = assessment.narrative_holds_up;
  const dealScore: number = chartsData?.deal_scorecard?.overall_score ?? 0;

  const verdictColor = assessment.overall_verdict === 'Worth deeper look' ? '#166534'
    : assessment.overall_verdict === 'Borderline' ? '#92400e'
    : '#991b1b';

  // Deal metrics from compsData
  const dp = compsData?.deal_profile;
  const metricRows = [
    dp?.revenue_millions   ? `<tr><td>Revenue</td><td>$${dp.revenue_millions}M</td></tr>` : '',
    dp?.ebitda_millions    ? `<tr><td>EBITDA</td><td>$${dp.ebitda_millions}M</td></tr>` : '',
    dp?.ebitda_margin_pct  ? `<tr><td>EBITDA Margin</td><td>${dp.ebitda_margin_pct}%</td></tr>` : '',
    dp?.geography          ? `<tr><td>Geography</td><td>${esc(dp.geography)}</td></tr>` : '',
    dp?.sub_sector         ? `<tr><td>Sub-sector</td><td>${esc(dp.sub_sector)}</td></tr>` : '',
  ].filter(Boolean).join('');

  // Comps table rows
  const fmtEV  = (v: number | null | undefined) =>
    v == null ? '—' : v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(0)}M`;
  const fmtX   = (v: number | null | undefined) => v == null ? '—' : `${v.toFixed(1)}x`;

  const compsRows = (compsData?.comps ?? []).map(c =>
    `<tr>
      <td>${esc(c.company)}</td><td>${esc(c.acquirer)}</td><td>${esc(c.date)}</td>
      <td class="nr">${fmtEV(c.ev_millions)}</td>
      <td class="nr">${fmtX(c.ev_ebitda)}</td>
      <td class="nr">${fmtX(c.ev_revenue)}</td>
      <td style="max-width:120px">${esc(c.why_comparable)}</td>
    </tr>`
  ).join('');

  const sectorRow = (compsData?.sector_context?.typical_ev_ebitda_low && compsData?.sector_context?.typical_ev_ebitda_high)
    ? `<tr class="sub"><td colspan="4" style="color:#6b7280">Sector range</td>
        <td class="nr" style="color:#6b7280">${compsData.sector_context.typical_ev_ebitda_low.toFixed(1)}x – ${compsData.sector_context.typical_ev_ebitda_high.toFixed(1)}x</td>
        <td colspan="2"></td></tr>`
    : '';

  const thisDealRow = compsData?.this_deal_positioning?.implied_ev_ebitda
    ? `<tr class="this-deal">
        <td colspan="4">This Deal (Implied)</td>
        <td class="nr">${fmtX(compsData.this_deal_positioning.implied_ev_ebitda)}</td>
        <td class="nr">${fmtX(compsData.this_deal_positioning.implied_ev_revenue)}</td>
        <td style="font-style:italic">${esc(compsData.this_deal_positioning?.vs_comp_set)}</td>
      </tr>`
    : '';

  const diligenceClaims = claims.filter(c => c.diligence_question);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>IC Brief — ${esc(dealTitle)}</title>
<style>
  @media print {
    @page { margin: 0.75in; size: letter; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .page-break { page-break-before: always; }
    table { page-break-inside: avoid; }
    h2, h3 { page-break-after: avoid; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Open Sans', Arial, sans-serif;
    color: #1a1a1a; font-size: 11px; line-height: 1.55; background: #fff;
  }
  .page {
    max-width: 7.5in; margin: 0 auto; padding: 0.55in 0.6in;
    min-height: 9.5in; display: flex; flex-direction: column;
  }
  /* Header */
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .wordmark { font-size: 20px; font-weight: 800; color: #913d3e; letter-spacing: 4px; line-height: 1; }
  .doc-subtype { font-size: 8px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; color: #6b7280; margin-top: 4px; }
  .header-meta { text-align: right; font-size: 10px; color: #6b7280; line-height: 1.7; }
  .header-meta .deal-name { font-size: 13px; font-weight: 700; color: #1a1a1a; display: block; margin-bottom: 2px; }
  /* Rules */
  .rule { border: none; border-top: 2px solid #1a1a1a; margin: 10px 0 12px; }
  .rule-light { border: none; border-top: 1px solid #e5e7eb; margin: 9px 0; }
  /* Labels */
  .lbl { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #913d3e; display: block; margin-bottom: 5px; }
  /* Verdict */
  .verdict-text { font-size: 22px; font-weight: 800; letter-spacing: -0.3px; line-height: 1.1; margin: 3px 0 5px; color: ${verdictColor}; }
  .verdict-reasoning { font-size: 11.5px; color: #374151; line-height: 1.55; margin-bottom: 4px; }
  /* Two-column layout using table */
  .two-col { display: table; width: 100%; table-layout: fixed; }
  .col { display: table-cell; vertical-align: top; }
  .col-div { display: table-cell; width: 1px; background: #e5e7eb; }
  /* Metrics */
  table.metrics { width: 100%; border-collapse: collapse; }
  table.metrics td { padding: 3px 0; font-size: 10.5px; border-bottom: 1px solid #f3f4f6; }
  table.metrics td:first-child { color: #6b7280; }
  table.metrics td:last-child { text-align: right; font-weight: 600; }
  /* Narrative */
  .narrative-box { border-left: 3px solid #d1d5db; padding: 7px 12px; margin: 5px 0 10px; background: #fafafa; }
  .narrative-text { font-size: 11px; color: #374151; line-height: 1.6; font-style: italic; }
  .narrative-verdict { font-size: 10px; font-weight: 700; margin-top: 5px; }
  /* Risks / Bull */
  .item-row { display: flex; gap: 6px; margin-bottom: 5px; padding-bottom: 5px; border-bottom: 1px solid #f3f4f6; font-size: 11px; line-height: 1.5; }
  .item-row:last-child { border-bottom: none; margin-bottom: 0; }
  .item-row .n { font-weight: 700; flex-shrink: 0; min-width: 16px; }
  /* Data table */
  table.dt { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 5px; }
  table.dt th { text-align: left; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; border-bottom: 2px solid #1a1a1a; padding: 4px 5px; white-space: nowrap; }
  table.dt th.nr { text-align: right; }
  table.dt td { padding: 5px 5px; border-bottom: 1px solid #eee; vertical-align: top; }
  table.dt td.nr { text-align: right; font-weight: 600; }
  table.dt tr.sub td { background: #f9fafb; }
  table.dt tr.this-deal td { border-top: 2px solid #1a1a1a; }
  /* Conflicts */
  .conflict { margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; }
  .conflict:last-child { border-bottom: none; }
  .conflict-sev { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .sev-high { color: #dc2626; } .sev-medium { color: #92400e; } .sev-low { color: #6b7280; }
  .conflict-claims { display: table; width: 100%; table-layout: fixed; margin: 5px 0; }
  .conflict-side { display: table-cell; vertical-align: top; padding-right: 12px; }
  .conflict-side:last-child { padding-right: 0; }
  .side-label { font-size: 7.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9ca3af; margin-bottom: 2px; }
  .side-text { font-size: 10.5px; color: #374151; font-style: italic; line-height: 1.5; }
  .conflict-expl { font-size: 10.5px; color: #374151; line-height: 1.5; border-top: 1px solid #f0f0f0; padding-top: 4px; margin-top: 4px; }
  /* Checklist */
  .chk { display: flex; gap: 8px; margin-bottom: 5px; font-size: 11px; line-height: 1.5; }
  .chk .box { flex-shrink: 0; font-size: 12px; line-height: 1.1; }
  /* Footer */
  .footer { margin-top: auto; padding-top: 12px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 8.5px; color: #9ca3af; }
  /* Spacing */
  .sec { margin-bottom: 13px; }
  p { margin: 0 0 5px; }
</style>
</head>
<body>

<!-- ═══ PAGE 1 ═══ -->
<div class="page">

  <div class="doc-header">
    <div>
      <div class="wordmark">SAGARD</div>
      <div class="doc-subtype">Investment Committee Brief</div>
    </div>
    <div class="header-meta">
      <span class="deal-name">${esc(dealTitle)}</span>
      ${sector ? `<span>${esc(sector)}</span><br>` : ''}
      <span>${today}</span>
    </div>
  </div>
  <hr class="rule">

  <!-- Verdict -->
  <div class="sec">
    <span class="lbl">First-Pass Verdict</span>
    <div class="verdict-text">${esc(assessment.overall_verdict)}</div>
    <div class="verdict-reasoning">${esc(assessment.reasoning)}</div>
    ${dealScore > 0 ? `<div style="font-size:10px;color:#6b7280;margin-bottom:3px">Deal Score: ${dealScore} / 10</div>` : ''}
    ${assessment.criteria_fit
      ? `<div style="font-size:10px;color:${assessment.criteria_fit.fits ? '#166534' : '#991b1b'}">${assessment.criteria_fit.fits ? '✓ Fits' : '✗ Outside'} investment criteria — ${esc(assessment.criteria_fit.explanation)}</div>`
      : ''}
  </div>
  <hr class="rule-light">

  <!-- Company + Metrics -->
  <div class="sec">
    <div class="two-col">
      <div class="col" style="width:57%;padding-right:18px">
        <span class="lbl">Company</span>
        <p style="font-size:11px;color:#374151;line-height:1.65">${esc(assessment.company_snapshot)}</p>
      </div>
      <div class="col-div"></div>
      <div class="col" style="width:41%;padding-left:18px">
        <span class="lbl">Deal Metrics</span>
        ${metricRows
          ? `<table class="metrics">${metricRows}</table>`
          : `<p style="color:#9ca3af;font-size:10px">Run COMPS analysis to populate metrics.</p>`}
      </div>
    </div>
  </div>
  <hr class="rule-light">

  <!-- Seller Narrative -->
  ${assessment.sellers_narrative ? `
  <div class="sec">
    <span class="lbl">Seller Narrative</span>
    <div class="narrative-box">
      <div class="narrative-text">${esc(assessment.sellers_narrative)}</div>
      ${holds ? `<div class="narrative-verdict" style="color:${holds.holds ? '#166534' : '#991b1b'}">Narrative assessment: ${holds.holds ? 'Holds up' : 'Does not hold up'}${holds.explanation ? ` — ${esc(holds.explanation)}` : ''}</div>` : ''}
    </div>
  </div>` : ''}

  <!-- Risks + Bull Case -->
  ${(assessment.top_risks?.length > 0 || assessment.bull_case) ? `
  <div class="sec">
    <div class="two-col">
      <div class="col" style="width:50%;padding-right:18px">
        <span class="lbl">Key Risks</span>
        ${(assessment.top_risks ?? []).map((r, i) => `<div class="item-row"><span class="n" style="color:#dc2626">${i + 1}.</span><span style="color:#dc2626">${esc(r)}</span></div>`).join('')}
      </div>
      <div class="col-div"></div>
      <div class="col" style="width:48%;padding-left:18px">
        <span class="lbl" style="color:#16a34a">Bull Case</span>
        ${assessment.bull_case ? `<div class="item-row"><span style="color:#16a34a">${esc(assessment.bull_case)}</span></div>` : ''}
      </div>
    </div>
  </div>` : ''}

  <div class="footer">
    <span>SAGARD CIM Analyzer — AI-assisted first-pass analysis. All investment decisions require human judgment.</span>
    <span>Page 1 of 2 &nbsp;·&nbsp; ${today}</span>
  </div>
</div>

<!-- ═══ PAGE 2 ═══ -->
<div class="page page-break">

  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
    <div style="font-size:10px;font-weight:800;color:#913d3e;letter-spacing:3px">SAGARD</div>
    <div style="font-size:9px;color:#6b7280">${esc(dealTitle)} — continued</div>
  </div>
  <hr class="rule">

  <!-- Key Questions -->
  ${assessment.key_questions?.length > 0 ? `
  <div class="sec">
    <span class="lbl">Key Questions for Management</span>
    ${assessment.key_questions.map((q, i) => `<div class="item-row"><span class="n" style="color:#913d3e">${i + 1}.</span><span>${esc(q)}</span></div>`).join('')}
  </div>` : ''}

  <!-- Diligence Checklist -->
  ${diligenceClaims.length > 0 ? `
  <div class="sec">
    <span class="lbl">Diligence Checklist</span>
    ${diligenceClaims.map((c, i) => `<div class="chk"><span class="box">&#9633;</span><span style="color:#6b7280;font-weight:600;min-width:20px;flex-shrink:0">${i + 1}.</span><span>${esc(c.diligence_question)}</span></div>`).join('')}
  </div>` : ''}

  <!-- Conflicts -->
  ${conflicts.length > 0 ? `
  <div class="sec">
    <span class="lbl">Cross-Document Conflicts (${conflicts.length})</span>
    ${conflicts.map(c => `
    <div class="conflict">
      <div style="display:flex;gap:10px;align-items:baseline;margin-bottom:5px">
        <span class="conflict-sev sev-${c.severity}">${c.severity.toUpperCase()}</span>
        <span style="font-size:9px;color:#6b7280">${esc(c.doc1)} vs. ${esc(c.doc2)}</span>
      </div>
      <div class="conflict-claims">
        <div class="conflict-side">
          <div class="side-label">${esc(c.doc1)}</div>
          <div class="side-text">"${esc(c.claim1)}"</div>
        </div>
        <div class="conflict-side">
          <div class="side-label">${esc(c.doc2)}</div>
          <div class="side-text">"${esc(c.claim2)}"</div>
        </div>
      </div>
      <div class="conflict-expl">${esc(c.explanation)}</div>
    </div>`).join('')}
  </div>` : ''}

  <!-- Comps Table -->
  ${compsData?.comps?.length ? `
  <div class="sec">
    <span class="lbl">Comparable Transactions</span>
    <table class="dt">
      <thead><tr>
        <th>Company</th><th>Acquirer</th><th>Date</th>
        <th class="nr">EV</th><th class="nr">EV/EBITDA</th><th class="nr">EV/Rev</th><th>Notes</th>
      </tr></thead>
      <tbody>
        ${compsRows}
        ${sectorRow}
        ${thisDealRow}
      </tbody>
    </table>
    ${compsData.valuation_context ? `<p style="margin-top:8px;font-size:10px;color:#6b7280;line-height:1.6">${esc(compsData.valuation_context)}</p>` : ''}
  </div>` : ''}

  <div class="footer">
    <span>SAGARD CIM Analyzer — AI-assisted first-pass analysis. All investment decisions require human judgment.</span>
    <span>Page 2 of 2 &nbsp;·&nbsp; ${today}</span>
  </div>
</div>

</body>
</html>`;
}

// ── Citation formatter ───────────────────────────────────────
function formatCitations(text: string): string {
  if (!text) return '';
  let f = text;

  // Bold and italic
  f = f.replace(/\*\*(.*?)\*\*/g, '<span style="font-weight:inherit">$1</span>');
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
  // Avoid `s` (dotAll) regex flag for older TS targets; use [\\s\\S] to match newlines.
  f = f.replace(/(<tr>(?:<td[^>]*>[\s\S]*?<\/td>)+<\/tr>\n?)+/g, (block) => {
    const rows = block.trim().split('\n').filter(r => r.startsWith('<tr>'));
    if (rows.length === 0) return block;
    const header = rows[0]
      .replace(/<td([^>]*)>/g, '<th style="padding:6px 10px;border:1px solid #e5e7eb;background:#f8f6f3;font-size:11px;font-weight:600;font-family:Inter,sans-serif;color:#374151;">')
      .replace(/<\/td>/g, '</th>');
    const body = rows.slice(1).join('');
    return `<div style="overflow-x:auto;margin:8px 0;"><table style="border-collapse:collapse;width:100%;">${header}${body}</table></div>`;
  });

  // Citations [[Sheet: SheetName, DocName]]
  f = f.replace(/\[\[Sheet:\s*([^\],]+),\s*([^\]]+)\]\]/gi,
    '<span onclick="window.jumpToSheet(\'$1\',\'$2\')" style="display:inline-block;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;margin:0 2px;cursor:pointer;user-select:none;" title="Jump to $1 in $2">$1↗</span>');
  // Citations [[Sheet: SheetName]] (no doc name)
  f = f.replace(/\[\[Sheet:\s*([^\]]+)\]\]/gi,
    '<span onclick="window.jumpToSheet(\'$1\')" style="display:inline-block;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;margin:0 2px;cursor:pointer;user-select:none;" title="Jump to sheet $1">$1↗</span>');
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
  let remaining = text;

  while (remaining.length > 0) {
    const chartIndex = remaining.indexOf('CHART:');

    if (chartIndex === -1) {
      const trimmed = remaining.trim();
      if (trimmed) segments.push({ type: 'text', content: trimmed });
      break;
    }

    // Text before the CHART: marker
    const textBefore = remaining.substring(0, chartIndex).trim();
    if (textBefore) segments.push({ type: 'text', content: textBefore });

    // Walk forward from the opening brace, counting depth
    const jsonStart = chartIndex + 6; // skip 'CHART:'
    let braceCount = 0;
    let jsonEnd = -1;

    for (let i = jsonStart; i < remaining.length; i++) {
      if (remaining[i] === '{') braceCount++;
      else if (remaining[i] === '}') {
        braceCount--;
        if (braceCount === 0) { jsonEnd = i + 1; break; }
      }
    }

    if (jsonEnd === -1) {
      // No matching closing brace — treat the rest as text
      segments.push({ type: 'text', content: remaining.substring(chartIndex) });
      break;
    }

    const jsonStr = remaining.substring(jsonStart, jsonEnd);
    try {
      const chartData = JSON.parse(fixChartJson(jsonStr));
      console.log('[Chart] Parsed segment type:', chartData?.type);
      segments.push({ type: 'chart', chartData });
    } catch (e) {
      console.error('[Chart] JSON parse failed:', e, jsonStr.substring(0, 200));
      segments.push({ type: 'text', content: `CHART:${jsonStr}` });
    }

    remaining = remaining.substring(jsonEnd).trim();
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
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
      <div style={{ padding: 16, background: "#fef3f2", borderRadius: 8, color: RED, fontSize: 12, fontFamily: FONT_STACK }}>
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
      <p style={{ fontFamily: FONT_STACK, fontSize: 14, fontWeight: 700, color: NAVY, margin: "0 0 4px", letterSpacing: "-0.3px" }}>{chartData.title}</p>
      {chartData.description && (
        <p style={{ fontSize: 11, color: "#6b7280", margin: "0 0 12px", fontFamily: FONT_STACK }}>{chartData.description}</p>
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
          <p style={{ fontSize: 12, color: "#6b7280", fontFamily: FONT_STACK }}>Chart type "{chartData.type}" is not yet supported.</p>
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
        <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 12px", fontFamily: FONT_STACK }}>Historical performance extracted from documents</p>
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
          <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "20px 0", fontFamily: FONT_STACK }}>No historical financial data found in documents.</p>
        )}
      </div>

      {/* Divider + Overall Deal Score */}
      <div style={{ borderTop: "1px solid #f0ede8", margin: "16px 0", paddingTop: 16, textAlign: "center" }}>
        <p style={{ ...sectionLabel, margin: "0 0 6px" }}>DEAL SCORE</p>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
          <span style={{ fontFamily: FONT_STACK, fontSize: 48, fontWeight: 700, color: scoreColor, lineHeight: 1, letterSpacing: "-1px" }}>
            {overallScore}
          </span>
          <span style={{ fontSize: 20, color: "#9ca3af", fontFamily: FONT_STACK }}>/10</span>
        </div>
      </div>

      {/* Chart 2: Deal Scorecard */}
      <div>
        <p style={{ ...sectionLabel, margin: "0 0 2px" }}>DEAL SCORECARD</p>
        <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 12px", fontFamily: FONT_STACK }}>AI-scored across six dimensions</p>
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
          <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "20px 0", fontFamily: FONT_STACK }}>No scorecard data available.</p>
        )}
        {deal_scorecard.dimensions?.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            {deal_scorecard.dimensions.map((d: any) => {
              const sc = d.score;
              const sColor = sc <= 4 ? "#dc2626" : sc <= 6 ? "#d97706" : "#16a34a";
              return (
                <div key={d.name} title={d.reasoning} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, padding: "8px 10px", cursor: "default" }}>
                  <p style={{ margin: "0 0 2px", fontSize: 11, color: "#6b7280", fontFamily: FONT_STACK }}>{d.name}</p>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: sColor, fontFamily: FONT_STACK, lineHeight: 1 }}>{sc}</p>
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
function FileExplorer({ docState, docDispatch, collapsed, onToggle, onDocumentExtracted, onRemoveDocument, expandedWidth }: {
  docState: DocumentState;
  docDispatch: React.Dispatch<DocumentAction>;
  collapsed: boolean;
  onToggle: () => void;
  onDocumentExtracted?: (filename: string, fileType: FileType, text: string) => void;
  onRemoveDocument?: (filename: string) => void;
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
            fontFamily: FONT_STACK, textTransform: 'uppercase',
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
              fontFamily: FONT_STACK, textTransform: 'uppercase',
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
              <p style={{ fontSize: 11, color: '#555', textAlign: 'center', padding: '20px 12px', fontFamily: FONT_STACK }}>
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
                    <span style={{ fontSize: 8, fontWeight: 700, flexShrink: 0, padding: '2px 4px', borderRadius: 2, background: getTypeBadgeColor(doc.fileType).bg, color: getTypeBadgeColor(doc.fileType).color, fontFamily: FONT_STACK }}>{getFileIcon(doc.fileType)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11.5, color: isActive ? '#fff' : '#d1d5db',
                        fontFamily: FONT_STACK, fontWeight: isActive ? 600 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        lineHeight: 1.3,
                      }}>
                        {doc.name.length > 22 ? doc.name.substring(0, 20) + '…' : doc.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, color: '#6b7280', fontFamily: FONT_STACK }}>
                          {doc.file ? formatFileSize(doc.file.size) : 'saved'}
                        </span>
                        {doc.isProcessing && (
                          <span style={{ fontSize: 9, color: '#d97706', fontFamily: FONT_STACK }}>
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
                          const name = docState.documents[index].name;
                          onRemoveDocument?.(name);
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
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 6,
    border: '1px solid #e5e7eb', fontSize: 13, fontFamily: FONT_STACK,
    background: '#fff', color: NAVY, outline: 'none',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <p style={{ margin: '0 0 18px', fontSize: 16, fontWeight: 700, color: NAVY, fontFamily: FONT_STACK }}>New Deal</p>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', marginBottom: 5, fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', fontFamily: FONT_STACK }}>
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
        <div style={{ marginBottom: 22 }} />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '9px 18px', background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, fontFamily: FONT_STACK, cursor: 'pointer', color: '#6b7280' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!name.trim()} style={{ padding: '9px 22px', background: RED, color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: name.trim() ? 'pointer' : 'not-allowed', opacity: name.trim() ? 1 : 0.5, fontFamily: FONT_STACK }}>
            Create Deal
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Home Screen ───────────────────────────────────────────────
const SAMPLE_DEALS = [
  { id: '__sample_1', name: 'Maple Healthcare Services', sector: 'Healthcare', verdict: 'Worth Deeper Look', status: 'Active', updated_at: '2026-03-15T10:00:00Z' },
  { id: '__sample_2', name: 'NorthStar Logistics Group', sector: 'Logistics', verdict: null, status: 'Active', updated_at: '2026-03-12T14:30:00Z' },
  { id: '__sample_3', name: 'Acadia Software Inc', sector: 'Technology', verdict: 'Passed', status: 'Passed', updated_at: '2026-03-08T09:15:00Z' },
  { id: '__sample_4', name: 'Ridgeline Industrial', sector: 'Industrials', verdict: 'Worth Deeper Look', status: 'Active', updated_at: '2026-03-01T16:45:00Z' },
];

function HomeScreen({ deals, loading, onNewDeal, onOpenDeal, onDeleteDeal }: {
  deals: Deal[];
  loading: boolean;
  onNewDeal: () => void;
  onOpenDeal: (deal: Deal) => void;
  onDeleteDeal: (dealId: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [verdictFilter, setVerdictFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"updated_desc" | "updated_asc">("updated_desc");

  const showSamples = !loading && deals.length === 0;
  const displayDeals: any[] = showSamples ? SAMPLE_DEALS : deals;

  const sectorOptions = Array.from(new Set(displayDeals.map(d => d.sector).filter(Boolean))).sort();
  const statusOptions = Array.from(new Set(displayDeals.map(d => d.status).filter(Boolean))).sort();

  const normalizedQuery = query.trim().toLowerCase();

  let filteredDeals: any[] = displayDeals;
  if (normalizedQuery) {
    filteredDeals = filteredDeals.filter(d => String(d.name ?? "").toLowerCase().includes(normalizedQuery));
  }
  if (sectorFilter !== "all") {
    filteredDeals = filteredDeals.filter(d => d.sector === sectorFilter);
  }
  if (statusFilter !== "all") {
    filteredDeals = filteredDeals.filter(d => d.status === statusFilter);
  }
  if (verdictFilter !== "all") {
    if (verdictFilter === "__none") filteredDeals = filteredDeals.filter(d => !d.verdict);
    else filteredDeals = filteredDeals.filter(d => d.verdict === verdictFilter);
  }

  const toTs = (s: string) => {
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  filteredDeals = [...filteredDeals].sort((a, b) => {
    const diff = toTs(b.updated_at) - toTs(a.updated_at);
    return sortOrder === "updated_desc" ? diff : -diff;
  });

  const isDefaultFilters = !query && sectorFilter === "all" && verdictFilter === "all" && statusFilter === "all" && sortOrder === "updated_desc";
  const clearFilters = () => {
    setQuery("");
    setSectorFilter("all");
    setVerdictFilter("all");
    setStatusFilter("all");
    setSortOrder("updated_desc");
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: OFFWHITE }}>
      <style>{GLOBAL_STYLE}</style>

      {/* Nav bar */}
      <div style={{ height: 52, background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src={process.env.PUBLIC_URL + '/sagard.svg'} height="28" alt="Sagard" style={{ display: 'block' }} />
          <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />
          <span style={{ fontFamily: FONT_STACK, fontWeight: 600, fontSize: 13, color: '#6b7280' }}>CIM Analyzer</span>
        </div>
        <button
          onClick={onNewDeal}
          style={{ background: RED, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT_STACK }}
        >
          + New Deal
        </button>
      </div>

      {/* Hero strip */}
      <div style={{ height: 80, background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', padding: '0 28px', gap: 20, flexShrink: 0 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#9ca3af', letterSpacing: '2px', fontFamily: FONT_STACK }}>DEAL PIPELINE</p>
          <p style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 700, color: NAVY, fontFamily: FONT_STACK }}>
            {loading ? '—' : deals.length}
            <span style={{ fontSize: 12, fontWeight: 500, color: '#9ca3af', marginLeft: 6 }}>deals</span>
          </p>
        </div>
        <div style={{ width: 1, height: 36, background: '#e5e7eb', marginLeft: 8 }} />
        {[
          { label: 'Active', value: deals.filter(d => d.status === 'Active').length, color: '#6b7280' },
          { label: 'Worth Deeper Look', value: deals.filter(d => d.verdict === 'Worth Deeper Look').length, color: '#166534' },
          { label: 'Passed', value: deals.filter(d => d.verdict === 'Passed').length, color: '#991b1b' },
        ].map(stat => (
          <div key={stat.label} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 12px' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: stat.color, fontFamily: FONT_STACK }}>{stat.value}</span>
            <span style={{ fontSize: 11, color: '#6b7280', fontFamily: FONT_STACK }}>{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Filters / Search */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '12px 28px', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 280px', minWidth: 220 }}>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', fontFamily: FONT_STACK }}>
              Search deals
            </label>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type a deal name…"
              style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontFamily: FONT_STACK, outline: 'none', background: '#fff' }}
            />
          </div>

          <div style={{ minWidth: 180 }}>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', fontFamily: FONT_STACK }}>
              Sector
            </label>
            <select
              value={sectorFilter}
              onChange={e => setSectorFilter(e.target.value)}
              style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontFamily: FONT_STACK, outline: 'none', background: '#fff', appearance: 'none' }}
            >
              <option value="all">All sectors</option>
              {sectorOptions.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div style={{ minWidth: 200 }}>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', fontFamily: FONT_STACK }}>
              Verdict
            </label>
            <select
              value={verdictFilter}
              onChange={e => setVerdictFilter(e.target.value)}
              style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontFamily: FONT_STACK, outline: 'none', background: '#fff', appearance: 'none' }}
            >
              <option value="all">All verdicts</option>
              <option value="Worth Deeper Look">Worth Deeper Look</option>
              <option value="Passed">Passed</option>
              <option value="__none">No verdict</option>
            </select>
          </div>

          <div style={{ minWidth: 170 }}>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', fontFamily: FONT_STACK }}>
              Status
            </label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontFamily: FONT_STACK, outline: 'none', background: '#fff', appearance: 'none' }}
            >
              <option value="all">All status</option>
              {statusOptions.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div style={{ minWidth: 190 }}>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', fontFamily: FONT_STACK }}>
              Sort
            </label>
            <select
              value={sortOrder}
              onChange={e => setSortOrder(e.target.value as any)}
              style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontFamily: FONT_STACK, outline: 'none', background: '#fff', appearance: 'none' }}
            >
              <option value="updated_desc">Last updated (newest)</option>
              <option value="updated_asc">Last updated (oldest)</option>
            </select>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', gap: 10, paddingBottom: 18 }}>
            <div style={{ fontSize: 12, color: '#6b7280', fontFamily: FONT_STACK }}>
              Showing <strong style={{ color: NAVY }}>{filteredDeals.length}</strong> of <strong style={{ color: NAVY }}>{displayDeals.length}</strong>
            </div>
            <button
              onClick={clearFilters}
              disabled={isDefaultFilters}
              style={{
                padding: '8px 12px',
                background: isDefaultFilters ? '#f3f4f6' : 'none',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: isDefaultFilters ? 'not-allowed' : 'pointer',
                fontFamily: FONT_STACK,
                color: isDefaultFilters ? '#9ca3af' : '#374151',
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px' }}>
        {loading ? (
          <div style={{ padding: '0 0', display: 'flex', flexDirection: 'column' }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 52, background: '#fff', borderBottom: '1px solid #e5e7eb', opacity: 0.4 + i * 0.1 }} />
            ))}
          </div>
        ) : (
          filteredDeals.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '44px 20px 60px' }}>
              <img
                src={process.env.PUBLIC_URL + '/sagard.svg'}
                height="28"
                alt="Sagard"
                style={{ opacity: 0.12, marginBottom: 14, display: 'block', marginLeft: 'auto', marginRight: 'auto' }}
              />
              <p style={{ fontSize: 13, color: '#9ca3af', fontFamily: FONT_STACK, margin: '0 0 8px' }}>
                No deals match your filters.
              </p>
              <p style={{ fontSize: 12, color: '#6b7280', fontFamily: FONT_STACK, margin: '0 0 16px' }}>
                Try adjusting the filters or clearing them.
              </p>
              <button onClick={clearFilters} style={{ background: RED, color: '#fff', border: 'none', borderRadius: 6, padding: '10px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT_STACK }}>
                Reset filters
              </button>
            </div>
          ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
                {['DEAL NAME', 'SECTOR', 'VERDICT', 'LAST UPDATED', 'STATUS'].map(col => (
                  <th key={col} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '1.5px', fontFamily: FONT_STACK, whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2, background: '#fff' }}>
                    {col}
                  </th>
                ))}
                <th style={{ width: 170, position: 'sticky', top: 0, zIndex: 2, background: '#fff' }} />
              </tr>
            </thead>
            <tbody>
              {filteredDeals.map((deal: any) => {
                const isSample = String(deal.id).startsWith('__sample');
                const isHovered = hoveredId === deal.id;
                const pill = deal.verdict ? dealVerdictPill[deal.verdict as string] : null;
                return (
                  <tr
                    key={deal.id}
                    onMouseEnter={() => setHoveredId(deal.id)}
                    onMouseLeave={() => { setHoveredId(null); setConfirmDeleteId(null); }}
                    onClick={() => isSample ? onNewDeal() : onOpenDeal(deal as Deal)}
                    style={{ borderBottom: '1px solid #e5e7eb', background: isHovered ? '#fef9f9' : '#fff', cursor: 'pointer', transition: 'background 0.1s' }}
                  >
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: NAVY, fontFamily: FONT_STACK }}>{deal.name}</span>
                        {isSample && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb', fontFamily: FONT_STACK, letterSpacing: '0.5px' }}>SAMPLE</span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', fontFamily: FONT_STACK, background: '#f5f5f5', border: '1px solid #e5e7eb', borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap' }}>{deal.sector}</span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      {pill ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: pill.bg, color: pill.color, border: `1px solid ${pill.border}`, fontFamily: FONT_STACK, whiteSpace: 'nowrap' }}>
                          {deal.verdict}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: '#d1d5db', fontFamily: FONT_STACK }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{ fontSize: 12, color: '#6b7280', fontFamily: FONT_STACK }}>{formatRelativeTime(deal.updated_at)}</span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{ fontSize: 11, fontWeight: 500, fontFamily: FONT_STACK, color: deal.status === 'Passed' ? '#991b1b' : deal.status === 'Worth Deeper Look' ? '#166534' : '#6b7280' }}>
                        {deal.status}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px', textAlign: 'right', width: 170, minWidth: 170 }} onClick={e => e.stopPropagation()}>
                      {!isSample && (
                        <div style={{ minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, whiteSpace: 'nowrap' }}>
                          {confirmDeleteId === deal.id ? (
                            <>
                              <span style={{ fontSize: 11, color: '#6b7280', fontFamily: FONT_STACK }}>Delete?</span>
                              <button onClick={() => { onDeleteDeal(deal.id); setConfirmDeleteId(null); }} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT_STACK }}>Yes</button>
                              <button onClick={() => setConfirmDeleteId(null)} style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT_STACK }}>No</button>
                            </>
                          ) : isHovered ? (
                            <button
                              onClick={() => setConfirmDeleteId(deal.id)}
                              style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 4, padding: '3px 8px', fontSize: 11, color: '#9ca3af', cursor: 'pointer', fontFamily: FONT_STACK }}
                              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#dc2626'; (e.currentTarget as HTMLButtonElement).style.color = '#dc2626'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#e5e7eb'; (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; }}
                            >
                              Delete
                            </button>
                          ) : (
                            <div style={{ width: 68, height: 22 }} />
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )
        )}

        {/* Empty-state prompt below sample rows */}
        {showSamples && isDefaultFilters && (
          <div style={{ textAlign: 'center', padding: '36px 20px 60px', borderTop: '1px solid #e5e7eb' }}>
            <img src={process.env.PUBLIC_URL + '/sagard.svg'} height="28" alt="Sagard" style={{ opacity: 0.12, marginBottom: 16, display: 'block', margin: '0 auto 16px' }} />
            <p style={{ fontSize: 13, color: '#9ca3af', fontFamily: FONT_STACK, margin: '0 0 20px' }}>These are sample deals. Add your first CIM to get started.</p>
            <button onClick={onNewDeal} style={{ background: RED, color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT_STACK }}>
              + New Deal
            </button>
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
        <p style={{ color: '#6b7280', fontSize: 13, fontFamily: FONT_STACK, margin: 0 }}>Searching for comparable transactions…</p>
        <p style={{ color: '#9ca3af', fontSize: 11, fontFamily: FONT_STACK, margin: 0 }}>Running targeted M&A database searches</p>
      </div>
    );
  }

  if (!compsData) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: OFFWHITE }}>
        <p style={{ color: '#9ca3af', fontSize: 13, fontFamily: FONT_STACK }}>No comparable transaction data available.</p>
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
          <span style={{ fontSize: 11, fontWeight: 600, background: '#1a1a1a', color: '#fff', borderRadius: 4, padding: '2px 8px', fontFamily: FONT_STACK }}>
            {deal_profile?.sector}
          </span>
          {deal_profile?.sub_sector && (
            <span style={{ fontSize: 11, fontWeight: 600, background: '#f5f5f5', color: '#374151', borderRadius: 4, padding: '2px 8px', border: '1px solid #e5e7eb', fontFamily: FONT_STACK }}>
              {deal_profile.sub_sector}
            </span>
          )}
          {deal_profile?.geography && (
            <span style={{ fontSize: 11, color: '#6b7280', background: '#f5f5f5', borderRadius: 4, padding: '2px 8px', border: '1px solid #e5e7eb', fontFamily: FONT_STACK }}>
              {deal_profile.geography}
            </span>
          )}
        </div>
        <p style={{ margin: '0 0 6px', fontSize: 12, color: '#374151', lineHeight: 1.5, fontFamily: FONT_STACK }}>
          {deal_profile?.description}
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {deal_profile?.revenue_millions && (
            <span style={{ fontSize: 11, color: '#6b7280', fontFamily: FONT_STACK }}>
              Revenue: <strong style={{ color: '#1a1a1a' }}>${deal_profile.revenue_millions}M</strong>
            </span>
          )}
          {deal_profile?.ebitda_millions && (
            <span style={{ fontSize: 11, color: '#6b7280', fontFamily: FONT_STACK }}>
              EBITDA: <strong style={{ color: '#1a1a1a' }}>${deal_profile.ebitda_millions}M</strong>
            </span>
          )}
          {deal_profile?.ebitda_margin_pct && (
            <span style={{ fontSize: 11, color: '#6b7280', fontFamily: FONT_STACK }}>
              Margin: <strong style={{ color: '#1a1a1a' }}>{deal_profile.ebitda_margin_pct}%</strong>
            </span>
          )}
        </div>
      </div>

      {/* Comps Table */}
      <div style={{ background: '#fff', margin: '6px 0', padding: '14px 16px', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
        <p style={{ margin: '0 0 10px', ...sectionLabel }}>COMPARABLE TRANSACTIONS ({comps?.length ?? 0})</p>
        {(comps?.length ?? 0) === 0 ? (
          <p style={{ fontSize: 12, color: '#9ca3af', fontFamily: FONT_STACK }}>No confirmed comparable transactions found in public sources.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: FONT_STACK }}>
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
                      <td style={{ padding: '8px 10px', color: '#6b7280', minWidth: 260, verticalAlign: 'top' }}>
                        <div
                          title={comp.why_comparable}
                          style={{
                            whiteSpace: 'normal',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                            lineHeight: 1.4,
                          }}
                        >
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


      {/* Deal Positioning */}
      {this_deal_positioning?.vs_comp_set && this_deal_positioning.vs_comp_set !== 'Cannot determine' && (
        <div style={{ background: '#fff', margin: '6px 0', padding: '14px 16px', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <p style={{ margin: 0, ...sectionLabel }}>DEAL POSITIONING</p>
            <span style={{ fontSize: 11, fontWeight: 700, color: vsColor, background: vsColor + '15', border: `1px solid ${vsColor}40`, borderRadius: 4, padding: '2px 8px', fontFamily: FONT_STACK }}>
              {this_deal_positioning.vs_comp_set.toUpperCase()}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.6, fontFamily: FONT_STACK }}>
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
                <p style={{ margin: 0, fontSize: 11, color: '#374151', lineHeight: 1.4, fontFamily: FONT_STACK }}>{d}</p>
              </div>
            ))}
          </div>
          <div style={{ background: '#fff', padding: '12px', borderRadius: 6, border: '1px solid #e5e7eb' }}>
            <p style={{ margin: '0 0 8px', ...sectionLabel, color: '#dc2626' }}>DISCOUNT DRIVERS</p>
            {(sector_context.discount_drivers ?? []).map((d, i) => (
              <div key={i} style={{ borderLeft: '2px solid #dc2626', paddingLeft: 8, marginBottom: 6 }}>
                <p style={{ margin: 0, fontSize: 11, color: '#374151', lineHeight: 1.4, fontFamily: FONT_STACK }}>{d}</p>
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
            <p key={i} style={{ margin: '0 0 10px', fontSize: 12, color: '#374151', lineHeight: 1.7, fontFamily: FONT_STACK }}>{para}</p>
          ))}
        </div>
      )}

      {/* Data Quality Notice */}
      <div style={{ margin: '0 0 16px', padding: '10px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, marginLeft: 16, marginRight: 16 }}>
        <p style={{ margin: 0, fontSize: 11, color: '#92400e', fontFamily: FONT_STACK, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 500 }}>Data Quality:</span> {data_quality_note ?? 'Comps are sourced from public web data and may be incomplete. Verify with PitchBook or CapIQ before use in any IC memo.'}
        </p>
      </div>

    </div>
  );
}

function Results({
  data, uploadedFiles, onReset, documentText, documentsText, chartsData,
  compsData, compsLoading, savedDocEntries, initialChatMessages,
  dealName, dealStatus, onStatusChange, onSaveChatMessage, saveError, onBackToHome,
  onDocumentExtracted, onRemoveDocument, sector,
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
  onRemoveDocument?: (filename: string) => void;
  sector: string;
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

  // Tracks which Excel sheet to display (set by window.jumpToSheet)
  const [requestedSheet, setRequestedSheet] = useState<string | null>(null);

  // Expose window.jumpToSheet — switches to the right Excel doc and activates the named sheet
  useEffect(() => {
    (window as any).jumpToSheet = (sheetName: string, docName?: string) => {
      const state = docStateRef.current;
      let targetIndex = state.activeIndex;

      if (docName) {
        const clean = docName.trim().toLowerCase().replace(/\.(xlsx|xls|xlsm)$/i, '').replace(/[-_]/g, ' ').trim();
        const scored = state.documents.map((doc: DocEntry, index: number) => {
          const docClean = doc.name.toLowerCase().replace(/\.(xlsx|xls|xlsm)$/i, '').replace(/[-_]/g, ' ').trim();
          let score = 0;
          if (docClean === clean) score += 100;
          if (docClean.includes(clean) || clean.includes(docClean)) score += 50;
          return { index, score };
        });
        scored.sort((a: any, b: any) => b.score - a.score);
        if (scored[0].score > 0) targetIndex = scored[0].index;
      }

      if (targetIndex !== state.activeIndex) {
        docDispatch({ type: 'SWITCH_DOCUMENT', payload: targetIndex });
      }
      setRequestedSheet(sheetName);
      setTimeout(() => {
        document.getElementById('pdf-viewer-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    };
    return () => { delete (window as any).jumpToSheet; };
  }, []);

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
      formData.append('sector', sector);
      const { data: resp } = await axios.post<{ response: string }>(`${API_BASE_URL}/chat`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      console.log('[Chat] Raw response:', resp.response?.substring(0, 300));
      const parsedSegments = parseResponseSegments(resp.response);
      console.log('[Chat] Segments:', parsedSegments.map(s => s.type === 'chart' ? `chart(${s.chartData?.type})` : `text(${s.content.length}ch)`));
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: resp.response,
        segments: parsedSegments,
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
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.write(buildICBrief(assessment, claims, conflicts, uploadedFiles[0]?.name ?? 'Document', compsData, dealName, chartsData));
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    }, 500);
  };

  const filteredClaims = claims.filter(c =>
    claimFilter === "all" ? true : claimFilter === "unverifiable" ? c.verdict === "unverifiable" : c.verdict === claimFilter
  );

  const panelBtnBase: React.CSSProperties = {
    padding: '4px 10px', border: '1px solid #e5e7eb', borderRadius: 8,
    fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT_STACK,
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
            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', borderRadius: 5, padding: '4px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT_STACK, whiteSpace: 'nowrap' }}
          >
            ← All Deals
          </button>
          <img src="/sagard.svg" alt="Sagard" style={{ height: 28, width: 'auto', display: 'block', filter: 'brightness(0) invert(1)' }} />
          {dealName && (
            <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: FONT_STACK, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
              {dealName}
            </span>
          )}
        </div>
        {/* Right: save error + status dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {saveError && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,200,0.9)', fontFamily: FONT_STACK, animation: 'pulse 1s ease-in-out' }}>
              Not saved
            </span>
          )}
          <select
            value={dealStatus}
            onChange={e => onStatusChange(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', borderRadius: 5, padding: '4px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT_STACK, outline: 'none' }}
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
          onRemoveDocument={onRemoveDocument}
          expandedWidth={explorerWidth}
        />

        {/* Drag divider: Explorer | PDF */}
        <DragDivider onDrag={handleExplorerDividerDrag} dark={true} />

        {/* Center: Document viewer */}
        <div id="pdf-viewer-panel" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          {(() => {
            const activeDoc = docState.documents[docState.activeIndex];
            const isPdf = !activeDoc || activeDoc.fileType === 'pdf';
            return (
              <>
                {/* Pagination bar — only for PDFs */}
                {isPdf && (
                  <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: '#ffffff', borderBottom: '1px solid #e5e7eb', fontSize: 11, fontFamily: FONT_STACK, color: '#6b7280' }}>
                    <button onClick={() => navigateTo(docState.currentPage - 1)} disabled={docState.currentPage <= 1}
                      style={{ background: 'none', border: 'none', cursor: docState.currentPage <= 1 ? 'default' : 'pointer', color: RED, fontWeight: 600, fontSize: 13, padding: '0 4px', opacity: docState.currentPage <= 1 ? 0.3 : 1 }}>←</button>
                    <span>Page {docState.currentPage}{activeDoc?.numPages ? ` of ${activeDoc.numPages}` : ''}</span>
                    <button onClick={() => navigateTo(docState.currentPage + 1)}
                      disabled={!!(activeDoc?.numPages && docState.currentPage >= (activeDoc.numPages ?? Infinity))}
                      style={{ background: 'none', border: 'none', cursor: (activeDoc?.numPages && docState.currentPage >= (activeDoc.numPages ?? Infinity)) ? 'default' : 'pointer', color: RED, fontWeight: 600, fontSize: 13, padding: '0 4px', opacity: (activeDoc?.numPages && docState.currentPage >= (activeDoc.numPages ?? Infinity)) ? 0.3 : 1 }}>→</button>
                  </div>
                )}

                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  {/* Excel viewer */}
                  {activeDoc && activeDoc.fileType !== 'pdf' ? (
                    activeDoc.url
                      ? <ExcelViewer url={activeDoc.url} requestedSheet={requestedSheet} />
                      : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa' }}>
                          <span style={{ fontSize: 12, color: '#9ca3af', fontFamily: FONT_STACK }}>Re-upload to view this spreadsheet.</span>
                        </div>
                  ) : activeDoc?.url ? (
                    /* PDF viewer */
                    <PDFViewer
                      file={activeDoc.url}
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
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#555', fontFamily: FONT_STACK, letterSpacing: '2px', opacity: 0.4 }}>PDF</div>
                      <p style={{ color: '#9ca3af', fontSize: 13, fontFamily: FONT_STACK, margin: 0, textAlign: 'center', lineHeight: 1.5 }}>PDF not available</p>
                      <p style={{ color: '#6b7280', fontSize: 11, fontFamily: FONT_STACK, margin: 0, textAlign: 'center' }}>
                        Re-upload this document to view it.<br />Text content is still available for chat.
                      </p>
                    </div>
                  ) : null}
                </div>
              </>
            );
          })()}
        </div>

        {/* Drag divider: PDF | Analysis */}
        <DragDivider onDrag={handleMainDividerDrag} dark={false} />

        {/* Right: Analysis — tabbed dashboard */}
        <div style={{ width: rightPanelWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

          {/* Panel header — company name + verdict pill + actions */}
          <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#fff', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, overflow: 'hidden' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', fontFamily: FONT_STACK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {companyName}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: overallCfg.bg, color: overallCfg.color, border: `1px solid ${overallCfg.color}40`, fontFamily: FONT_STACK, letterSpacing: '0.5px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {assessment.overall_verdict.toUpperCase()}
              </span>
              {dealScore > 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, color: dealScoreColor, fontFamily: FONT_STACK, flexShrink: 0 }}>{dealScore}/10</span>
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
                  padding: '0 13px 10px 13px', fontFamily: FONT_STACK, fontSize: 11, fontWeight: 600,
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
              <div style={{ flex: 1, overflowY: 'auto', background: '#fff' }}>

                {/* Verdict */}
                <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #e5e7eb' }}>
                  <p style={{ ...sectionLabel, margin: '0 0 10px' }}>FIRST-PASS VERDICT</p>
                  <p style={{ margin: '0 0 6px', fontFamily: FONT_STACK, fontSize: 26, fontWeight: 700, color: overallCfg.color, lineHeight: 1.15, letterSpacing: '-0.3px' }}>
                    {assessment.overall_verdict}
                  </p>
                  <p style={{ margin: '0 0 10px', fontSize: 13, color: '#374151', lineHeight: 1.55, fontFamily: FONT_STACK }}>
                    {assessment.reasoning}
                  </p>
                  {assessment.criteria_fit && (
                    <p style={{ margin: 0, fontSize: 11, fontFamily: FONT_STACK, color: assessment.criteria_fit.fits ? '#166534' : '#991b1b' }}>
                      {assessment.criteria_fit.fits ? '✓ Fits' : '✗ Outside'} investment criteria — {assessment.criteria_fit.explanation}
                    </p>
                  )}
                </div>

                {/* Company + Deal Metrics */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ padding: '14px 16px', borderRight: '1px solid #e5e7eb' }}>
                    <p style={{ ...sectionLabel, margin: '0 0 8px' }}>COMPANY</p>
                    <p style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.6, fontFamily: FONT_STACK }}>
                      {assessment.company_snapshot}
                    </p>
                  </div>
                  <div style={{ padding: '14px 16px' }}>
                    <p style={{ ...sectionLabel, margin: '0 0 8px' }}>DEAL METRICS</p>
                    {compsData?.deal_profile ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {([
                          { label: 'Revenue', value: compsData.deal_profile.revenue_millions ? `$${compsData.deal_profile.revenue_millions}M` : null },
                          { label: 'EBITDA', value: compsData.deal_profile.ebitda_millions ? `$${compsData.deal_profile.ebitda_millions}M` : null },
                          { label: 'Margin', value: compsData.deal_profile.ebitda_margin_pct ? `${compsData.deal_profile.ebitda_margin_pct}%` : null },
                          { label: 'Sector', value: compsData.deal_profile.sector ?? null },
                          { label: 'Geography', value: compsData.deal_profile.geography ?? null },
                        ] as { label: string; value: string | null }[]).filter(m => m.value).map(m => (
                          <div
                            key={m.label}
                            style={{
                              display: 'flex',
                              justifyContent: 'flex-start',
                              alignItems: 'flex-start',
                              gap: 12,
                              borderBottom: '1px solid #f3f4f6',
                              paddingBottom: 5,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                color: '#9ca3af',
                                fontFamily: FONT_STACK,
                                flexShrink: 0,
                                minWidth: 82,
                              }}
                            >
                              {m.label}
                            </span>
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: NAVY,
                                fontFamily: FONT_STACK,
                                flex: 1,
                                minWidth: 0,
                                whiteSpace: 'normal',
                                overflowWrap: 'anywhere',
                                wordBreak: 'break-word',
                              }}
                            >
                              {m.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: 11, color: '#9ca3af', fontFamily: FONT_STACK, margin: 0 }}>
                        {compsLoading ? 'Loading metrics…' : 'Run COMPS to populate deal metrics.'}
                      </p>
                    )}
                  </div>
                </div>

                {/* Seller narrative */}
                {assessment.sellers_narrative && (
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <p style={{ margin: 0, ...sectionLabel }}>SELLER NARRATIVE</p>
                      {assessment.narrative_holds_up && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: assessment.narrative_holds_up.holds ? '#166534' : '#991b1b', fontFamily: FONT_STACK }}>
                          {assessment.narrative_holds_up.holds ? 'Holds up' : 'Does not hold'}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: '0 0 6px', fontSize: 12, color: '#374151', lineHeight: 1.6, fontFamily: FONT_STACK, borderLeft: '2px solid #e5e7eb', paddingLeft: 12 }}>
                      {assessment.sellers_narrative}
                    </p>
                    {assessment.narrative_holds_up?.explanation && (
                      <p style={{ margin: 0, fontSize: 11, color: '#6b7280', fontFamily: FONT_STACK }}>{assessment.narrative_holds_up.explanation}</p>
                    )}
                  </div>
                )}

                {/* Risks + Bull Case */}
                {(assessment.top_risks?.length > 0 || assessment.bull_case) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #e5e7eb' }}>
                    <div style={{ padding: '14px 16px', borderRight: '1px solid #e5e7eb' }}>
                      <p style={{ ...sectionLabel, margin: '0 0 12px' }}>RISKS</p>
                      {assessment.top_risks?.map((risk, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: i < (assessment.top_risks.length - 1) ? '1px solid #f3f4f6' : 'none' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', flexShrink: 0, fontFamily: FONT_STACK, minWidth: 16 }}>{i + 1}.</span>
                          <p style={{ margin: 0, fontSize: 12, color: '#dc2626', lineHeight: 1.5, fontFamily: FONT_STACK }}>{risk}</p>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: '14px 16px' }}>
                      <p style={{ ...sectionLabel, margin: '0 0 12px', color: '#16a34a' }}>BULL CASE</p>
                      {assessment.bull_case && (
                        <p style={{ margin: 0, fontSize: 12, color: '#16a34a', lineHeight: 1.6, fontFamily: FONT_STACK }}>{assessment.bull_case}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Key questions */}
                {assessment.key_questions?.length > 0 && (
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
                    <p style={{ ...sectionLabel, margin: '0 0 12px' }}>KEY QUESTIONS FOR MANAGEMENT</p>
                    {assessment.key_questions.map((q, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, paddingBottom: 8, borderBottom: i < (assessment.key_questions.length - 1) ? '1px solid #f3f4f6' : 'none' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: RED, flexShrink: 0, fontFamily: FONT_STACK, minWidth: 16 }}>{i + 1}.</span>
                        <p style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.5, fontFamily: FONT_STACK }}>{q}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Diligence checklist */}
                {claims.filter(c => c.diligence_question).length > 0 && (
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <p style={{ margin: 0, ...sectionLabel }}>DILIGENCE CHECKLIST</p>
                      <button onClick={copyDiligenceQuestions} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 4, padding: '3px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: FONT_STACK, color: '#374151' }}>Copy all</button>
                    </div>
                    {claims.filter(c => c.diligence_question).map((c, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start', paddingBottom: 8, borderBottom: '1px solid #f3f4f6' }}>
                        <input type="checkbox" style={{ marginTop: 2, flexShrink: 0, accentColor: RED }} onClick={e => e.stopPropagation()} />
                        <p style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.5, fontFamily: FONT_STACK }}>{c.diligence_question}</p>
                      </div>
                    ))}
                  </div>
                )}

              </div>
            )}

            {/* ── CLAIMS TAB ── */}
            {activeTab === 'claims' && (
              <div style={{ flex: 1, overflowY: 'auto', background: OFFWHITE }}>
                {/* Filter row */}
                <div style={{ background: '#fff', padding: '0 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 0, alignItems: 'flex-end' }}>
                  <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: FONT_STACK, marginRight: 8, paddingBottom: 10 }}>{claims.length} claims</span>
                  {(["all", "disputed", "unverifiable", "verified"] as ClaimFilter[]).map(tab => (
                    <button key={tab} onClick={() => setClaimFilter(tab)} style={{
                      padding: '0 10px 8px', fontFamily: FONT_STACK, fontSize: 10, fontWeight: 700,
                      letterSpacing: '1px', textTransform: 'uppercase' as const, cursor: 'pointer',
                      color: claimFilter === tab ? NAVY : '#9ca3af',
                      border: 'none', borderBottom: claimFilter === tab ? `2px solid ${NAVY}` : '2px solid transparent',
                      background: 'transparent',
                    }}>
                      {tab === 'unverifiable' ? 'Ask Mgmt' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                      {tab !== 'all' && <span style={{ marginLeft: 3 }}>({claims.filter(c => c.verdict === tab).length})</span>}
                    </button>
                  ))}
                </div>
                <div style={{ background: '#fff' }}>
                  {filteredClaims.length === 0 ? (
                    <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', padding: '20px 0', fontFamily: FONT_STACK }}>No claims in this category.</p>
                  ) : filteredClaims.map(claim => {
                    const idx = claims.indexOf(claim);
                    return <ClaimCard key={claim.id ?? idx} claim={claim} index={idx} isActive={activeClaim === idx} onClick={() => setActiveClaim(activeClaim === idx ? null : idx)} />;
                  })}
                </div>
              </div>
            )}

            {/* ── CONFLICTS TAB ── */}
            {activeTab === 'conflicts' && (
              <div style={{ flex: 1, overflowY: 'auto', background: '#fff' }}>
                {conflicts.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px 20px', color: '#6b7280', fontSize: 13, fontFamily: FONT_STACK }}>
                    No cross-document conflicts detected.
                  </div>
                ) : (
                  conflicts.map((c, i) => {
                    const sev = severityConfig[c.severity] ?? severityConfig.low;
                    const borderColor = c.severity === 'high' ? '#dc2626' : c.severity === 'medium' ? '#d97706' : '#9ca3af';
                    return (
                      <div key={i} style={{ borderLeft: `3px solid ${borderColor}`, borderBottom: '1px solid #e5e7eb', padding: '14px 16px 14px 14px' }}>
                        <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 700, color: borderColor, fontFamily: FONT_STACK, textTransform: 'uppercase', letterSpacing: '1px' }}>
                          {sev.label} Severity
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
                          {([{ label: c.doc1, text: c.claim1 }, { label: c.doc2, text: c.claim2 }]).map((side, j) => (
                            <div key={j}>
                              <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', fontFamily: FONT_STACK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{side.label}</p>
                              <div style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.5, fontFamily: FONT_STACK, fontStyle: 'italic' }}
                                dangerouslySetInnerHTML={{ __html: '"' + formatCitations(side.text) + '"' }} />
                            </div>
                          ))}
                        </div>
                        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
                          <div style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.5, fontFamily: FONT_STACK }}
                            dangerouslySetInnerHTML={{ __html: formatCitations(c.explanation) }} />
                        </div>
                      </div>
                    );
                  })
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
                    <div style={{ textAlign: 'center', padding: '48px 20px', color: '#9ca3af', fontSize: 13, fontFamily: FONT_STACK }}>
                      Ask anything about this deal
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {chatMessages.map((msg, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        {msg.role === 'user' ? (
                          <div style={{ maxWidth: '75%' }}>
                            <div style={{ background: RED, color: '#fff', borderRadius: '12px 12px 2px 12px', padding: '8px 12px', fontSize: 13, fontFamily: FONT_STACK, lineHeight: 1.5 }}>
                              {msg.content}
                            </div>
                            {msg.timestamp && <div style={{ fontSize: 10, color: '#9ca3af', textAlign: 'right', marginTop: 3, fontFamily: FONT_STACK }}>{msg.timestamp}</div>}
                          </div>
                        ) : (
                          <div style={{ maxWidth: msg.segments?.some(s => s.type === 'chart') ? '100%' : '92%' }}>
                            <div style={{ borderLeft: '2px solid #e5e7eb', paddingLeft: 12, marginLeft: 4 }}>
                              {(msg.segments && msg.segments.length > 0
                                ? msg.segments
                                : parseResponseSegments(msg.content)
                              ).map((segment, si) =>
                                segment.type === 'chart' ? (
                                  <ChartRenderer key={si} chartData={segment.chartData} />
                                ) : (
                                  <div key={si} dangerouslySetInnerHTML={{ __html: formatCitations(segment.content) }} />
                                )
                              )}
                            </div>
                            {msg.timestamp && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3, marginLeft: 16, fontFamily: FONT_STACK }}>{msg.timestamp}</div>}
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
                      style={{ padding: '4px 10px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11, fontFamily: FONT_STACK, fontWeight: 500, color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {q}
                    </button>
                  ))}
                </div>

                {/* Input row */}
                <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderTop: '1px solid #e5e7eb', background: '#fff', flexShrink: 0, alignItems: 'center' }}>
                  {chatMessages.length > 0 && (
                    <button onClick={() => setChatMessages([])} style={{ background: 'none', border: 'none', fontSize: 10, color: '#9ca3af', cursor: 'pointer', fontFamily: FONT_STACK, flexShrink: 0, padding: 0 }}>Clear</button>
                  )}
                  <input
                    ref={chatInputRef}
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') sendChatMessage(); }}
                    placeholder="Ask anything about this deal..."
                    style={{ flex: 1, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, fontFamily: FONT_STACK, outline: 'none', color: '#1a1a1a' }}
                    disabled={chatLoading}
                  />
                  <button onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()}
                    style={{ padding: '8px 16px', background: RED, color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: FONT_STACK, cursor: chatLoading || !chatInput.trim() ? 'not-allowed' : 'pointer', opacity: chatLoading || !chatInput.trim() ? 0.55 : 1 }}>
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
    saveDocument, deleteDocument, saveAnalysis, saveChatMessage, deleteDeal, saveError,
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

  // ── Keep-alive ping to prevent Render cold starts ────────────
  useEffect(() => {
    const ping = () => fetch(`${API_BASE_URL}/health`).catch(() => {});
    ping();
    const interval = setInterval(ping, 8 * 60 * 1000); // every 8 min
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleCreateDeal = async (name: string) => {
    const dealSector = "Private Equity";
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

  const handleRemoveDocument = useCallback(async (filename: string) => {
    // 1. Remove from Supabase
    if (activeDealId) await deleteDocument(activeDealId, filename);
    // 2. Remove from uploadedFiles state (drives the viewer)
    setUploadedFiles(prev => {
      const updated = prev.filter(f => f.name !== filename);
      // 3. Re-save the updated file list to IndexedDB so it's gone on next reload
      if (activeDealId) {
        saveFilesToIDB(activeDealId, updated);
        dealFilesCache.current.set(activeDealId, updated);
      }
      return updated;
    });
    // 4. Also remove from savedDocEntries in case IDB was empty (DB-only path)
    setSavedDocEntries(prev => prev.filter(d => d.name !== filename));
  }, [activeDealId, deleteDocument]);

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

  const handleSetPrimary = useCallback((i: number) => {
    setStagedFiles(prev => {
      const next = [...prev];
      const [file] = next.splice(i, 1);
      next.unshift(file);
      return next;
    });
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
        <p style={{ color: '#6b7280', fontSize: 13, fontFamily: FONT_STACK }}>Loading deal…</p>
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
        onRemoveDocument={handleRemoveDocument}
        sector={sector}
      />
    );
  }

  return (
    <UploadZone
      files={stagedFiles}
      onAddFiles={handleAddFiles}
      onRemoveFile={handleRemoveFile}
      onSetPrimary={handleSetPrimary}
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
