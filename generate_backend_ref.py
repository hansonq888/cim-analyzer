"""
CIM Analyzer — Backend Functions Reference PDF
Run: python generate_backend_ref.py
Output: CIM_Backend_Reference.pdf
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether
)
from reportlab.platypus.flowables import Flowable
from reportlab.lib import colors
import datetime

RED     = HexColor("#913d3e")
NAVY    = HexColor("#1a1a1a")
DARK    = HexColor("#2c2c2c")
LIGHT   = HexColor("#f8f6f3")
GRAY    = HexColor("#6b7280")
LGRAY   = HexColor("#e5e7eb")
XGRAY   = HexColor("#f3f4f6")
GREEN   = HexColor("#166534")
AMBER   = HexColor("#92400e")
BGGRN   = HexColor("#f0fdf4")
BGAMB   = HexColor("#fffbeb")
BGRED   = HexColor("#fdf2f2")
CODE_BG = HexColor("#1e1e2e")
CODE_FG = HexColor("#cdd6f4")
ACCENT  = HexColor("#d4a0a0")
TEAL    = HexColor("#0d6b7a")
PURPLE  = HexColor("#6d28d9")
BGPUR   = HexColor("#f5f3ff")


def build_styles():
    s = {}
    s['cover_title'] = ParagraphStyle('cover_title', fontName='Helvetica-Bold', fontSize=30,
        textColor=white, leading=38, alignment=TA_CENTER, spaceAfter=8)
    s['cover_sub'] = ParagraphStyle('cover_sub', fontName='Helvetica', fontSize=13,
        textColor=ACCENT, leading=20, alignment=TA_CENTER, spaceAfter=6)
    s['cover_meta'] = ParagraphStyle('cover_meta', fontName='Helvetica', fontSize=10,
        textColor=HexColor("#cccccc"), alignment=TA_CENTER, leading=16)
    s['h1'] = ParagraphStyle('h1', fontName='Helvetica-Bold', fontSize=16,
        textColor=white, leading=22)
    s['h2'] = ParagraphStyle('h2', fontName='Helvetica-Bold', fontSize=12,
        textColor=RED, leading=18, spaceBefore=16, spaceAfter=5)
    s['h3'] = ParagraphStyle('h3', fontName='Helvetica-Bold', fontSize=10,
        textColor=NAVY, leading=15, spaceBefore=10, spaceAfter=3)
    s['body'] = ParagraphStyle('body', fontName='Helvetica', fontSize=9,
        textColor=DARK, leading=14, spaceBefore=2, spaceAfter=2, alignment=TA_JUSTIFY)
    s['body_left'] = ParagraphStyle('body_left', fontName='Helvetica', fontSize=9,
        textColor=DARK, leading=14, spaceBefore=2, spaceAfter=2)
    s['bullet'] = ParagraphStyle('bullet', fontName='Helvetica', fontSize=9,
        textColor=DARK, leading=14, spaceBefore=2, spaceAfter=2, leftIndent=14, firstLineIndent=-10)
    s['mono'] = ParagraphStyle('mono', fontName='Courier', fontSize=8,
        textColor=CODE_FG, leading=12, spaceBefore=1, spaceAfter=1, leftIndent=8)
    s['func_name'] = ParagraphStyle('func_name', fontName='Courier-Bold', fontSize=9.5,
        textColor=HexColor("#89dceb"), leading=14)
    s['label_io'] = ParagraphStyle('label_io', fontName='Helvetica-Bold', fontSize=8,
        textColor=GRAY, leading=12)
    s['io_val'] = ParagraphStyle('io_val', fontName='Courier', fontSize=8,
        textColor=DARK, leading=12, leftIndent=8)
    s['note'] = ParagraphStyle('note', fontName='Helvetica-Oblique', fontSize=8.5,
        textColor=HexColor("#1e3a5f"), leading=13, leftIndent=8)
    s['tag'] = ParagraphStyle('tag', fontName='Helvetica-Bold', fontSize=7.5,
        textColor=white, leading=11, alignment=TA_CENTER)
    return s


class SectionHeader(Flowable):
    def __init__(self, number, title, width=7.5*inch):
        super().__init__()
        self.number = number
        self.title = title
        self.width = width
        self.height = 34

    def draw(self):
        c = self.canv
        c.setFillColor(NAVY)
        c.rect(0, 0, self.width, self.height, fill=1, stroke=0)
        c.setFillColor(RED)
        c.rect(0, 0, 5, self.height, fill=1, stroke=0)
        c.setFillColor(white)
        c.setFont('Helvetica-Bold', 11)
        label = f"{self.number}  {self.title.upper()}" if self.number else self.title.upper()
        c.drawString(16, 11, label)

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        return availWidth, self.height


class CodeBlock(Flowable):
    def __init__(self, lines, width=7.5*inch):
        super().__init__()
        self.lines = lines if isinstance(lines, list) else lines.split('\n')
        self.width = width
        self.padding = 9
        self.line_height = 12

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        h = len(self.lines) * self.line_height + self.padding * 2
        return availWidth, max(h, 1)

    def draw(self):
        c = self.canv
        h = max(len(self.lines) * self.line_height + self.padding * 2, 1)
        c.setFillColor(CODE_BG)
        c.roundRect(0, 0, self.width, h, 4, fill=1, stroke=0)
        c.setFont('Courier', 7.5)
        y = h - self.padding - self.line_height + 2
        for line in self.lines:
            if line.strip().startswith('#'):
                c.setFillColor(HexColor("#6c7086"))
            elif any(kw in line for kw in ['def ', 'async ', 'class ', 'return ', 'import ', 'from ']):
                c.setFillColor(HexColor("#cba6f7"))
            elif '──' in line or '│' in line or '▼' in line or '┌' in line or '└' in line or '├' in line:
                c.setFillColor(HexColor("#94e2d5"))
            else:
                c.setFillColor(CODE_FG)
            c.drawString(self.padding, y, line[:115])
            y -= self.line_height


class FuncCard(Flowable):
    """A card for a single backend function."""
    def __init__(self, func_sig, tag, tag_color, description, inputs, outputs, notes, width=7.5*inch):
        super().__init__()
        self.func_sig = func_sig
        self.tag = tag
        self.tag_color = HexColor(tag_color)
        self.description = description
        self.inputs = inputs    # list of (name, desc)
        self.outputs = outputs  # list of (name, desc)
        self.notes = notes      # list of strings
        self.width = width
        self._h = None

    def _est_height(self):
        base = 26 + 14 + 8  # sig + desc + padding
        base += len(self.inputs) * 13
        base += len(self.outputs) * 13
        base += len(self.notes) * 13
        base += 40  # headers
        return base + 20

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        self._h = self._est_height()
        return availWidth, self._h

    def draw(self):
        c = self.canv
        h = self._h
        pad = 10
        # Card bg
        c.setFillColor(HexColor("#f8f9fa"))
        c.roundRect(0, 0, self.width, h, 4, fill=1, stroke=0)
        c.setStrokeColor(LGRAY)
        c.setLineWidth(0.5)
        c.roundRect(0, 0, self.width, h, 4, fill=0, stroke=1)
        # Left accent bar
        c.setFillColor(self.tag_color)
        c.rect(0, 0, 4, h, fill=1, stroke=0)
        # Tag pill
        tag_w = c.stringWidth(self.tag, 'Helvetica-Bold', 7) + 12
        c.setFillColor(self.tag_color)
        c.roundRect(self.width - tag_w - pad, h - 20, tag_w, 14, 3, fill=1, stroke=0)
        c.setFillColor(white)
        c.setFont('Helvetica-Bold', 7)
        c.drawCentredString(self.width - pad - tag_w/2, h - 13, self.tag)
        # Function signature
        c.setFillColor(HexColor("#89dceb"))
        c.setFont('Courier-Bold', 8.5)
        c.drawString(pad + 4, h - 18, self.func_sig)
        # Description
        c.setFillColor(DARK)
        c.setFont('Helvetica', 8)
        c.drawString(pad + 4, h - 32, self.description)

        y = h - 50
        # Inputs
        if self.inputs:
            c.setFillColor(GRAY)
            c.setFont('Helvetica-Bold', 7.5)
            c.drawString(pad + 4, y, "INPUTS")
            y -= 13
            for name, desc in self.inputs:
                c.setFillColor(HexColor("#4b5563"))
                c.setFont('Courier', 7.5)
                c.drawString(pad + 12, y, f"{name}")
                c.setFillColor(DARK)
                c.setFont('Helvetica', 7.5)
                avail = self.width - pad - 12 - c.stringWidth(name, 'Courier', 7.5) - 8
                c.drawString(pad + 12 + c.stringWidth(name, 'Courier', 7.5) + 4, y, f"— {desc}"[:int(avail/4.5)])
                y -= 12

        # Outputs
        if self.outputs:
            c.setFillColor(GRAY)
            c.setFont('Helvetica-Bold', 7.5)
            c.drawString(pad + 4, y, "RETURNS")
            y -= 13
            for name, desc in self.outputs:
                c.setFillColor(GREEN)
                c.setFont('Courier', 7.5)
                c.drawString(pad + 12, y, f"{name}")
                c.setFillColor(DARK)
                c.setFont('Helvetica', 7.5)
                c.drawString(pad + 12 + c.stringWidth(name, 'Courier', 7.5) + 4, y, f"— {desc}"[:80])
                y -= 12

        # Notes
        if self.notes:
            c.setFillColor(GRAY)
            c.setFont('Helvetica-Bold', 7.5)
            c.drawString(pad + 4, y, "NOTES")
            y -= 13
            for note in self.notes:
                c.setFillColor(HexColor("#374151"))
                c.setFont('Helvetica-Oblique', 7.5)
                c.drawString(pad + 12, y, f"• {note}"[:110])
                y -= 12


def header_footer(canvas, doc):
    canvas.saveState()
    w, h = letter
    canvas.setStrokeColor(LGRAY)
    canvas.setLineWidth(0.5)
    canvas.line(0.5*inch, h - 0.45*inch, w - 0.5*inch, h - 0.45*inch)
    canvas.setFont('Helvetica-Bold', 7)
    canvas.setFillColor(RED)
    canvas.drawString(0.5*inch, h - 0.38*inch, "CIM ANALYZER — BACKEND REFERENCE")
    canvas.setFont('Helvetica', 7)
    canvas.setFillColor(GRAY)
    canvas.drawRightString(w - 0.5*inch, h - 0.38*inch, "main.py  ·  FastAPI + Anthropic + Tavily")
    canvas.line(0.5*inch, 0.45*inch, w - 0.5*inch, 0.45*inch)
    canvas.setFont('Helvetica', 7)
    canvas.setFillColor(GRAY)
    canvas.drawCentredString(w / 2, 0.3*inch, f"Page {doc.page}")
    canvas.restoreState()


def cover_page(canvas, doc):
    canvas.saveState()
    w, h = letter
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    canvas.setFillColor(RED)
    canvas.rect(0, h - 5, w, 5, fill=1, stroke=0)
    canvas.rect(0, 0, w, 4, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#2c1516"))
    canvas.rect(0, 0, 14, h, fill=1, stroke=0)
    canvas.setFillColor(RED)
    canvas.rect(0, 0, 5, h, fill=1, stroke=0)
    canvas.restoreState()


def sp(n=1):
    return Spacer(1, n * 5)

def rule():
    return HRFlowable(width="100%", thickness=0.5, color=LGRAY, spaceAfter=5, spaceBefore=5)

def h2(text, s):
    return Paragraph(text, s['h2'])

def h3(text, s):
    return Paragraph(text, s['h3'])

def body(text, s):
    return Paragraph(text, s['body'])

def bullet(text, s):
    return Paragraph(f"•  {text}", s['bullet'])

def make_table(data, col_widths):
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND',   (0,0), (-1,0), NAVY),
        ('TEXTCOLOR',    (0,0), (-1,0), white),
        ('FONTNAME',     (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE',     (0,0), (-1,-1), 8),
        ('FONTNAME',     (0,1), (-1,-1), 'Helvetica'),
        ('ROWBACKGROUNDS',(0,1),(-1,-1), [white, XGRAY]),
        ('GRID',         (0,0), (-1,-1), 0.3, LGRAY),
        ('VALIGN',       (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING',   (0,0), (-1,-1), 5),
        ('BOTTOMPADDING',(0,0), (-1,-1), 5),
        ('LEFTPADDING',  (0,0), (-1,-1), 7),
        ('WORDWRAP',     (0,0), (-1,-1), True),
    ]))
    return t


def build_pdf():
    s = build_styles()
    story = []

    # ── COVER ──────────────────────────────────────────────────
    story.append(Spacer(1, 2.0*inch))
    story.append(Paragraph("BACKEND FUNCTIONS", s['cover_title']))
    story.append(Spacer(1, 0.08*inch))
    story.append(Paragraph("REFERENCE CHEATSHEET", s['cover_title']))
    story.append(Spacer(1, 0.2*inch))
    story.append(Paragraph("CIM Analyzer  ·  main.py Deep Dive", s['cover_sub']))
    story.append(Spacer(1, 0.3*inch))
    story.append(HRFlowable(width=2.5*inch, thickness=1, color=RED,
                             spaceAfter=18, spaceBefore=0, hAlign='CENTER'))
    story.append(Paragraph("Every function  ·  Every endpoint  ·  Full pipeline flow", s['cover_meta']))
    story.append(Spacer(1, 0.08*inch))
    story.append(Paragraph(f"Generated {datetime.date.today().strftime('%B %d, %Y')}", s['cover_meta']))
    story.append(PageBreak())

    # ── SECTION 1: FULL PIPELINE FLOW ─────────────────────────
    story.append(SectionHeader("1", "End-to-End Pipeline Flow"))
    story.append(sp(2))

    story.append(h2("POST /analyze — Full Execution Order", s))
    flow1 = [
        "  USER UPLOADS: files[], sector, min_ebitda, deal_size, target_sectors, geography",
        "      │ multipart/form-data (axios POST)",
        "      ▼",
        "  STEP 1 — Document Extraction  [sequential]",
        "  extract_all_documents_text(files_bytes)",
        "    ├── PDF  → extract_pdf_text()   (pdfplumber, PAGE X OF Y markers)",
        "    └── XLSX → extract_excel_text() (openpyxl data_only=True, sheet sections)",
        "      │ dict {filename: extracted_text}",
        "      ▼",
        "  STEP 2 — Claim Extraction  [1 Claude call, sequential]",
        "  extract_claims(primary_text[:15000], sector, criteria_context)",
        "  → 6 high-impact verifiable claims as JSON list",
        "      │ list[dict] — raw claims",
        "      ▼",
        "  STEP 3 — Concurrent Claim Verification  [PARALLEL × 6 threads]",
        "  ThreadPoolExecutor(max_workers=6) + asyncio.gather()",
        "  For each claim simultaneously:",
        "    1. search_claim()   → POST api.tavily.com/search (3 results, 300 chars each)",
        "    2. analyze_claim()  → Claude verdict / confidence / diligence_question",
        "    3. merge:  {**claim, **analysis}  — returned when ALL 6 complete",
        "      │ list[dict] — analyzed_claims (verdict, explanation, sources, confidence)",
    ]
    story.append(CodeBlock(flow1))
    story.append(sp(1))

    flow2 = [
        "  STEP 4 + 5 — Run in PARALLEL (ThreadPoolExecutor × 2)",
        "",
        "  STEP 4: get_overall_assessment(analyzed_claims, sector)   [1 Claude call]",
        "    → overall_verdict, company_snapshot, reasoning, top_risks[], bull_case, key_questions[]",
        "",
        "  STEP 5: extract_financial_charts_data(primary_text)       [1 Claude call]",
        "    → margin_trend {years, revenue_growth[], ebitda_margin[], revenue_absolute[]}",
        "    → deal_scorecard {dimensions[{name, score, reasoning}], overall_score}",
        "      │",
        "      ▼",
        "  STEP 6 — Cross-Document Conflicts  [only if len(files) > 1]",
        "  find_cross_document_conflicts(documents, sector)  [1 Claude call]",
        "  → [{doc1, doc2, claim1, claim2, severity, explanation, page1, page2}]",
        "      │",
        "      ▼",
        "  RESPONSE → {assessment, claims[], cross_document_conflicts[], document_text,",
        "              charts_data, documents_text}",
        "      │  Frontend immediately fires POST /comps (non-blocking):",
        "      ▼",
        "  POST /comps  [async, separate request]",
        "    extract_deal_profile()  [Claude]  → deal profile + 4 search queries",
        "    run_comps_searches()    [Tavily]  → 4×5 search results",
        "    extract_comps_from_search() [Claude] → structured comps + valuation context",
    ]
    story.append(CodeBlock(flow2))
    story.append(sp(2))

    story.append(h2("Timing Profile (typical CIM, 1 PDF)", s))
    timing_data = [
        ["Step", "Typical Duration", "Bottleneck?"],
        ["PDF extraction (pdfplumber)", "1–3s", "No"],
        ["Claim extraction (1 Claude call)", "3–6s", "Minor"],
        ["Claim verification (6× parallel: Tavily + Claude)", "8–15s", "YES — main bottleneck"],
        ["Assessment + charts (parallel Claude calls)", "4–8s", "Minor"],
        ["Cross-doc conflict (multi-file only)", "5–10s", "Conditional"],
        ["COMPS (async, non-blocking)", "30–60s", "Hidden (async)"],
        ["Total /analyze response time", "15–30s typical", ""],
    ]
    story.append(make_table(timing_data, [2.8*inch, 1.6*inch, 3.1*inch]))

    story.append(PageBreak())

    # ── SECTION 2: ALL FUNCTIONS ───────────────────────────────
    story.append(SectionHeader("2", "Every Function in main.py"))
    story.append(sp(2))

    story.append(h2("Utility / Helper Functions", s))
    story.append(sp(1))

    # build_criteria_context
    story.append(KeepTogether([
        FuncCard(
            func_sig="build_criteria_context(min_ebitda, deal_size_range, target_sectors, geography, sector) -> str",
            tag="UTILITY",
            tag_color="#6b7280",
            description="Formats investor criteria fields into a block of text injected into Claude prompts.",
            inputs=[
                ("min_ebitda", "str — e.g. '$5M+'"),
                ("deal_size_range", "str — e.g. '$50M-$200M'"),
                ("target_sectors", "str — e.g. 'Healthcare, SaaS'"),
                ("geography", "str — e.g. 'North America'"),
            ],
            outputs=[
                ("str", "Formatted 'INVESTOR CRITERIA:\\n- ...' block, or empty string if all fields empty"),
            ],
            notes=[
                "Capped at 500 chars when injected into prompts to avoid context bloat",
                "Empty string returned (not None) so callers can safely use `if criteria_context:`",
            ]
        ),
        sp(2),
    ]))

    # clean_page_text
    story.append(KeepTogether([
        FuncCard(
            func_sig="clean_page_text(text: str) -> str",
            tag="UTILITY",
            tag_color="#6b7280",
            description="Strips printed footer page numbers from PDF pages so Claude never misattributes citations.",
            inputs=[("text", "str — raw text from one PDF page")],
            outputs=[("str", "Cleaned text with footer numbers removed")],
            notes=[
                "3 regex passes: 'Bear Stearns CONFIDENTIAL 19', standalone 'CONFIDENTIAL 19', trailing lone integer",
                "Order matters: most-specific regex runs first to avoid over-stripping",
                "This is why Claude cites [[Page 27]] not 'CONFIDENTIAL 19' from footer text",
            ]
        ),
        sp(2),
    ]))

    # extract_pdf_text
    story.append(KeepTogether([
        FuncCard(
            func_sig="extract_pdf_text(file_bytes: bytes) -> str",
            tag="EXTRACTION",
            tag_color="#0d6b7a",
            description="Extracts full text from a PDF using pdfplumber. Inserts PAGE X OF Y markers and table data.",
            inputs=[("file_bytes", "bytes — raw PDF binary")],
            outputs=[("str", "Full document text with PAGE markers, table rows, and extraction note prepended")],
            notes=[
                "Each page: extract_text() + extract_tables() — tables rendered as pipe-delimited rows",
                "Blank pages get placeholder '[No extractable text]' so page numbers stay in sync",
                "PAGE markers use 1-based numbering matching the PDF viewer exactly",
                "Prepends 'DOCUMENT EXTRACTION NOTE' telling Claude to trust PAGE X OF Y only",
            ]
        ),
        sp(2),
    ]))

    # extract_excel_text
    story.append(KeepTogether([
        FuncCard(
            func_sig="extract_excel_text(file_bytes: bytes) -> str",
            tag="EXTRACTION",
            tag_color="#0d6b7a",
            description="Extracts all sheets from an Excel workbook as pipe-delimited text sections.",
            inputs=[("file_bytes", "bytes — raw XLSX binary")],
            outputs=[("str", "All sheets as '=== SHEET: Name ===\\n<pipe-delimited rows>' sections")],
            notes=[
                "openpyxl opened with data_only=True — reads computed values, NOT formulas",
                "Skips fully blank rows and trailing empty columns to reduce noise",
                "Citations use [[Sheet: SheetName, filename]] format (not page numbers)",
            ]
        ),
        sp(2),
    ]))

    # extract_all_documents_text
    story.append(KeepTogether([
        FuncCard(
            func_sig="extract_all_documents_text(files_bytes: list[tuple[str, bytes]]) -> dict",
            tag="EXTRACTION",
            tag_color="#0d6b7a",
            description="Routes each uploaded file to the correct extractor based on file extension.",
            inputs=[("files_bytes", "list of (filename, bytes) tuples")],
            outputs=[("dict", "{filename: extracted_text} — one key per uploaded file")],
            notes=[
                "Extensions xlsx, xls, xlsm → extract_excel_text(); everything else → extract_pdf_text()",
                "Called once at the start of /analyze; result is the 'documents' dict used throughout",
            ]
        ),
        sp(2),
    ]))

    # assemble_document_text
    story.append(KeepTogether([
        FuncCard(
            func_sig="assemble_document_text(documents: dict, char_limit: int = 80000) -> str",
            tag="UTILITY",
            tag_color="#6b7280",
            description="Concatenates all document texts with DOCUMENT boundary headers. Truncates safely.",
            inputs=[
                ("documents", "dict {filename: text}"),
                ("char_limit", "int — max total chars (default 80,000)"),
            ],
            outputs=[("str", "Full concatenated text with ####DOCUMENT: filename#### headers")],
            notes=[
                "Truncates at the last complete PAGE marker before the limit — never cuts mid-marker",
                "Appends '[TRUNCATED — remaining pages not included]' notice when truncated",
                "This assembled text is sent as document_text in /analyze response and used by /chat",
            ]
        ),
        sp(2),
    ]))

    story.append(PageBreak())

    story.append(h2("AI Pipeline Functions", s))
    story.append(sp(1))

    # extract_claims
    story.append(KeepTogether([
        FuncCard(
            func_sig="extract_claims(text: str, sector: str, criteria_context: str = '') -> list",
            tag="CLAUDE CALL",
            tag_color="#913d3e",
            description="First AI step: reads CIM text and extracts the 6 most impactful verifiable claims.",
            inputs=[
                ("text", "str — primary doc text, truncated to first 15,000 chars"),
                ("sector", "str — 'Private Equity' | 'Private Credit' | 'Venture Capital' | 'Real Estate'"),
                ("criteria_context", "str — formatted investor criteria block (optional)"),
            ],
            outputs=[
                ("list", "JSON array of claim dicts: {id, claim, page, category, verifiable, why_it_matters}"),
            ],
            notes=[
                "Prompt instructs Claude to prioritize: revenue/EBITDA > market size > competitive position > concentration",
                "category field: 'financial' | 'market' | 'competitive' | 'operational'",
                "Uses claude-sonnet-4-5, max_tokens=2500",
                "Strips markdown code fences (```) if Claude wraps output",
            ]
        ),
        sp(2),
    ]))

    # search_claim
    story.append(KeepTogether([
        FuncCard(
            func_sig="search_claim(claim: str) -> list",
            tag="TAVILY",
            tag_color="#d97706",
            description="Fires a Tavily web search for a single claim string. Returns top 3 results.",
            inputs=[("claim", "str — claim text extracted from CIM")],
            outputs=[("list", "Up to 3 dicts: {title, url, content[:300]}")],
            notes=[
                "search_depth='basic' — faster than 'advanced', sufficient for first-pass screening",
                "max_results=3 — limits token consumption in downstream analyze_claim call",
                "Content truncated to 300 chars per result to keep analyze_claim prompt concise",
                "Called inside search_and_analyze() which runs in a thread pool",
            ]
        ),
        sp(2),
    ]))

    # analyze_claim
    story.append(KeepTogether([
        FuncCard(
            func_sig="analyze_claim(claim: dict, search_results: list, sector: str) -> dict",
            tag="CLAUDE CALL",
            tag_color="#913d3e",
            description="Second AI step per claim: cross-references CIM claim against Tavily search results.",
            inputs=[
                ("claim", "dict — {claim, why_it_matters, ...}"),
                ("search_results", "list — output of search_claim()"),
                ("sector", "str — investment strategy lens"),
            ],
            outputs=[
                ("dict", "{verdict, explanation, sources[], confidence (1-5), materiality, diligence_question}"),
            ],
            notes=[
                "verdict: 'verified' | 'disputed' | 'unverifiable'",
                "explanation capped at 2 sentences — prompt enforces brevity",
                "diligence_question is claim-specific (not generic) — tied to the exact claim",
                "Uses claude-sonnet-4-5, max_tokens=800",
            ]
        ),
        sp(2),
    ]))

    # find_cross_document_conflicts
    story.append(KeepTogether([
        FuncCard(
            func_sig="find_cross_document_conflicts(documents: dict, sector: str) -> list",
            tag="CLAUDE CALL",
            tag_color="#913d3e",
            description="Detects numerical and narrative contradictions between multiple uploaded documents.",
            inputs=[
                ("documents", "dict {filename: text} — all uploaded docs"),
                ("sector", "str — controls which metrics Claude prioritizes in conflict_focus"),
            ],
            outputs=[
                ("list", "JSON array: [{doc1, doc2, claim1, claim2, severity, explanation, page1, page2}]"),
            ],
            notes=[
                "Only fires if len(files_bytes) > 1 — skipped for single-file uploads",
                "Each document text truncated to first 8,000 chars for this call",
                "severity: 'high' (material numerical discrepancy) | 'medium' (<10% diff) | 'low' (framing only)",
                "page1/page2 are null for Excel docs (use sheet citations instead)",
                "Has fallback brace-depth parser if JSON response is truncated — salvages partial objects",
            ]
        ),
        sp(2),
    ]))

    # get_overall_assessment
    story.append(KeepTogether([
        FuncCard(
            func_sig="get_overall_assessment(claims_with_verdicts: list, sector: str, criteria_context: str = '') -> dict",
            tag="CLAUDE CALL",
            tag_color="#913d3e",
            description="Synthesizes all claim verdicts into an overall investment assessment.",
            inputs=[
                ("claims_with_verdicts", "list — merged claim + analysis dicts"),
                ("sector", "str — investment lens"),
                ("criteria_context", "str — investor criteria block"),
            ],
            outputs=[
                ("dict", "{overall_verdict, company_snapshot, sellers_narrative, narrative_holds_up, reasoning, criteria_fit?, top_risks[], bull_case, key_questions[], summary_stats}"),
            ],
            notes=[
                "overall_verdict: 'Worth deeper look' | 'Borderline' | 'Pass'",
                "criteria_fit field only present if criteria_context non-empty",
                "Prompt tone: 'You just read this CIM on the train — 2-minute verbal briefing to a partner'",
                "Uses claude-sonnet-4-5, max_tokens=1500",
            ]
        ),
        sp(2),
    ]))

    # extract_financial_charts_data
    story.append(KeepTogether([
        FuncCard(
            func_sig="extract_financial_charts_data(text: str, sector: str) -> dict",
            tag="CLAUDE CALL",
            tag_color="#913d3e",
            description="Extracts structured time-series and scorecard data for frontend chart rendering.",
            inputs=[
                ("text", "str — primary doc text (first 15,000 chars)"),
                ("sector", "str — investment lens"),
            ],
            outputs=[
                ("dict", "{margin_trend: {years[], revenue_growth[], ebitda_margin[], revenue_absolute[]}, deal_scorecard: {dimensions[], overall_score}}"),
            ],
            notes=[
                "Runs in parallel with get_overall_assessment() — both fire in same ThreadPoolExecutor",
                "Scores 1–10 for 6 dimensions: Market Position, Financial Health, Management Quality, Growth, Moat, Deal Terms",
                "Returns safe empty dict on error — chart failure never crashes the analysis",
                "Uses claude-sonnet-4-5, max_tokens=1500",
            ]
        ),
        sp(2),
    ]))

    story.append(PageBreak())

    story.append(h2("COMPS Functions (POST /comps)", s))
    story.append(sp(1))

    # extract_deal_profile
    story.append(KeepTogether([
        FuncCard(
            func_sig="extract_deal_profile(assessment: dict, doc_text_preview: str, sector: str) -> dict",
            tag="CLAUDE CALL",
            tag_color="#913d3e",
            description="Derives a searchable deal profile and 4 targeted M&A search queries from the assessment.",
            inputs=[
                ("assessment", "dict — output of get_overall_assessment()"),
                ("doc_text_preview", "str — first 5,000 chars of primary doc"),
                ("sector", "str"),
            ],
            outputs=[
                ("dict", "{sector, sub_sector, description, revenue_millions, ebitda_millions, ebitda_margin_pct, geography, business_model, search_queries[4]}"),
            ],
            notes=[
                "search_queries are designed to surface real M&A transaction data (PitchBook/Bloomberg style)",
                "Financial fields use null if genuinely unknown — prompt explicitly allows this",
            ]
        ),
        sp(2),
    ]))

    # run_comps_searches
    story.append(KeepTogether([
        FuncCard(
            func_sig="run_comps_searches(deal_profile: dict) -> list",
            tag="TAVILY",
            tag_color="#d97706",
            description="Runs up to 4 Tavily searches using Claude-generated queries. Collects all results.",
            inputs=[("deal_profile", "dict — output of extract_deal_profile()")],
            outputs=[("list", "All search results across all queries: {query, title, url, content[:600]}"),],
            notes=[
                "Iterates queries sequentially (not parallel) — each adds ~2s but comps runs async anyway",
                "Content truncated to 600 chars (more than claim verification's 300 — comps need more context)",
                "Errors per query are caught individually — one failed search doesn't kill the others",
            ]
        ),
        sp(2),
    ]))

    # extract_comps_from_search
    story.append(KeepTogether([
        FuncCard(
            func_sig="extract_comps_from_search(deal_profile: dict, search_results: list, sector: str) -> dict",
            tag="CLAUDE CALL",
            tag_color="#913d3e",
            description="Synthesizes search results into structured comparable M&A transactions.",
            inputs=[
                ("deal_profile", "dict — the target deal's profile"),
                ("search_results", "list — all Tavily results"),
                ("sector", "str"),
            ],
            outputs=[
                ("dict", "{comps[], sector_context {typical multiples, drivers}, this_deal_positioning, valuation_context, data_quality_note}"),
            ],
            notes=[
                "Only includes confirmed transactions — prompt: 'Better 3 confirmed comps than 8 speculative'",
                "deal_profile is merged into result before returning (for frontend display)",
                "valuation_context is 2-3 paragraph written synthesis — pitch book quality",
                "data_quality_note always reminds analysts to verify with PitchBook/CapIQ/Bloomberg",
                "Uses claude-sonnet-4-5, max_tokens=3500 — largest token budget in the system",
            ]
        ),
        sp(2),
    ]))

    story.append(PageBreak())

    story.append(h2("Chat Function (POST /chat)", s))
    story.append(sp(1))

    story.append(KeepTogether([
        FuncCard(
            func_sig="chat_with_documents(message, document_text, history, document_names, sector) -> StreamingResponse",
            tag="ENDPOINT",
            tag_color="#166534",
            description="Multi-turn document Q&A with streaming response. Returns markdown text + inline CHART blocks.",
            inputs=[
                ("message", "str — user's question"),
                ("document_text", "str — assembled full document text (from /analyze response)"),
                ("history", "str (JSON) — list of prior {role, content} messages"),
                ("document_names", "str — comma-separated filenames for citation context"),
                ("sector", "str"),
            ],
            outputs=[
                ("StreamingResponse", "text/plain stream — markdown prose with CHART:{...} blocks inline"),
            ],
            notes=[
                "System prompt enforces sector lens: PE asks about EBITDA; Credit asks about DSCR",
                "Citation rules injected into system: always [[Page X, filename]] or [[Sheet: S, filename]]",
                "Claude generates CHART:{type, title, data, config} JSON blocks — frontend parses and renders them",
                "Full conversation history passed each call — Claude maintains context across turns",
            ]
        ),
        sp(2),
    ]))

    story.append(h2("Simple Endpoints", s))
    simple_data = [
        ["Endpoint", "Function", "Purpose", "Claude?"],
        ["GET /health", "health()", "Uptime check — returns {status: ok, timestamp}", "No"],
        ["POST /extract", "extract_document(file)", "Extract text from a single file. Used by file explorer when adding extra docs post-analysis.", "No"],
    ]
    story.append(make_table(simple_data, [1.2*inch, 1.3*inch, 3.8*inch, 0.7*inch]))

    story.append(PageBreak())

    # ── SECTION 3: DATA STRUCTURES ─────────────────────────────
    story.append(SectionHeader("3", "Data Structures & Constants"))
    story.append(sp(2))

    story.append(h2("STRATEGY_LENS Dictionary", s))
    story.append(body(
        "The central configuration object. Every prompt in the system is parameterized by this. "
        "Selecting a different sector changes what Claude focuses on, what red flags it watches for, "
        "and what verdict criteria it applies. All 4 lenses share the same code paths — no if/else branching.", s))
    story.append(sp(1))

    lens_data = [
        ["Lens Key", "focus", "key_metrics", "verdict_criteria"],
        ["Private Equity", "LBO returns, EBITDA growth, management quality, competitive moat, exit multiple",
         "EBITDA margins, revenue CAGR, CapEx intensity, leverage capacity",
         "Would this generate 20%+ IRR in a 5-year hold?"],
        ["Private Credit", "Debt service coverage, downside protection, asset coverage, covenant structure",
         "DSCR, interest coverage, leverage ratio, FCF conversion",
         "Can this service the debt through a downturn? Recovery value?"],
        ["Venture Capital", "Market size, growth rate, founder quality, product differentiation",
         "ARR growth, NRR, CAC/LTV, burn multiple, gross margins",
         "Can this be a $1B+ outcome? Is the team exceptional?"],
        ["Real Estate", "NOI stability, cap rate, occupancy trends, debt service, market dynamics",
         "Cap rate, NOI yield, DSCR, occupancy, rent/sqft",
         "Does the yield justify the risk? Downside if occupancy drops 20%?"],
    ]
    story.append(make_table(lens_data, [1.0*inch, 2.0*inch, 1.8*inch, 2.7*inch]))

    story.append(sp(2))
    story.append(h2("Each Lens Also Includes:", s))
    lens_extra = [
        ["Field", "Used In", "Purpose"],
        ["red_flags", "extract_claims, analyze_claim, get_overall_assessment", "What Claude watches for that would kill the deal"],
        ["conflict_focus", "find_cross_document_conflicts", "Which metrics Claude prioritizes when hunting for contradictions"],
        ["questions_focus", "chat system prompt", "Ensures chat responses are lens-appropriate (PE: management incentives; Credit: covenant package)"],
    ]
    story.append(make_table(lens_extra, [1.3*inch, 3.0*inch, 3.2*inch]))

    story.append(sp(2))
    story.append(h2("JSON Data Shapes — Key Outputs", s))

    json_shapes = [
        "# Claim (after verification merge):",
        '{  "id": 1, "claim": "...", "page": 12, "category": "financial",',
        '   "verifiable": true, "why_it_matters": "...",',
        '   "verdict": "verified|disputed|unverifiable",',
        '   "explanation": "...", "sources": [{"title":"","url":""}],',
        '   "confidence": 3,  # 1-5',
        '   "materiality": "high|medium|low",',
        '   "diligence_question": "..."  }',
        "",
        "# Assessment:",
        '{  "overall_verdict": "Worth deeper look|Borderline|Pass",',
        '   "company_snapshot": "...", "sellers_narrative": "...",',
        '   "narrative_holds_up": {"holds": true, "explanation": "..."},',
        '   "reasoning": "...", "criteria_fit": {"fits": true, "explanation": "..."},',
        '   "top_risks": ["...","...","..."],',
        '   "bull_case": "...", "key_questions": ["...","...","..."],',
        '   "summary_stats": {"verified": 3, "disputed": 1, "unverifiable": 2}  }',
        "",
        "# CrossDocumentConflict:",
        '{  "doc1": "CIM.pdf", "doc2": "model.xlsx",',
        '   "claim1": "EBITDA $91M [[Page 14, CIM.pdf]]",',
        '   "claim2": "EBITDA $84M [[Sheet: P&L, model.xlsx]]",',
        '   "severity": "high", "explanation": "...",',
        '   "page1": 14, "page2": null  }  # null = Excel doc',
    ]
    story.append(CodeBlock(json_shapes))

    story.append(PageBreak())

    # ── SECTION 4: CONCURRENCY ─────────────────────────────────
    story.append(SectionHeader("4", "Concurrency Architecture"))
    story.append(sp(2))

    story.append(h2("Why ThreadPoolExecutor (Not asyncio)?", s))
    story.append(body(
        "The Anthropic Python SDK and the <b>requests</b> library (used for Tavily) are both "
        "<b>synchronous</b>. FastAPI runs on an async event loop. Calling a sync function directly "
        "from an async handler would <b>block the entire event loop</b>, preventing other requests "
        "from being served. The solution is <b>loop.run_in_executor()</b> — this runs the sync "
        "function in a thread pool, keeping the event loop free to handle other requests.", s))
    story.append(sp(1))

    conc_code = [
        "# Pattern used in /analyze — claim verification:",
        "loop = asyncio.get_event_loop()",
        "with ThreadPoolExecutor(max_workers=6) as executor:",
        "    futures = [",
        "        loop.run_in_executor(executor, search_and_analyze, claim)",
        "        for claim in verifiable_claims",
        "    ]",
        "    analyzed_claims = list(await asyncio.gather(*futures))",
        "    # All 6 claims verified in parallel — not sequentially",
        "",
        "# Pattern used for assessment + charts (2-way parallel):",
        "with ThreadPoolExecutor(max_workers=2) as executor:",
        "    assessment_future = loop.run_in_executor(executor, get_overall_assessment, ...)",
        "    charts_future    = loop.run_in_executor(executor, extract_financial_charts_data, ...)",
        "    assessment, charts_data = await asyncio.gather(assessment_future, charts_future)",
    ]
    story.append(CodeBlock(conc_code))

    story.append(sp(2))
    story.append(h2("Thread Safety Note", s))
    story.append(body(
        "The <b>claude</b> client (anthropic.Anthropic) and <b>requests</b> are stateless — "
        "safe to call from multiple threads simultaneously. No shared mutable state exists between "
        "threads. Each thread gets its own claim dict, makes independent API calls, and returns "
        "its result. asyncio.gather() collects all results in order.", s))

    story.append(sp(2))
    story.append(h2("Alternative: Async SDK", s))
    story.append(body(
        "A cleaner approach would use <b>anthropic.AsyncAnthropic</b> + <b>httpx</b> (async HTTP client) "
        "for Tavily, eliminating the thread pool entirely. This would be pure async/await — lower overhead, "
        "no thread management. Trade-off: requires migrating all Claude calls to <b>await client.messages.create()</b> "
        "and switching requests.post() to httpx.AsyncClient.post(). Worth doing at production scale.", s))

    story.append(PageBreak())

    # ── SECTION 5: PROMPT ENGINEERING ──────────────────────────
    story.append(SectionHeader("5", "Prompt Engineering Details"))
    story.append(sp(2))

    story.append(h2("Prompt Design Principles Used", s))
    pe_data = [
        ["Principle", "Where Applied", "Example"],
        ["Persona priming", "All prompts", "'You are a senior PE analyst' — sets tone, reduces generic answers"],
        ["Structured JSON output", "All 5 Claude calls", "Return ONLY valid JSON — no markdown, no commentary"],
        ["Explicit field constraints", "analyze_claim, get_overall_assessment", "'explanation: MAX 2 sentences' — prevents verbosity"],
        ["Sector lens injection", "extract_claims, analyze_claim, get_overall_assessment", "focus/key_metrics/red_flags dynamically inserted from STRATEGY_LENS"],
        ["Anti-hedging instruction", "analyze_claim", "'Be direct — no hedging, no filler. Sound like a sharp senior associate'"],
        ["Specificity requirement", "diligence_question field", "'Not generic, tied to this claim' — prevents boilerplate questions"],
        ["Explicit citation format", "find_cross_document_conflicts, chat system prompt", "[[Page X, filename]] for PDFs; [[Sheet: S, filename]] for Excel"],
        ["Skepticism injection", "extract_comps_from_search", "'Better 3 confirmed comps than 8 speculative ones'"],
        ["Context primer", "extract_pdf_text", "Prepend extraction note before any page content — primes page citation behavior"],
    ]
    story.append(make_table(pe_data, [1.5*inch, 2.0*inch, 4.0*inch]))

    story.append(sp(2))
    story.append(h2("JSON Parsing Safety Pattern", s))
    story.append(body(
        "Every Claude call that returns JSON uses the same stripping pattern before json.loads():", s))
    story.append(CodeBlock([
        "raw = response.content[0].text.strip()",
        "if raw.startswith('```'):",
        "    raw = raw.split('```')[1]",
        "    if raw.startswith('json'):",
        "        raw = raw[4:]",
        "return json.loads(raw.strip())",
        "",
        "# find_cross_document_conflicts also has a brace-depth fallback:",
        "# If json.loads() fails on truncated response, manually scan for",
        "# complete {...} objects and return those — partial results > nothing.",
    ]))

    story.append(sp(2))
    story.append(h2("Chat CHART Block Protocol", s))
    story.append(body(
        "The chat endpoint instructs Claude to embed chart data inline in its text response. "
        "The frontend splits the response on CHART: prefix and renders each block as a Recharts component:", s))
    story.append(CodeBlock([
        '# Claude emits (in middle of prose):',
        'CHART:{"type":"line","title":"Revenue Trend","description":"...",',
        '       "data":[{"year":2020,"Revenue":280.1},...]',
        '       "config":{"xKey":"year","lines":[{"key":"Revenue","color":"#913d3e"}]}}',
        "",
        "# Frontend parses segments array:",
        "# [{type:'text', content:'...'}, {type:'chart', chartData:{...}}, {type:'text',...}]",
        "# Each segment rendered independently — text as markdown, chart as <LineChart>",
    ]))

    story.append(PageBreak())

    # ── SECTION 6: QUICK REF ────────────────────────────────────
    story.append(SectionHeader("6", "Quick Reference"))
    story.append(sp(2))

    story.append(h2("All Functions at a Glance", s))
    all_funcs = [
        ["Function", "Type", "Claude?", "Tavily?", "Called By"],
        ["build_criteria_context()", "Utility", "—", "—", "/analyze, /comps (via assessment)"],
        ["clean_page_text()", "Utility", "—", "—", "extract_pdf_text()"],
        ["extract_pdf_text()", "Extraction", "—", "—", "extract_all_documents_text()"],
        ["extract_excel_text()", "Extraction", "—", "—", "extract_all_documents_text()"],
        ["extract_all_documents_text()", "Extraction", "—", "—", "/analyze, /extract"],
        ["assemble_document_text()", "Utility", "—", "—", "/analyze"],
        ["extract_claims()", "AI Pipeline", "YES", "—", "/analyze (Step 2)"],
        ["search_claim()", "Verification", "—", "YES", "search_and_analyze() inner fn"],
        ["analyze_claim()", "AI Pipeline", "YES", "—", "search_and_analyze() inner fn"],
        ["find_cross_document_conflicts()", "AI Pipeline", "YES", "—", "/analyze (Step 6)"],
        ["get_overall_assessment()", "AI Pipeline", "YES", "—", "/analyze (Step 4, parallel)"],
        ["extract_financial_charts_data()", "AI Pipeline", "YES", "—", "/analyze (Step 5, parallel)"],
        ["extract_deal_profile()", "COMPS", "YES", "—", "/comps (Step 1)"],
        ["run_comps_searches()", "COMPS", "—", "YES", "/comps (Step 2)"],
        ["extract_comps_from_search()", "COMPS", "YES", "—", "/comps (Step 3)"],
        ["chat_with_documents()", "Endpoint", "YES", "—", "POST /chat"],
        ["extract_document()", "Endpoint", "—", "—", "POST /extract"],
        ["health()", "Endpoint", "—", "—", "GET /health"],
    ]
    story.append(make_table(all_funcs, [2.2*inch, 0.9*inch, 0.7*inch, 0.7*inch, 3.0*inch]))

    story.append(sp(2))
    story.append(h2("Claude Call Budget per /analyze", s))
    budget_data = [
        ["Call", "Function", "max_tokens", "Runs When"],
        ["1", "extract_claims()", "2,500", "Always"],
        ["2–7", "analyze_claim() ×6", "800 each", "Always (parallel)"],
        ["8", "get_overall_assessment()", "1,500", "Always (parallel with 9)"],
        ["9", "extract_financial_charts_data()", "1,500", "Always (parallel with 8)"],
        ["10", "find_cross_document_conflicts()", "4,000", "Only if >1 file uploaded"],
        ["—", "COMPS: extract_deal_profile()", "1,000", "Async POST /comps (separate req)"],
        ["—", "COMPS: extract_comps_from_search()", "3,500", "Async POST /comps (separate req)"],
    ]
    story.append(make_table(budget_data, [0.4*inch, 2.8*inch, 1.0*inch, 3.3*inch]))

    story.append(sp(2))
    story.append(h2("Environment Variables Required", s))
    env_data = [
        ["Variable", "Used By", "What Happens Without It"],
        ["ANTHROPIC_API_KEY", "All Claude calls", "AttributeError on client initialization — app crashes on startup"],
        ["TAVILY_API_KEY", "search_claim(), run_comps_searches()", "Requests fail with 401 — claims marked unverifiable, comps empty"],
        ["REACT_APP_API_URL", "Frontend axios base URL", "Defaults to http://localhost:8000 — works for local dev"],
        ["SUPABASE_URL + SUPABASE_KEY", "useDealPersistence.ts", "supabase=null — app runs fully in-memory, deals not saved"],
    ]
    story.append(make_table(env_data, [2.0*inch, 2.0*inch, 3.5*inch]))

    # ── BUILD ──────────────────────────────────────────────────
    doc = SimpleDocTemplate(
        "CIM_Backend_Reference.pdf",
        pagesize=letter,
        rightMargin=0.5*inch,
        leftMargin=0.5*inch,
        topMargin=0.65*inch,
        bottomMargin=0.65*inch,
    )
    doc.build(story, onFirstPage=cover_page, onLaterPages=header_footer)
    print("OK: CIM_Backend_Reference.pdf generated")


if __name__ == "__main__":
    build_pdf()
