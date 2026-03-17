import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Document, Page } from "react-pdf";
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import axios from "axios";

const BACKEND_URL = "http://localhost:8000";

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
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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

const GLOBAL_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: ${OFFWHITE}; color: ${NAVY}; }
  a:hover { opacity: 0.8; }
  textarea:focus { outline: 1px solid ${RED}; border-color: transparent; }
  .react-pdf__Page { display: block !important; }
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes typing-dot { 0%, 60%, 100% { opacity: 0.2; transform: scale(0.8); } 30% { opacity: 1; transform: scale(1); } }
`;

// ── Utilities ────────────────────────────────────────────────
function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

const sectionLabel: React.CSSProperties = {
  fontFamily: "'Inter', sans-serif",
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
}

function UploadZone({
  files, onAddFiles, onRemoveFile, onAnalyze, loading, loadingStep,
  error, sector, onSectorChange, criteria, onCriteriaChange,
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
    <div style={{ minHeight: "100vh", background: OFFWHITE, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
      <style>{GLOBAL_STYLE}</style>

      <div style={{ width: "100%", maxWidth: 540 }}>
        {/* Wordmark */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            display: "inline-block", background: RED, color: "#fff",
            fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 22,
            padding: "11px 32px", borderRadius: 4, letterSpacing: "3px", marginBottom: 20,
          }}>
            SAGARD
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, fontWeight: 700, color: NAVY, margin: "0 0 8px", letterSpacing: "-0.5px" }}>
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
function PDFViewer({ file, claims, activePage }: { file: File; claims: Claim[]; activePage: number | null }) {
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [jumpPage, setJumpPage] = useState(1);
  const [jumpInput, setJumpInput] = useState("1");
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(400);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width - 16));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const jumpToPage = (page: number) => {
    const p = Math.max(1, Math.min(numPages || 1, page));
    setJumpPage(p); setJumpInput(String(p));
    setTimeout(() => { pageRefs.current[p]?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50);
  };

  const prevActivePage = useRef<number | null>(null);
  if (activePage !== null && activePage !== prevActivePage.current) {
    prevActivePage.current = activePage;
    setTimeout(() => { pageRefs.current[activePage]?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 100);
  }

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
          <button style={btnStyle} onClick={() => jumpToPage(jumpPage - 1)}>‹</button>
          <input type="number" value={jumpInput}
            onChange={e => setJumpInput(e.target.value)}
            onBlur={() => jumpToPage(parseInt(jumpInput) || 1)}
            onKeyDown={e => { if (e.key === "Enter") jumpToPage(parseInt(jumpInput) || 1); }}
            style={{ width: 36, textAlign: "center", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 4, color: "#fff", fontSize: 12, padding: "2px 4px" }}
          />
          <span style={{ color: "#888", fontSize: 11 }}>/ {numPages}</span>
          <button style={btnStyle} onClick={() => jumpToPage(jumpPage + 1)}>›</button>
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
              <div key={pageNum} ref={el => { pageRefs.current[pageNum] = el; }}
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
    font-family: Arial, sans-serif; max-width: 760px; margin: 0 auto; padding: 40px; color: #1a1a1a;
  }
  #ic-brief-print .hdr h1 { font-family: Georgia, serif; font-size: 20px; font-weight: 700; margin: 0 0 4px; }
  #ic-brief-print .hdr .meta { font-size: 11px; color: #666; }
  #ic-brief-print hr { border: none; border-top: 1px solid #ccc; margin: 16px 0; }
  #ic-brief-print .s { margin-bottom: 20px; }
  #ic-brief-print .sl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 8px; color: #333; }
  #ic-brief-print p { font-size: 11px; line-height: 1.6; margin: 0 0 5px; }
  #ic-brief-print ol { margin: 0; padding-left: 20px; }
  #ic-brief-print li { font-size: 11px; line-height: 1.6; margin-bottom: 4px; }
  #ic-brief-print .verdict { font-family: Georgia, serif; font-size: 18px; font-weight: 700; margin: 0 0 6px; }
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

// ── Results ──────────────────────────────────────────────────
type ClaimFilter = "all" | "disputed" | "unverifiable" | "verified";

function Results({ data, primaryFile, onReset, documentText }: { data: AnalysisResult; primaryFile: File; onReset: () => void; documentText: string }) {
  const { assessment, claims, cross_document_conflicts } = data;
  const [activeClaim, setActiveClaim] = useState<number | null>(null);
  const [claimFilter, setClaimFilter] = useState<ClaimFilter>("all");
  const overallCfg = overallConfig[assessment.overall_verdict] ?? overallConfig["Pass"];
  const stats = assessment.summary_stats ?? { verified: 0, disputed: 0, unverifiable: 0 };
  const conflicts = cross_document_conflicts ?? [];
  const activePage = activeClaim !== null ? (claims[activeClaim]?.page ?? null) : null;

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
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
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const formData = new FormData();
      formData.append('message', userMsg);
      formData.append('document_text', documentText);
      formData.append('history', JSON.stringify(historySnapshot));
      const { data: resp } = await axios.post<{ response: string }>(`${BACKEND_URL}/chat`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setChatMessages(prev => [...prev, { role: 'assistant', content: resp.response }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
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
    div.innerHTML = buildICBrief(assessment, claims, conflicts, primaryFile.name);
    document.body.appendChild(div);
    window.print();
    document.body.removeChild(div);
  };

  const filteredClaims = claims.filter(c =>
    claimFilter === "all" ? true : claimFilter === "unverifiable" ? c.verdict === "unverifiable" : c.verdict === claimFilter
  );

  const tabStyle = (tab: ClaimFilter): React.CSSProperties => ({
    padding: "4px 11px", fontSize: 11, fontWeight: 600, borderRadius: 20, border: "1px solid",
    cursor: "pointer", transition: "all 0.15s", fontFamily: "'Inter', sans-serif",
    background: claimFilter === tab ? RED : "#fff",
    color: claimFilter === tab ? "#fff" : "#6b7280",
    borderColor: claimFilter === tab ? RED : "#e5e7eb",
  });

  const navBtnStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)",
    borderRadius: 6, padding: "5px 13px", fontSize: 12, color: "#fff",
    cursor: "pointer", fontFamily: "'Inter', sans-serif", fontWeight: 500,
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <style>{GLOBAL_STYLE}</style>

      {/* Nav bar */}
      <div style={{ height: 50, background: RED, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ color: "#fff", fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 20, letterSpacing: "3px" }}>SAGARD</span>
          <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, fontFamily: "'Inter', sans-serif", fontWeight: 400 }}>CIM Analyzer</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontFamily: "'Inter', sans-serif" }}>
            Analyzed in ~60s · Est. manual review: 2–3 hrs
          </span>
          <button onClick={exportICBrief} style={{ ...navBtnStyle, background: "#fff", color: RED, border: "1px solid rgba(255,255,255,0.4)" }}>
            Export IC Brief ↓
          </button>
          <button onClick={onReset} style={navBtnStyle}>← New CIM</button>
        </div>
      </div>

      {/* Main split */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left: PDF */}
        <div style={{ width: "50%", borderRight: "1px solid #e5e7eb", overflow: "hidden" }}>
          <PDFViewer file={primaryFile} claims={claims} activePage={activePage} />
        </div>

        {/* Right: Analysis */}
        <div style={{ width: "50%", overflowY: "auto", background: "#fff" }}>

          {/* ── Verdict Banner (sticky) ── */}
          <div style={{ position: "sticky", top: 0, zIndex: 20, background: overallCfg.bg, borderBottom: `1px solid ${overallCfg.color}25`, padding: "14px 20px" }}>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: "0 0 2px", ...sectionLabel }}>First-Pass Verdict</p>
                <h2 style={{ margin: "0 0 5px", fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 700, color: overallCfg.color, lineHeight: 1.1 }}>
                  {assessment.overall_verdict}
                </h2>
                <p style={{ margin: 0, fontSize: 12, color: "#374151", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } as React.CSSProperties}>
                  {assessment.reasoning}
                </p>
                {assessment.criteria_fit && (
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 20, background: assessment.criteria_fit.fits ? "#f0f7f0" : "#fdf2f2", color: assessment.criteria_fit.fits ? "#166534" : "#991b1b", border: `1px solid ${assessment.criteria_fit.fits ? "#bbf7d0" : "#fecaca"}` }}>
                      {assessment.criteria_fit.fits ? "✓ Fits criteria" : "✗ Outside criteria"}
                    </span>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>{assessment.criteria_fit.explanation}</span>
                  </div>
                )}
              </div>
              <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                <div style={{ display: "flex", gap: 14 }}>
                  {[
                    { label: "Verified",  count: stats.verified,     color: "#166534" },
                    { label: "Disputed",  count: stats.disputed,     color: "#92400e" },
                    { label: "Ask Mgmt", count: stats.unverifiable, color: "#991b1b" },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1, fontFamily: "'Inter', sans-serif" }}>{s.count}</div>
                      <div style={{ fontSize: 9, color: "#6b7280", fontWeight: 600, marginTop: 2, fontFamily: "'Inter', sans-serif" }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {[
                    { text: `📋 ${stats.unverifiable} questions`, bg: "#fdf2f2", color: "#991b1b", border: "#fecaca" },
                    { text: `🔍 ${stats.disputed} disputed`,       bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
                    { text: `⚠ ${claims.filter(c => c.materiality === "high" && c.verdict === "disputed").length} high-impact`, bg: "#fdf5f5", color: RED, border: "#e8b4b4" },
                  ].map(p => (
                    <span key={p.text} style={{ fontSize: 10, background: p.bg, color: p.color, border: `1px solid ${p.border}`, borderRadius: 20, padding: "2px 7px", fontWeight: 600, fontFamily: "'Inter', sans-serif" }}>{p.text}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Section 2: Company & Narrative ── */}
          <CollapsibleSection title="Company & Narrative" defaultOpen={true}>
            <div style={{ padding: "4px 20px 14px" }}>
              {assessment.company_snapshot && (
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "#6b7280", lineHeight: 1.6, fontStyle: "italic" }}>{assessment.company_snapshot}</p>
              )}
              {assessment.sellers_narrative && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: OFFWHITE, border: "1px solid #ede9e4", borderRadius: 6, padding: "8px 12px" }}>
                  <span style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, flexShrink: 0, paddingTop: 2, textTransform: "uppercase", letterSpacing: "0.5px" }}>Narrative</span>
                  <span style={{ fontSize: 12, color: "#374151", flex: 1, lineHeight: 1.5 }}>{assessment.sellers_narrative}</span>
                  {assessment.narrative_holds_up && (
                    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, paddingTop: 1, color: assessment.narrative_holds_up.holds ? "#166534" : "#991b1b" }}>
                      {assessment.narrative_holds_up.holds ? "✓ Holds up" : "✗ Doesn't hold"}
                    </span>
                  )}
                </div>
              )}
              {assessment.narrative_holds_up?.explanation && (
                <p style={{ margin: "7px 0 0", fontSize: 11, color: "#6b7280", fontStyle: "italic" }}>{assessment.narrative_holds_up.explanation}</p>
              )}
            </div>
          </CollapsibleSection>

          {/* ── Section 3: Key Questions, Risks, Bull Case ── */}
          <CollapsibleSection title="Must Answer Before Proceeding" defaultOpen={true} count={assessment.key_questions?.length}>
            <div style={{ padding: "4px 20px 14px" }}>
              {assessment.key_questions?.map((q, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: RED, flexShrink: 0, paddingTop: 1, fontFamily: "'Inter', sans-serif" }}>{i + 1}.</span>
                  <p style={{ margin: 0, fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{q}</p>
                </div>
              ))}
              {assessment.top_risks?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {assessment.top_risks.map((risk, i) => (
                    <div key={i} style={{ display: "flex", gap: 7, marginBottom: 5, alignItems: "flex-start" }}>
                      <span style={{ color: "#991b1b", fontWeight: 700, flexShrink: 0, fontSize: 11, paddingTop: 1 }}>⚠</span>
                      <p style={{ margin: 0, fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{risk}</p>
                    </div>
                  ))}
                </div>
              )}
              {assessment.bull_case && (
                <div style={{ marginTop: 10, background: "#f0f7f0", border: "1px solid #bbf7d0", borderRadius: 6, padding: "7px 12px" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#166534" }}>📈 Bull case: </span>
                  <span style={{ fontSize: 12, color: "#374151" }}>{assessment.bull_case}</span>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* ── Section 4: Cross-Document Conflicts ── */}
          {conflicts.length > 0 && (
            <CollapsibleSection title="Cross-Document Conflicts" defaultOpen={true} count={conflicts.length}>
              <div style={{ padding: "4px 20px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                {conflicts.map((c, i) => {
                  const sev = severityConfig[c.severity] ?? severityConfig.low;
                  return (
                    <div key={i} style={{ borderLeft: `3px solid ${sev.color}`, border: `1px solid ${sev.border}`, borderRadius: 6 }}>
                      <div style={{ padding: "8px 12px", background: sev.bg }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ fontSize: 10, color: "#6b7280", fontWeight: 600 }}>{c.doc1} vs {c.doc2}</span>
                          <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: sev.color, background: "#fff", border: `1px solid ${sev.border}`, borderRadius: 20, padding: "1px 7px" }}>{sev.label}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
                          {[{ label: c.doc1, text: c.claim1 }, { label: c.doc2, text: c.claim2 }].map((side, j) => (
                            <div key={j} style={{ background: "#fff", borderRadius: 4, padding: "6px 8px", border: "1px solid #e5e7eb" }}>
                              <p style={{ margin: "0 0 2px", fontSize: 9, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{side.label}</p>
                              <p style={{ margin: 0, fontSize: 11, color: "#374151", lineHeight: 1.4 }}>{side.text}</p>
                            </div>
                          ))}
                        </div>
                        <p style={{ margin: 0, fontSize: 11, color: sev.color, fontWeight: 500 }}>{c.explanation}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          )}

          {/* ── Section 5: Diligence Checklist (collapsed by default) ── */}
          <CollapsibleSection
            title="Diligence Checklist"
            defaultOpen={false}
            count={`${claims.filter(c => c.diligence_question).length} questions`}
            action={
              <button onClick={copyDiligenceQuestions} style={{ background: RED, color: "#fff", border: "none", borderRadius: 4, padding: "3px 9px", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>
                Copy all
              </button>
            }
          >
            <div style={{ padding: "4px 20px 14px" }}>
              {claims.filter(c => c.diligence_question).map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: "50%", background: RED, color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                    {i + 1}
                  </span>
                  <p style={{ margin: 0, fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{c.diligence_question}</p>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* ── Section 6: Evidence & Verification ── */}
          <div>
            <div style={{ padding: "11px 20px 0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={sectionLabel}>Evidence &amp; Verification</span>
                <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "'Inter', sans-serif" }}>{claims.length} claims checked</span>
              </div>
              <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
                {(["all", "disputed", "unverifiable", "verified"] as ClaimFilter[]).map(tab => (
                  <button key={tab} onClick={() => setClaimFilter(tab)} style={tabStyle(tab)}>
                    {tab === "unverifiable" ? "Ask Mgmt" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {tab !== "all" && (
                      <span style={{ marginLeft: 4, opacity: 0.7 }}>({claims.filter(c => c.verdict === tab).length})</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ padding: "0 20px 20px" }}>
              {filteredClaims.length === 0 ? (
                <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "16px 0" }}>No claims in this category.</p>
              ) : (
                filteredClaims.map(claim => {
                  const idx = claims.indexOf(claim);
                  return (
                    <ClaimCard key={claim.id ?? idx} claim={claim} index={idx} isActive={activeClaim === idx}
                      onClick={() => setActiveClaim(activeClaim === idx ? null : idx)} />
                  );
                })
              )}
            </div>
          </div>

          {/* ── Section 7: Chat with this Deal ── */}
          <div style={{ borderTop: "2px solid #f0ede8" }}>
            <div style={{ padding: "11px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={sectionLabel}>Ask This Deal</span>
              {chatMessages.length > 0 && (
                <button
                  onClick={() => setChatMessages([])}
                  style={{ background: "none", border: "none", fontSize: 10, color: "#9ca3af", cursor: "pointer", fontFamily: "'Inter', sans-serif" }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Starter question pills */}
            <div style={{ padding: "8px 20px 0", display: "flex", gap: 6, flexWrap: "wrap" as const }}>
              {[
                "What is the EBITDA and revenue trend?",
                "What are the biggest risk factors?",
                "Who are the key customers and what's the concentration?",
              ].map(q => (
                <button
                  key={q}
                  onClick={() => { setChatInput(q); chatInputRef.current?.focus(); }}
                  style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 20, padding: "4px 12px", fontSize: 12, cursor: "pointer", fontFamily: "'Inter', sans-serif", color: NAVY }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#e5e7eb")}
                  onMouseLeave={e => (e.currentTarget.style.background = "#f3f4f6")}
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Message history */}
            {chatMessages.length > 0 && (
              <div style={{ margin: "10px 20px 0", maxHeight: 400, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "2px 0" }}>
                {chatMessages.map((msg, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                    <div style={msg.role === "user" ? {
                      background: RED, color: "#fff", borderRadius: "12px 12px 2px 12px",
                      padding: "8px 12px", maxWidth: "80%", fontSize: 13, fontFamily: "'Inter', sans-serif", lineHeight: 1.5,
                    } : {
                      background: "#f3f4f6", color: NAVY, borderRadius: "12px 12px 12px 2px",
                      padding: "8px 12px", maxWidth: "85%", fontSize: 13, fontFamily: "'Inter', sans-serif",
                      whiteSpace: "pre-wrap" as const, lineHeight: 1.6,
                    }}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ display: "flex", justifyContent: "flex-start" }}>
                    <div style={{ background: "#f3f4f6", borderRadius: "12px 12px 12px 2px", padding: "10px 14px", display: "flex", gap: 4, alignItems: "center" }}>
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#9ca3af", animation: `typing-dot 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Input row */}
            <div style={{ margin: "10px 20px 20px", display: "flex", gap: 8 }}>
              <input
                ref={chatInputRef}
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") sendChatMessage(); }}
                placeholder="Ask anything about this deal..."
                style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "'Inter', sans-serif", outline: "none", color: NAVY }}
                disabled={chatLoading}
              />
              <button
                onClick={sendChatMessage}
                disabled={chatLoading || !chatInput.trim()}
                style={{
                  background: RED, color: "#fff", border: "none", borderRadius: 8,
                  padding: "8px 16px", fontSize: 13, fontWeight: 600, fontFamily: "'Inter', sans-serif",
                  cursor: chatLoading || !chatInput.trim() ? "not-allowed" : "pointer",
                  opacity: chatLoading || !chatInput.trim() ? 0.55 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                Send
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────
export default function App() {
  const [loading, setLoading]             = useState(false);
  const [loadingStep, setLoadingStep]     = useState(0);
  const [results, setResults]             = useState<AnalysisResult | null>(null);
  const [stagedFiles, setStagedFiles]     = useState<File[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [error, setError]                 = useState<string | null>(null);
  const [sector, setSector]               = useState("Private Equity");
  const [criteria, setCriteria]           = useState<InvestmentCriteria>({ minEbitda: "", dealSizeRange: "", targetSectors: "", geography: "" });
  const [documentText, setDocumentText]   = useState('');

  const handleAddFiles = useCallback((incoming: File[]) => {
    setStagedFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      return [...prev, ...incoming.filter(f => !existing.has(f.name))];
    });
  }, []);

  const handleRemoveFile = useCallback((i: number) => {
    setStagedFiles(prev => prev.filter((_, j) => j !== i));
  }, []);

  const handleAnalyze = async () => {
    if (!stagedFiles.length) return;
    setLoading(true); setError(null); setResults(null);
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
      const { data } = await axios.post<AnalysisResult>(`${BACKEND_URL}/analyze`, formData, {
        headers: { "Content-Type": "multipart/form-data" }, timeout: 300000,
      });
      setResults(data);
      setDocumentText(data.document_text ?? '');
    } catch (err) {
      setError("Something went wrong. Make sure the backend is running on port 8000 and try again.");
      console.error(err);
    } finally {
      clearInterval(stepInterval); setLoading(false);
    }
  };

  if (results && uploadedFiles.length > 0) {
    return (
      <Results
        data={results}
        primaryFile={uploadedFiles[0]}
        onReset={() => { setResults(null); setStagedFiles([]); setUploadedFiles([]); setDocumentText(''); }}
        documentText={documentText}
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
    />
  );
}
