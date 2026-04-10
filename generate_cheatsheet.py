"""
Sagard CIM Analyzer — Technical Interview Prep PDF Generator
Run: python generate_cheatsheet.py
Output: CIM_Analyzer_Interview_Cheatsheet.pdf
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

# ── Brand colors ─────────────────────────────────────────────
RED    = HexColor("#913d3e")
NAVY   = HexColor("#1a1a1a")
DARK   = HexColor("#2c2c2c")
LIGHT  = HexColor("#f8f6f3")
GRAY   = HexColor("#6b7280")
LGRAY  = HexColor("#e5e7eb")
XGRAY  = HexColor("#f3f4f6")
GREEN  = HexColor("#166534")
AMBER  = HexColor("#92400e")
BGGRN  = HexColor("#f0fdf4")
BGAMB  = HexColor("#fffbeb")
BGRED  = HexColor("#fdf2f2")
CODE_BG = HexColor("#1e1e2e")
CODE_FG = HexColor("#cdd6f4")
ACCENT = HexColor("#d4a0a0")
TEAL   = HexColor("#0d6b7a")

# ── Styles ────────────────────────────────────────────────────
def build_styles():
    base = getSampleStyleSheet()

    styles = {}

    styles['cover_title'] = ParagraphStyle(
        'cover_title', fontName='Helvetica-Bold', fontSize=32,
        textColor=white, leading=40, alignment=TA_CENTER, spaceAfter=8
    )
    styles['cover_sub'] = ParagraphStyle(
        'cover_sub', fontName='Helvetica', fontSize=14,
        textColor=ACCENT, leading=20, alignment=TA_CENTER, spaceAfter=6
    )
    styles['cover_meta'] = ParagraphStyle(
        'cover_meta', fontName='Helvetica', fontSize=11,
        textColor=HexColor("#cccccc"), alignment=TA_CENTER, leading=16
    )
    styles['h1'] = ParagraphStyle(
        'h1', fontName='Helvetica-Bold', fontSize=17,
        textColor=white, leading=22, spaceBefore=0, spaceAfter=0
    )
    styles['h2'] = ParagraphStyle(
        'h2', fontName='Helvetica-Bold', fontSize=13,
        textColor=RED, leading=18, spaceBefore=18, spaceAfter=6
    )
    styles['h3'] = ParagraphStyle(
        'h3', fontName='Helvetica-Bold', fontSize=11,
        textColor=NAVY, leading=16, spaceBefore=12, spaceAfter=4
    )
    styles['body'] = ParagraphStyle(
        'body', fontName='Helvetica', fontSize=9.5,
        textColor=DARK, leading=15, spaceBefore=3, spaceAfter=3,
        alignment=TA_JUSTIFY
    )
    styles['body_left'] = ParagraphStyle(
        'body_left', fontName='Helvetica', fontSize=9.5,
        textColor=DARK, leading=15, spaceBefore=2, spaceAfter=2
    )
    styles['bullet'] = ParagraphStyle(
        'bullet', fontName='Helvetica', fontSize=9.5,
        textColor=DARK, leading=15, spaceBefore=2, spaceAfter=2,
        leftIndent=14, firstLineIndent=-10
    )
    styles['bullet2'] = ParagraphStyle(
        'bullet2', fontName='Helvetica', fontSize=9,
        textColor=GRAY, leading=14, spaceBefore=1, spaceAfter=1,
        leftIndent=28, firstLineIndent=-10
    )
    styles['code'] = ParagraphStyle(
        'code', fontName='Courier', fontSize=8.2,
        textColor=CODE_FG, leading=13, spaceBefore=2, spaceAfter=2,
        leftIndent=10, rightIndent=10
    )
    styles['code_label'] = ParagraphStyle(
        'code_label', fontName='Courier-Bold', fontSize=8.2,
        textColor=HexColor("#89dceb"), leading=13
    )
    styles['callout'] = ParagraphStyle(
        'callout', fontName='Helvetica', fontSize=9,
        textColor=HexColor("#1e3a5f"), leading=14, spaceBefore=4, spaceAfter=4,
        leftIndent=10, rightIndent=10
    )
    styles['warn'] = ParagraphStyle(
        'warn', fontName='Helvetica', fontSize=9,
        textColor=HexColor("#7c2d12"), leading=14, spaceBefore=4, spaceAfter=4,
        leftIndent=10, rightIndent=10
    )
    styles['caption'] = ParagraphStyle(
        'caption', fontName='Helvetica-Oblique', fontSize=8.5,
        textColor=GRAY, leading=13, alignment=TA_CENTER
    )
    styles['toc_section'] = ParagraphStyle(
        'toc_section', fontName='Helvetica-Bold', fontSize=10,
        textColor=NAVY, leading=16, spaceBefore=4
    )
    styles['toc_item'] = ParagraphStyle(
        'toc_item', fontName='Helvetica', fontSize=9.5,
        textColor=DARK, leading=15, leftIndent=14
    )
    styles['answer'] = ParagraphStyle(
        'answer', fontName='Helvetica', fontSize=9,
        textColor=HexColor("#14532d"), leading=14, spaceBefore=2, spaceAfter=2,
        leftIndent=10, rightIndent=10
    )
    styles['verdict_good'] = ParagraphStyle(
        'verdict_good', fontName='Helvetica-Bold', fontSize=9,
        textColor=GREEN, leading=13
    )
    styles['verdict_warn'] = ParagraphStyle(
        'verdict_warn', fontName='Helvetica-Bold', fontSize=9,
        textColor=AMBER, leading=13
    )
    styles['verdict_bad'] = ParagraphStyle(
        'verdict_bad', fontName='Helvetica-Bold', fontSize=9,
        textColor=RED, leading=13
    )

    return styles


# ── Custom Flowables ──────────────────────────────────────────

class SectionHeader(Flowable):
    """Full-width dark banner for section headings."""
    def __init__(self, number, title, styles, width=7.5*inch):
        super().__init__()
        self.number = number
        self.title = title
        self.styles = styles
        self.width = width
        self.height = 36

    def draw(self):
        c = self.canv
        c.setFillColor(NAVY)
        c.rect(0, 0, self.width, self.height, fill=1, stroke=0)
        c.setFillColor(RED)
        c.rect(0, 0, 5, self.height, fill=1, stroke=0)
        c.setFillColor(white)
        c.setFont('Helvetica-Bold', 12)
        c.drawString(16, 13, f"{self.number}  {self.title.upper()}")

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        return availWidth, self.height


class QuestionBox(Flowable):
    """Interview question card with Q label."""
    def __init__(self, question, styles, width=7.5*inch):
        super().__init__()
        self.question = question
        self.styles = styles
        self.width = width
        self._height = None

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        # Estimate height
        self._height = 28
        return availWidth, self._height

    def draw(self):
        c = self.canv
        c.setFillColor(HexColor("#1e3a5f"))
        c.roundRect(0, 0, self.width, 24, 4, fill=1, stroke=0)
        c.setFillColor(white)
        c.setFont('Helvetica-Bold', 8)
        c.drawString(10, 8, "Q")
        c.setFont('Helvetica', 9)
        # Truncate if too long for single line
        q = self.question
        c.drawString(26, 8, q[:120])


class CodeBlock(Flowable):
    """Dark-bg code block."""
    def __init__(self, lines, width=7.5*inch):
        super().__init__()
        self.lines = lines if isinstance(lines, list) else lines.split('\n')
        self.width = width
        self.padding = 10
        self.line_height = 13

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        h = len(self.lines) * self.line_height + self.padding * 2
        return availWidth, h

    def draw(self):
        c = self.canv
        h = len(self.lines) * self.line_height + self.padding * 2
        c.setFillColor(CODE_BG)
        c.roundRect(0, 0, self.width, h, 5, fill=1, stroke=0)
        c.setFont('Courier', 8)
        y = h - self.padding - self.line_height + 2
        for line in self.lines:
            if line.startswith('#') or line.startswith('//'):
                c.setFillColor(HexColor("#6c7086"))
            elif any(kw in line for kw in ['def ', 'async ', 'class ', 'import ', 'from ', 'return ']):
                c.setFillColor(HexColor("#cba6f7"))
            elif '=' in line and not '==' in line:
                c.setFillColor(CODE_FG)
            else:
                c.setFillColor(CODE_FG)
            c.drawString(self.padding, y, line[:110])
            y -= self.line_height


class InfoBox(Flowable):
    """Colored info / warning box."""
    def __init__(self, text, kind='info', width=7.5*inch):
        super().__init__()
        self.text = text
        self.kind = kind  # 'info', 'warn', 'success', 'danger'
        self.width = width
        self.padding = 10

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        # Rough height estimate
        chars_per_line = int((availWidth - self.padding * 2) / 5.5)
        lines = max(1, len(self.text) // chars_per_line + 1)
        return availWidth, lines * 14 + self.padding * 2

    def draw(self):
        c = self.canv
        h_val = self.wrap(self.width, 999)[1]
        colors_map = {
            'info':    (HexColor("#eff6ff"), HexColor("#1e3a5f"), HexColor("#3b82f6")),
            'warn':    (HexColor("#fffbeb"), HexColor("#7c2d12"), HexColor("#f59e0b")),
            'success': (BGGRN,              HexColor("#14532d"), GREEN),
            'danger':  (BGRED,              HexColor("#7f1d1d"), RED),
        }
        bg, fg, bar = colors_map.get(self.kind, colors_map['info'])
        c.setFillColor(bg)
        c.roundRect(0, 0, self.width, h_val, 4, fill=1, stroke=0)
        c.setFillColor(bar)
        c.rect(0, 0, 4, h_val, fill=1, stroke=0)
        c.setFillColor(fg)
        c.setFont('Helvetica', 8.5)
        # Word-wrap manually
        words = self.text.split()
        line, y = [], h_val - self.padding - 10
        max_w = self.width - self.padding * 2 - 8
        for word in words:
            test = ' '.join(line + [word])
            if c.stringWidth(test, 'Helvetica', 8.5) < max_w:
                line.append(word)
            else:
                c.drawString(self.padding + 8, y, ' '.join(line))
                y -= 13
                line = [word]
        if line:
            c.drawString(self.padding + 8, y, ' '.join(line))


# ── Page templates ────────────────────────────────────────────

def header_footer(canvas, doc):
    canvas.saveState()
    w, h = letter
    # Top rule
    canvas.setStrokeColor(LGRAY)
    canvas.setLineWidth(0.5)
    canvas.line(0.5*inch, h - 0.45*inch, w - 0.5*inch, h - 0.45*inch)
    # Header text
    canvas.setFont('Helvetica-Bold', 7)
    canvas.setFillColor(RED)
    canvas.drawString(0.5*inch, h - 0.38*inch, "SAGARD CIM ANALYZER")
    canvas.setFont('Helvetica', 7)
    canvas.setFillColor(GRAY)
    canvas.drawRightString(w - 0.5*inch, h - 0.38*inch, "TECHNICAL INTERVIEW PREP")
    # Footer rule
    canvas.line(0.5*inch, 0.45*inch, w - 0.5*inch, 0.45*inch)
    # Page number
    canvas.setFont('Helvetica', 7)
    canvas.setFillColor(GRAY)
    canvas.drawCentredString(w / 2, 0.3*inch, f"Page {doc.page}")
    canvas.restoreState()


def cover_page(canvas, doc):
    canvas.saveState()
    w, h = letter
    # Full background
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    # Red accent strip top
    canvas.setFillColor(RED)
    canvas.rect(0, h - 6, w, 6, fill=1, stroke=0)
    # Red accent strip bottom
    canvas.rect(0, 0, w, 4, fill=1, stroke=0)
    # Decorative vertical bar
    canvas.setFillColor(HexColor("#2c1516"))
    canvas.rect(0, 0, 14, h, fill=1, stroke=0)
    canvas.setFillColor(RED)
    canvas.rect(0, 0, 5, h, fill=1, stroke=0)
    canvas.restoreState()


# ── Helper builders ───────────────────────────────────────────

def B(text):
    return f"<b>{text}</b>"

def I(text):
    return f"<i>{text}</i>"

def C(text, hex_color):
    return f'<font color="{hex_color}">{text}</font>'

def bullet(text, s, level=1):
    marker = "•" if level == 1 else "–"
    key = 'bullet' if level == 1 else 'bullet2'
    return Paragraph(f"{marker}  {text}", s[key])

def h2(text, s):
    return Paragraph(text, s['h2'])

def h3(text, s):
    return Paragraph(text, s['h3'])

def body(text, s):
    return Paragraph(text, s['body'])

def body_left(text, s):
    return Paragraph(text, s['body_left'])

def sp(n=1):
    return Spacer(1, n * 5)

def rule():
    return HRFlowable(width="100%", thickness=0.5, color=LGRAY, spaceAfter=6, spaceBefore=6)

def make_table(data, col_widths, header=True):
    t = Table(data, colWidths=col_widths)
    style = [
        ('BACKGROUND',  (0,0), (-1,0), NAVY),
        ('TEXTCOLOR',   (0,0), (-1,0), white),
        ('FONTNAME',    (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE',    (0,0), (-1,0), 8.5),
        ('FONTNAME',    (0,1), (-1,-1), 'Helvetica'),
        ('FONTSIZE',    (0,1), (-1,-1), 8.5),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [white, XGRAY]),
        ('GRID',        (0,0), (-1,-1), 0.3, LGRAY),
        ('VALIGN',      (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING',  (0,0), (-1,-1), 5),
        ('BOTTOMPADDING',(0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 7),
        ('RIGHTPADDING',(0,0), (-1,-1), 7),
        ('WORDWRAP',    (0,0), (-1,-1), True),
    ]
    t.setStyle(TableStyle(style))
    return t


def q_and_a(question, answer_bullets, s, kind='info'):
    """Returns a list of flowables for a Q&A pair."""
    items = []
    # Question row
    q_data = [[Paragraph(f"<b>Q:</b>  {question}", ParagraphStyle(
        'qt', fontName='Helvetica-Bold', fontSize=9.5, textColor=HexColor("#1e3a5f"),
        leading=14, leftIndent=0
    ))]]
    qt = Table(q_data, colWidths=[7.5*inch])
    qt.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), HexColor("#e8f0fe")),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
        ('TOPPADDING', (0,0), (-1,-1), 7),
        ('BOTTOMPADDING', (0,0), (-1,-1), 7),
        ('LINEBELOW', (0,0), (-1,-1), 1.5, HexColor("#3b82f6")),
    ]))
    items.append(qt)

    # Answer blocks
    ans_data = [[Paragraph(
        '<font color="#14532d"><b>A:</b></font>  ' + ans,
        ParagraphStyle('ab', fontName='Helvetica', fontSize=9, textColor=DARK,
                       leading=14, leftIndent=0)
    )] for ans in answer_bullets]
    at = Table(ans_data, colWidths=[7.5*inch])
    at.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), BGGRN),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LINEAFTER', (0,0), (0,-1), 0, white),
    ]))
    items.append(at)
    items.append(sp(2))
    return items


# ── PDF content builder ───────────────────────────────────────

def build_pdf():
    s = build_styles()
    story = []

    # ── COVER PAGE ────────────────────────────────────────────
    story.append(Spacer(1, 2.2*inch))
    story.append(Paragraph("CIM ANALYZER", s['cover_title']))
    story.append(Spacer(1, 0.1*inch))
    story.append(Paragraph("Technical Interview Preparation Guide", s['cover_sub']))
    story.append(Spacer(1, 0.35*inch))
    story.append(HRFlowable(width=3*inch, thickness=1, color=RED,
                             spaceAfter=20, spaceBefore=0, hAlign='CENTER'))
    story.append(Paragraph("Sagard Private Capital", s['cover_meta']))
    story.append(Spacer(1, 0.08*inch))
    story.append(Paragraph("Hanson Qin  ·  Full-Stack AI Application", s['cover_meta']))
    story.append(Spacer(1, 0.08*inch))
    story.append(Paragraph(f"Generated {datetime.date.today().strftime('%B %d, %Y')}", s['cover_meta']))
    story.append(Spacer(1, 1.6*inch))

    # Tech pills row
    pills = [["FastAPI", "React 19 + TypeScript", "Claude Sonnet 4.5",
               "Tavily Search", "Supabase", "Recharts"]]
    pt = Table(pills, colWidths=[1.0*inch, 1.7*inch, 1.6*inch, 1.1*inch, 0.9*inch, 0.9*inch])
    pt.setStyle(TableStyle([
        ('BACKGROUND',   (0,0), (-1,-1), HexColor("#2c1516")),
        ('TEXTCOLOR',    (0,0), (-1,-1), ACCENT),
        ('FONTNAME',     (0,0), (-1,-1), 'Helvetica-Bold'),
        ('FONTSIZE',     (0,0), (-1,-1), 7.5),
        ('ALIGN',        (0,0), (-1,-1), 'CENTER'),
        ('TOPPADDING',   (0,0), (-1,-1), 5),
        ('BOTTOMPADDING',(0,0), (-1,-1), 5),
        ('GRID',         (0,0), (-1,-1), 0.5, HexColor("#913d3e")),
    ]))
    story.append(pt)
    story.append(PageBreak())

    # ── TABLE OF CONTENTS ─────────────────────────────────────
    story.append(SectionHeader("", "Table of Contents", s))
    story.append(sp(3))

    toc_data = [
        ("1.", "Overall Architecture & Stack", "3"),
        ("2.", "The Analysis Pipeline — Step by Step", "5"),
        ("3.", "Document Extraction & Text Processing", "7"),
        ("4.", "Prompting Strategy & Claude Integration", "8"),
        ("5.", "Cross-Document Conflict Detection", "11"),
        ("6.", "Claim Verification with Tavily", "12"),
        ("7.", "The Strategy Lens System", "13"),
        ("8.", "Comparable Transactions (COMPS) Feature", "15"),
        ("9.", "Frontend Architecture & State Management", "16"),
        ("10.", "Data Persistence — Supabase + IndexedDB", "18"),
        ("11.", "Common Interview Questions & Model Answers", "19"),
        ("12.", "Known Weaknesses & How to Address Them", "24"),
        ("13.", "What I'd Build Next", "26"),
        ("14.", "Scaling to 10× Volume", "27"),
        ("15.", "Quick Reference Tables", "29"),
    ]
    for num, title, pg in toc_data:
        row_data = [[
            Paragraph(f"<b>{num}</b>", ParagraphStyle('tn', fontName='Helvetica-Bold',
                      fontSize=10, textColor=RED, leading=16)),
            Paragraph(title, s['toc_item']),
            Paragraph(pg, ParagraphStyle('tp', fontName='Helvetica', fontSize=9.5,
                      textColor=GRAY, alignment=TA_LEFT, leading=16)),
        ]]
        rt = Table(row_data, colWidths=[0.4*inch, 6.5*inch, 0.6*inch])
        rt.setStyle(TableStyle([
            ('TOPPADDING',    (0,0), (-1,-1), 4),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('LINEBELOW',     (0,0), (-1,-1), 0.3, LGRAY),
        ]))
        story.append(rt)

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 1 — ARCHITECTURE
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("1", "Overall Architecture & Stack", s))
    story.append(sp(2))

    story.append(h2("High-Level System Diagram", s))
    arch_lines = [
        "  User Browser (React SPA — single App.tsx file)",
        "      │  multipart/form-data + JSON (axios)",
        "      ▼",
        "  FastAPI Backend (Python, async, single main.py)",
        "      ├── POST /analyze  → main pipeline",
        "      ├── POST /comps    → comparable transactions",
        "      ├── POST /chat     → conversational Q&A",
        "      ├── POST /extract  → single-doc text extraction",
        "      └── GET  /health   → uptime check",
        "            │",
        "      ┌─────┴──────────────┐",
        "      ▼                    ▼",
        "  Anthropic API         Tavily Search API",
        "  (claude-sonnet-4-5)   (web search for verification)",
        "",
        "  Supabase (PostgreSQL)   ← deals, documents, analyses, chat",
        "  IndexedDB (browser)     ← file binary cache (survives refresh)",
    ]
    story.append(CodeBlock(arch_lines))
    story.append(sp(2))

    story.append(h2("Tech Stack Decision Rationale", s))
    tech_data = [
        ["Component", "Choice", "Why"],
        ["Backend framework", "FastAPI", "Native async, auto OpenAPI docs, Form/File uploads out of the box"],
        ["AI model", "claude-sonnet-4-5", "Best reasoning-per-cost ratio; handles long financial docs reliably"],
        ["Web search", "Tavily", "Purpose-built for AI agents; returns cleaned content vs raw HTML"],
        ["Frontend framework", "React 19 + TypeScript", "Hooks-based state management; TS catches shape mismatches on API responses"],
        ["Charting", "Recharts", "Declarative React components; easily driven by JSON from Claude"],
        ["Database", "Supabase", "Managed Postgres + JS SDK; Row Level Security ready for multi-tenant"],
        ["File cache", "IndexedDB", "Browser-native binary storage; free, no upload cost, survives page refresh"],
        ["PDF parsing", "pdfplumber", "Extracts both text and tables; better table detection than PyMuPDF for financial docs"],
        ["Excel parsing", "openpyxl (data_only=True)", "Reads computed cell values not formulas — critical for financial models"],
    ]
    story.append(make_table(tech_data, [1.2*inch, 1.5*inch, 4.8*inch]))
    story.append(sp(2))

    story.append(h2("Endpoints at a Glance", s))
    ep_data = [
        ["Endpoint", "Inputs", "Key Output", "Claude Calls"],
        ["POST /analyze", "files[], sector, criteria fields", "assessment, claims[], conflicts[], charts_data", "4 types, up to 8 total"],
        ["POST /comps", "assessment_json, doc preview, sector", "comps[], sector_context, valuation_context", "2 (profile + extraction)"],
        ["POST /chat", "message, document_text, history[], sector", "Streaming markdown + embedded CHART blocks", "1 (with full history)"],
        ["POST /extract", "single file", "extracted text string", "0"],
        ["GET /health", "—", "status: ok, timestamp", "0"],
    ]
    story.append(make_table(ep_data, [1.1*inch, 1.8*inch, 2.6*inch, 2.0*inch]))
    story.append(PageBreak())

    story.append(h2("Key Architectural Decisions", s))

    story.append(h3("Monolithic Files (main.py / App.tsx)", s))
    story.append(body(
        "Both backend and frontend are single files. This was an intentional tradeoff during rapid prototyping: "
        "fast to navigate, zero import overhead, easier to deploy. The cost is reduced testability in isolation. "
        "At scale, backend would split into <b>routers/</b>, <b>services/</b>, <b>models/</b>; frontend into "
        "component files with React context or Zustand for state.", s))

    story.append(h3("Sync Libraries in Async Framework", s))
    story.append(body(
        "The Anthropic SDK and <b>requests</b> (Tavily) are both synchronous. FastAPI is async. "
        "The solution: <b>loop.run_in_executor(ThreadPoolExecutor)</b> wraps each blocking call in a thread, "
        "then <b>asyncio.gather()</b> awaits all threads simultaneously. This achieves true parallelism "
        "without blocking the event loop. An alternative would be the async Anthropic client "
        "(<b>anthropic.AsyncAnthropic</b>) + <b>httpx</b> for Tavily — pure async, no thread overhead.", s))

    story.append(h3("Supabase Optionality Pattern", s))
    story.append(body(
        "<b>supabaseClient.ts</b> exports <b>null</b> when env vars are missing. "
        "<b>useDealPersistence.ts</b> checks <b>if (!supabase) return</b> before every DB operation. "
        "This means the app runs fully in-browser without a database — useful for demos or local development "
        "without a Supabase project configured.", s))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 2 — PIPELINE
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("2", "The Analysis Pipeline — Step by Step", s))
    story.append(sp(2))

    story.append(body(
        "The <b>POST /analyze</b> endpoint orchestrates the entire pipeline. It is a single async function "
        "that coordinates multiple Claude calls and Tavily searches, using concurrency to minimize wall-clock time. "
        "Here is every step in order:", s))
    story.append(sp(2))

    steps = [
        ("Step 1", "File Reading + Text Extraction", "extract_all_documents_text()",
         "Reads all uploaded files. Routes each by extension: .pdf → extract_pdf_text(), "
         ".xlsx/.xls/.xlsm → extract_excel_text(). Returns {filename: extracted_text} dict."),
        ("Step 2", "Claim Extraction (Claude call #1)", "extract_claims()",
         "Sends first 15,000 chars of PRIMARY document to Claude. Asks for exactly 6 high-impact "
         "verifiable claims ranked by investment relevance. Output: JSON array with id, claim text, "
         "page number, category, verifiable flag, why_it_matters."),
        ("Step 3", "Concurrent Claim Verification", "search_and_analyze() × N in ThreadPoolExecutor",
         "For each verifiable claim: (a) search_claim() → Tavily API returns 3 web results; "
         "(b) analyze_claim() → Claude assesses verdict, confidence 1-5, materiality, diligence_question. "
         "All claims run simultaneously with max_workers=6."),
        ("Step 4", "Overall Assessment (Claude call, parallel)", "get_overall_assessment()",
         "Receives the fully-analyzed claims array. Produces: overall_verdict (3 choices), "
         "company_snapshot, sellers_narrative, narrative_holds_up, reasoning, top_risks[], "
         "bull_case, key_questions[], summary_stats, optional criteria_fit."),
        ("Step 5", "Chart Data Extraction (Claude call, parallel)", "extract_financial_charts_data()",
         "Runs in parallel with Step 4. Extracts margin_trend (years/revenue_growth/ebitda_margin) "
         "and deal_scorecard (6 dimensions, 1-10 scores). Uses first 15k chars only."),
        ("Step 6", "Cross-Doc Conflict Detection", "find_cross_document_conflicts()",
         "Only fires when len(files) > 1. Single Claude call sees all documents (each truncated to "
         "8,000 chars). Finds numerical and narrative contradictions. Returns severity-labeled conflicts "
         "with page/sheet citations."),
        ("Step 7", "COMPS (async, after /analyze returns)", "/comps endpoint",
         "Frontend fires this immediately after receiving /analyze response — does not block the main "
         "results. Three Claude calls: extract_deal_profile() → run_comps_searches() (4 Tavily queries) "
         "→ extract_comps_from_search()."),
    ]

    for num, title, func, desc in steps:
        row = [[
            Paragraph(f"<b>{num}</b>", ParagraphStyle('sn', fontName='Helvetica-Bold',
                      fontSize=9, textColor=white, leading=13, alignment=TA_CENTER)),
            Paragraph(f"<b>{title}</b><br/>"
                      f'<font color="#6b7280" size="8">{func}</font>',
                      ParagraphStyle('st', fontName='Helvetica-Bold', fontSize=9.5,
                                     textColor=NAVY, leading=14)),
            Paragraph(desc, ParagraphStyle('sd', fontName='Helvetica', fontSize=8.5,
                                           textColor=DARK, leading=13)),
        ]]
        rt = Table(row, colWidths=[0.5*inch, 1.8*inch, 5.2*inch])
        rt.setStyle(TableStyle([
            ('BACKGROUND',    (0,0), (0,-1), RED),
            ('BACKGROUND',    (1,0), (1,-1), XGRAY),
            ('TOPPADDING',    (0,0), (-1,-1), 7),
            ('BOTTOMPADDING', (0,0), (-1,-1), 7),
            ('LEFTPADDING',   (0,0), (-1,-1), 8),
            ('RIGHTPADDING',  (0,0), (-1,-1), 8),
            ('VALIGN',        (0,0), (-1,-1), 'TOP'),
            ('LINEBELOW',     (0,0), (-1,-1), 0.5, LGRAY),
        ]))
        story.append(rt)
        story.append(sp(1))

    story.append(sp(2))
    story.append(h2("Concurrency Model", s))
    story.append(CodeBlock([
        "# Step 3 — 6 claims verified simultaneously",
        "def search_and_analyze(claim: dict) -> dict:",
        "    search_results = search_claim(claim['claim'])   # Tavily (blocking)",
        "    analysis = analyze_claim(claim, search_results, sector)  # Claude (blocking)",
        "    return {**claim, **analysis}",
        "",
        "loop = asyncio.get_event_loop()",
        "with ThreadPoolExecutor(max_workers=6) as executor:",
        "    futures = [loop.run_in_executor(executor, search_and_analyze, c)",
        "               for c in verifiable_claims]",
        "    analyzed_claims = list(await asyncio.gather(*futures))",
        "",
        "# Step 4+5 — assessment and charts in parallel",
        "with ThreadPoolExecutor(max_workers=2) as executor:",
        "    assessment_future = loop.run_in_executor(executor, get_overall_assessment, ...)",
        "    charts_future     = loop.run_in_executor(executor, extract_financial_charts_data, ...)",
        "    assessment, charts_data = await asyncio.gather(assessment_future, charts_future)",
    ]))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 3 — DOCUMENT EXTRACTION
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("3", "Document Extraction & Text Processing", s))
    story.append(sp(2))

    story.append(h2("PDF Extraction — extract_pdf_text()", s))
    story.append(body(
        "Uses <b>pdfplumber</b> to iterate every page. For each page:", s))
    for b_text in [
        "Extracts body text via <b>page.extract_text()</b>",
        "Extracts tables via <b>page.extract_tables()</b> → renders as pipe-delimited rows appended to body text under <b>[TABLES ON THIS PAGE]</b> header",
        "Passes text through <b>clean_page_text()</b> — regex strips CONFIDENTIAL footer lines (e.g. 'Bear, Stearns & Co. Inc. CONFIDENTIAL 19') that would cause wrong page citations",
        "Wraps each page in <b>====\\nPAGE X OF Y\\n====</b> markers — these are the ONLY citation-valid page numbers",
        "Blank pages get <b>[No extractable text on this page]</b> placeholder to keep page numbering in sync with the PDF viewer",
    ]:
        story.append(bullet(b_text, s))
    story.append(sp(1))
    story.append(body(
        "Prepends an <b>EXTRACTION NOTE</b> warning Claude that internal printed numbers differ from PDF page positions. "
        "This solves a real problem: a 60-page CIM might have internal slide numbers 1-40 on PDF pages 10-50.", s))

    story.append(h2("Excel Extraction — extract_excel_text()", s))
    for b_text in [
        "<b>openpyxl.load_workbook(data_only=True)</b> — reads computed cell values, not formulas. Critical for financial models where =SUM() would render as a formula string",
        "Each sheet becomes <b>=== SHEET: SheetName ===</b> section header",
        "Rows rendered as pipe-delimited text: <b>100.0 | 120.5 | 145.2</b>",
        "Empty sheets and blank rows are skipped; trailing empty columns trimmed",
        "Prepends EXCEL EXTRACTION NOTE for Claude context",
    ]:
        story.append(bullet(b_text, s))

    story.append(h2("Document Assembly — assemble_document_text()", s))
    story.append(body(
        "Concatenates all documents with <b>####\\nDOCUMENT: filename\\n####</b> boundary headers. "
        "Applies a <b>char_limit=80,000</b> cap, truncating at the last complete page marker "
        "(never mid-header) and appending a <b>[TRUNCATED]</b> notice.", s))

    story.append(h2("clean_page_text() Regex Detail", s))
    story.append(CodeBlock([
        "# Most specific first — prevents over-stripping",
        "re.sub(r'Bear,?\\s*Stearns?\\s*&\\s*Co\\.?.*CONFIDENTIAL\\s+\\d+', '', text)",
        "re.sub(r'^\\s*CONFIDENTIAL\\s+\\d+\\s*$', '', text, flags=MULTILINE)",
        "re.sub(r'\\n\\s*\\d{1,3}\\s*$', '', text)  # trailing lone page number",
    ]))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 4 — PROMPTING STRATEGY
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("4", "Prompting Strategy & Claude Integration", s))
    story.append(sp(2))

    story.append(h2("Core Prompting Principles", s))
    principles = [
        ("Role injection", "Every prompt opens with 'You are a senior {sector} analyst.' "
         "This anchors Claude's persona to the specific investment strategy — a PE analyst "
         "and a Credit analyst should reach different verdicts on the same document."),
        ("Strategy lens injection", "The STRATEGY_LENS dict fields are injected inline into "
         "each prompt: focus, key_metrics, red_flags. The assessment prompt also uses "
         "verdict_criteria and key_questions. Chat injects all 6 fields."),
        ("Tone calibration", "The assessment prompt says: 'You just read this CIM on the "
         "train and are giving a 2-minute verbal briefing to a partner. Sound like a sharp "
         "senior associate — not a report.' This produces opinionated output, not boilerplate."),
        ("Hard length constraints", "All prompts embed explicit limits: 'MAX 2 sentences', "
         "'1 sentence', '2-3 sentences MAX'. This keeps JSON payloads small and responses "
         "action-oriented."),
        ("JSON-only output mandate", "Every prompt ends with 'Return ONLY valid JSON, no other "
         "text.' A code-fence stripper handles ```json wrappers. Conflict detection has a "
         "brace-depth salvage parser for truncated responses."),
        ("No hedging language", "Claims analysis prompt: 'Be direct — no hedging, no filler.' "
         "Rules explicitly say: 'If verified: state the corroborating evidence. If disputed: "
         "state exactly what conflicts and by how much.'"),
    ]
    for title, desc in principles:
        row = [[
            Paragraph(f"<b>{title}</b>", ParagraphStyle('pt', fontName='Helvetica-Bold',
                      fontSize=9, textColor=RED, leading=13)),
            Paragraph(desc, ParagraphStyle('pd', fontName='Helvetica', fontSize=9,
                                           textColor=DARK, leading=13)),
        ]]
        rt = Table(row, colWidths=[1.5*inch, 6.0*inch])
        rt.setStyle(TableStyle([
            ('TOPPADDING',    (0,0), (-1,-1), 6),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('LEFTPADDING',   (0,0), (-1,-1), 8),
            ('VALIGN',        (0,0), (-1,-1), 'TOP'),
            ('LINEBELOW',     (0,0), (-1,-1), 0.3, LGRAY),
        ]))
        story.append(rt)

    story.append(sp(3))
    story.append(h2("Claude Call Summary", s))
    claude_data = [
        ["Function", "Model", "Max Tokens", "Input Cap", "Purpose"],
        ["extract_claims()", "sonnet-4-5", "2,500", "15k chars", "Extract 6 key claims from primary doc"],
        ["analyze_claim() ×N", "sonnet-4-5", "800", "~1k (search results)", "Verdict per claim (runs concurrently)"],
        ["get_overall_assessment()", "sonnet-4-5", "1,500", "analyzed claims JSON", "IC brief: verdict, risks, questions"],
        ["extract_financial_charts_data()", "sonnet-4-5", "1,500", "15k chars", "Margin trend + deal scorecard"],
        ["find_cross_document_conflicts()", "sonnet-4-5", "4,000", "8k × N docs", "Contradiction scan across all docs"],
        ["extract_deal_profile()", "sonnet-4-5", "1,000", "assessment + 5k chars", "Comp search queries + deal profile"],
        ["extract_comps_from_search()", "sonnet-4-5", "3,500", "search results JSON", "Structured comp table + valuation"],
        ["Chat /chat endpoint", "sonnet-4-5", "not capped", "Full doc text", "Q&A with inline charts + citations"],
    ]
    story.append(make_table(claude_data, [1.85*inch, 0.95*inch, 0.85*inch, 1.15*inch, 2.7*inch]))

    story.append(sp(3))
    story.append(h2("Claim Extraction Prompt (Annotated)", s))
    story.append(CodeBlock([
        '# Role + strategy context',
        '"You are a senior {sector} analyst doing a first-pass on a CIM."',
        '"Investment strategy: {sector}"',
        '"Analysis focus: {lens[focus]}"          # PE vs Credit vs VC vs RE',
        '"Key metrics to prioritize: {lens[key_metrics]}"',
        '"Red flags to watch for: {lens[red_flags]}"',
        '',
        '# Hard constraint on quantity + quality bar',
        '"Extract the 6 MOST IMPACTFUL verifiable claims"',
        '"— the ones that would actually change whether you pursue this deal."',
        '',
        '# Priority ordering (forces correct ranking)',
        '"1. Revenue / EBITDA / margin claims with specific numbers"',
        '"2. Market size and growth rate claims"',
        '"3. Competitive position claims (market share, named moat)"',
        '"4. Customer concentration claims"',
        '"5. Key operational metrics relevant to the strategy above"',
        '',
        '# Explicit exclusion list',
        '"Skip: vague qualitative statements, mission statements, aspirational language"',
        '',
        '# JSON schema enforcement',
        '"Return ONLY a valid JSON array, no other text:"',
        '[ { "id": 1, "claim": "...", "page": 1, "category": "...",',
        '    "verifiable": true, "why_it_matters": "..." } ]',
    ]))

    story.append(sp(3))
    story.append(h2("Assessment Prompt Tone Calibration", s))
    story.append(CodeBlock([
        '"You are a senior Sagard {sector} analyst. You just read this CIM on',
        ' the train and are giving a 2-minute verbal briefing to a partner.',
        ' Be direct, specific, no fluff. Sound like a sharp senior associate',
        ' — not a report."',
        '',
        '"Verdict criteria: {lens[verdict_criteria]}"',
        '# PE: "Would this generate 20%+ IRR in a 5-year hold?"',
        '# Credit: "Can this company service the debt through a downturn?"',
        '# VC: "Can this be a $1B+ outcome? Is the team exceptional?"',
        '# RE: "Does the yield justify the risk? Downside if occupancy drops 20%?"',
    ]))

    story.append(sp(3))
    story.append(h2("Chat System Prompt — Page Citation Architecture", s))
    story.append(body(
        "The <b>/chat</b> system prompt has a dedicated section explaining the citation system. "
        "This is necessary because financial documents have two competing page number systems:", s))
    for b_text in [
        "Physical PDF pages (what the viewer shows) — labeled PAGE X OF Y in extracted text",
        "Internal printed page numbers (slide 1, CONFIDENTIAL 19) — these are noise",
    ]:
        story.append(bullet(b_text, s))
    story.append(sp(1))
    story.append(CodeBlock([
        '# From the chat system prompt:',
        '"CRITICAL: This document contains printed footer text such as"',
        '" \\"CONFIDENTIAL 19\\" or \\"Bear Stearns & Co. Inc. CONFIDENTIAL 23\\"."',
        '" These are confidentiality labels — NOT page numbers."',
        '" NEVER cite these printed footer numbers as page references."',
        '',
        '"For PDF documents: cite by page: [[Page X, ExactDocumentName]]"',
        '"For Excel spreadsheets: cite by sheet: [[Sheet: SheetName, ExactDocumentName]]"',
        '"Never use generic names like \\"CIM\\" or \\"the document\\"."',
    ]))

    story.append(sp(3))
    story.append(h2("Inline Chart Rendering in Chat", s))
    story.append(body(
        "The chat system prompt embeds the full JSON schema for 8 chart types. Claude can insert "
        "<b>CHART:{...}</b> blocks anywhere in its response. The frontend parses them with a regex "
        "and renders inline using Recharts:", s))
    chart_types = [
        ["Type", "Use Case", "Key Config Fields"],
        ["line", "Trends over time (revenue, margin)", "xKey, lines[{key, color, label}]"],
        ["bar", "Cross-category comparisons", "xKey, bars[{key, color, label}]"],
        ["radar", "Deal scorecard (multi-dimension)", "angleKey, valueKey, maxValue"],
        ["pie", "Composition / segment breakdown", "colors[], valueLabel"],
        ["area", "Cumulative trends or ranges", "xKey, areas[{key, color, label}]"],
        ["scatter", "Relationship between two variables", "xKey, yKey, labelKey"],
        ["waterfall", "EBITDA bridge / cash flow build", "positiveColor, negativeColor, subtotalColor"],
        ["combo", "Revenue bars + margin line (dual axis)", "bars[], lines[], leftAxisLabel, rightAxisLabel"],
    ]
    story.append(make_table(chart_types, [0.7*inch, 2.2*inch, 4.6*inch]))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 5 — CONFLICT DETECTION
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("5", "Cross-Document Conflict Detection", s))
    story.append(sp(2))

    story.append(h2("How It Works", s))
    story.append(body(
        "<b>find_cross_document_conflicts()</b> assembles all document texts — each truncated to "
        "<b>8,000 chars</b> — into a single Claude prompt. One call sees every document simultaneously "
        "and is tasked with finding every numerical and narrative contradiction.", s))

    story.append(sp(2))
    story.append(h2("What Claude Looks For", s))

    cols = [[
        Paragraph("<b>NUMERICAL (any mismatch flagged)</b>", ParagraphStyle('nh', fontName='Helvetica-Bold',
                  fontSize=9, textColor=white, leading=13)),
        Paragraph("<b>NARRATIVE (direct contradictions)</b>", ParagraphStyle('nh2', fontName='Helvetica-Bold',
                  fontSize=9, textColor=white, leading=13)),
    ]]
    ct = Table(cols, colWidths=[3.75*inch, 3.75*inch])
    ct.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), NAVY),
        ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 10), ('GRID', (0,0), (-1,-1), 0.3, GRAY),
    ]))
    story.append(ct)

    num_items = [
        "Revenue figures (LTM, projected, historical)",
        "EBITDA and EBITDA margins",
        "Key operational metrics (units, headcount, capacity)",
        "Market growth rates and size estimates",
        "CapEx totals and project budgets",
        "Customer/tenant concentration percentages",
    ]
    narr_items = [
        "Competitive positioning described differently",
        "Market share claims that conflict",
        "Timeline or milestone dates that don't align",
        "Strategy/product descriptions that contradict",
        "Management team descriptions that differ",
        "Exit strategy framing inconsistencies",
    ]
    detail_rows = [[
        Paragraph("<br/>".join(f"• {i}" for i in num_items),
                  ParagraphStyle('ni', fontName='Helvetica', fontSize=8.5,
                                 textColor=DARK, leading=14, leftIndent=5)),
        Paragraph("<br/>".join(f"• {i}" for i in narr_items),
                  ParagraphStyle('nri', fontName='Helvetica', fontSize=8.5,
                                 textColor=DARK, leading=14, leftIndent=5)),
    ]]
    dt = Table(detail_rows, colWidths=[3.75*inch, 3.75*inch])
    dt.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), XGRAY),
        ('TOPPADDING', (0,0), (-1,-1), 8), ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 8), ('GRID', (0,0), (-1,-1), 0.3, LGRAY),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ]))
    story.append(dt)

    story.append(sp(2))
    story.append(h2("Severity Levels", s))
    sev_data = [
        ["Severity", "Definition", "Example"],
        ["HIGH", "Any numerical discrepancy on a material figure, or direct contradiction on the investment thesis",
         "CIM shows EBITDA $45M; financial model shows $38M"],
        ["MEDIUM", "Minor numerical difference (<10%) or meaningfully different framing of a material claim",
         "CIM says '35% market share'; mgmt presentation says '~30%'"],
        ["LOW", "Different level of detail or emphasis; not necessarily contradictory",
         "CIM lists 5 key customers; data room only mentions 3 by name"],
    ]
    st = Table(sev_data, colWidths=[0.7*inch, 3.8*inch, 3.0*inch])
    st.setStyle(TableStyle([
        ('BACKGROUND',  (0,0), (-1,0), NAVY),
        ('TEXTCOLOR',   (0,0), (-1,0), white),
        ('FONTNAME',    (0,0), (-1,0), 'Helvetica-Bold'),
        ('BACKGROUND',  (0,1), (0,1), HexColor("#fdf2f2")),
        ('BACKGROUND',  (0,2), (0,2), HexColor("#fffbeb")),
        ('BACKGROUND',  (0,3), (0,3), XGRAY),
        ('FONTNAME',    (0,1), (0,-1), 'Helvetica-Bold'),
        ('TEXTCOLOR',   (0,1), (0,1), RED),
        ('TEXTCOLOR',   (0,2), (0,2), AMBER),
        ('TEXTCOLOR',   (0,3), (0,3), GRAY),
        ('FONTNAME',    (1,1), (-1,-1), 'Helvetica'),
        ('FONTSIZE',    (0,0), (-1,-1), 8.5),
        ('GRID',        (0,0), (-1,-1), 0.3, LGRAY),
        ('VALIGN',      (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING',  (0,0), (-1,-1), 6),
        ('BOTTOMPADDING',(0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(st)

    story.append(sp(2))
    story.append(h2("Citation Format by Document Type", s))
    story.append(body(
        "The prompt distinguishes how citations should be formatted depending on file type:", s))
    story.append(CodeBlock([
        "# PDF / PowerPoint:",
        "  [[Page 27, American-casinos-CIM.pdf]]",
        "",
        "# Excel (sheet name, not page number):",
        "  [[Sheet: P&L Summary, ACEP_Financial_Model.xlsx]]",
        "  [[Sheet: Debt Schedule, ACEP_Financial_Model.xlsx]]",
        "",
        "# In CrossDocumentConflict type:",
        "  page1: int | null   # null signals Excel document",
        "  page2: int | null",
    ]))

    story.append(sp(2))
    story.append(h2("Fallback JSON Parser", s))
    story.append(body(
        "The conflict response can be long enough to occasionally truncate. "
        "Rather than discarding the response on json.loads() failure, a brace-depth parser "
        "recovers all complete JSON objects from the partial string:", s))
    story.append(CodeBlock([
        "depth, start, salvaged = 0, None, []",
        "for i, ch in enumerate(text):",
        "    if ch == '{':                        # entering an object",
        "        if depth == 0: start = i",
        "        depth += 1",
        "    elif ch == '}':",
        "        depth -= 1",
        "        if depth == 0 and start is not None:",
        "            try:",
        "                salvaged.append(json.loads(text[start:i+1]))",
        "            except json.JSONDecodeError:",
        "                pass",
        "return salvaged                          # partial results > nothing",
    ]))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 6 — CLAIM VERIFICATION
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("6", "Claim Verification with Tavily", s))
    story.append(sp(2))

    story.append(h2("Verification Flow", s))
    flow_steps = [
        ("1", "Claim text", "String extracted from CIM (e.g. 'Revenue grew at 15% CAGR 2019-2023')"),
        ("2", "search_claim()", "POST to api.tavily.com/search — search_depth='basic', max_results=3. Returns title, url, content[:300]"),
        ("3", "analyze_claim()", "Claude receives claim + why_it_matters + sector lens + 3 search results. Returns structured verdict"),
        ("4", "Merged result", "{**claim, **analysis} — original claim fields + verdict, explanation, sources, confidence, materiality, diligence_question"),
    ]
    for step, func, desc in flow_steps:
        row = [[
            Paragraph(step, ParagraphStyle('fn', fontName='Helvetica-Bold', fontSize=11,
                      textColor=white, alignment=TA_CENTER, leading=14)),
            Paragraph(f"<b>{func}</b>", ParagraphStyle('ff', fontName='Helvetica-Bold', fontSize=9,
                      textColor=NAVY, leading=13)),
            Paragraph(desc, ParagraphStyle('fd', fontName='Helvetica', fontSize=8.5,
                      textColor=DARK, leading=13)),
        ]]
        rt = Table(row, colWidths=[0.4*inch, 1.4*inch, 5.7*inch])
        rt.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (0,-1), RED),
            ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('LEFTPADDING', (0,0), (-1,-1), 8), ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('LINEBELOW', (0,0), (-1,-1), 0.4, LGRAY),
        ]))
        story.append(rt)
        story.append(sp(1))

    story.append(sp(2))
    story.append(h2("Verdict Categories", s))
    verd_data = [
        ["Verdict", "Meaning", "Prompt Instruction for Claude"],
        ["verified", "Search evidence corroborates the claim",
         "State the corroborating evidence and source. Be specific about what matches."],
        ["disputed", "Search evidence contradicts the claim",
         "State exactly what conflicts and by how much. Name the specific discrepancy."],
        ["unverifiable", "Cannot be externally checked",
         "One sentence on why it can't be checked; one sentence on what analyst should do about it."],
    ]
    vt = Table(verd_data, colWidths=[0.9*inch, 1.8*inch, 4.8*inch])
    vt.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), NAVY), ('TEXTCOLOR', (0,0), (-1,0), white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'), ('FONTSIZE', (0,0), (-1,-1), 8.5),
        ('BACKGROUND', (0,1), (0,1), BGGRN), ('TEXTCOLOR', (0,1), (0,1), GREEN),
        ('FONTNAME', (0,1), (0,1), 'Helvetica-Bold'),
        ('BACKGROUND', (0,2), (0,2), BGAMB), ('TEXTCOLOR', (0,2), (0,2), AMBER),
        ('FONTNAME', (0,2), (0,2), 'Helvetica-Bold'),
        ('BACKGROUND', (0,3), (0,3), BGRED), ('TEXTCOLOR', (0,3), (0,3), RED),
        ('FONTNAME', (0,3), (0,3), 'Helvetica-Bold'),
        ('FONTNAME', (1,1), (-1,-1), 'Helvetica'),
        ('GRID', (0,0), (-1,-1), 0.3, LGRAY),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(vt)

    story.append(sp(2))
    story.append(h2("Confidence Scoring (1–5)", s))
    conf_data = [
        ["Score", "Meaning"],
        ["1", "No external data found — claim is inherently private or too specific"],
        ["2", "Tangentially related results only — weak signal"],
        ["3", "Directionally supported — results align with general claim direction"],
        ["4", "Substantially corroborated — strong supporting evidence"],
        ["5", "Strong, direct corroboration from reliable sources"],
    ]
    cft = Table(conf_data, colWidths=[0.5*inch, 7.0*inch])
    cft.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), NAVY), ('TEXTCOLOR', (0,0), (-1,0), white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'), ('FONTSIZE', (0,0), (-1,-1), 8.5),
        ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [white, XGRAY]),
        ('GRID', (0,0), (-1,-1), 0.3, LGRAY),
        ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(cft)

    story.append(sp(2))
    story.append(h2("Why search_depth='basic' (Not 'advanced')", s))
    story.append(InfoBox(
        "Design trade-off: 'basic' is faster and cheaper. 'advanced' would give better recall "
        "for obscure financial claims but adds ~2-3 seconds per claim. With 6 claims running "
        "concurrently, basic adds ~1-2s total vs advanced adding ~3-5s. For a first-pass screen, "
        "basic is the right call. For deep diligence, the claim verification step should use advanced "
        "with a longer content snippet (currently capped at 300 chars).", 'info'))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 7 — STRATEGY LENS
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("7", "The Strategy Lens System", s))
    story.append(sp(2))

    story.append(body(
        "The <b>STRATEGY_LENS</b> dictionary in <b>main.py</b> is a central design element. "
        "It routes all analytical prompts through the correct investment framework. "
        "Every Claude call that returns user-visible content is parameterized by this dict.", s))

    story.append(sp(2))
    story.append(h2("The Four Strategies — Field by Field", s))

    strategies = [
        ("Private Equity", RED, [
            ("focus", "LBO returns, EBITDA growth trajectory, management quality, competitive moat, exit multiple expansion potential"),
            ("key_metrics", "EBITDA margins, revenue growth CAGR, CapEx intensity, working capital, leverage capacity"),
            ("red_flags", "Customer concentration, management turnover, declining margins, covenant-heavy balance sheet, cyclical exposure"),
            ("verdict_criteria", "Would this generate 20%+ IRR in a 5-year hold? Is there a credible value creation thesis beyond financial engineering?"),
            ("questions_focus", "Management incentives, add-on acquisition pipeline, margin improvement levers, exit options"),
            ("conflict_focus", "Revenue and EBITDA figures, margin trends, CapEx projections, customer concentration percentages"),
        ]),
        ("Private Credit", TEAL, [
            ("focus", "Debt service coverage, downside protection, asset coverage, covenant structure, refinancing risk"),
            ("key_metrics", "DSCR, interest coverage ratio, leverage ratio, free cash flow conversion, asset coverage ratio"),
            ("red_flags", "Deteriorating coverage ratios, covenant-lite structure, single asset concentration, cyclical cash flows"),
            ("verdict_criteria", "Can this company service the debt through a downturn? What's the recovery value if it can't?"),
            ("questions_focus", "Covenant package, security structure, refinancing timeline, stress case cash flows, intercreditor arrangements"),
            ("conflict_focus", "Cash flow figures, leverage ratios, debt capacity claims, coverage ratios, collateral valuations"),
        ]),
        ("Venture Capital", HexColor("#7c3aed"), [
            ("focus", "Market size, growth rate, founder quality, product differentiation, path to profitability"),
            ("key_metrics", "ARR growth, net revenue retention, CAC/LTV ratio, burn multiple, gross margins"),
            ("red_flags", "Slowing growth, high burn with no path to profitability, weak retention, crowded market, founder conflicts"),
            ("verdict_criteria", "Can this be a $1B+ outcome? Is the team exceptional? Is the market timing right?"),
            ("questions_focus", "Competitive differentiation, go-to-market efficiency, key person risk, next funding milestone"),
            ("conflict_focus", "ARR and growth rate figures, user or customer counts, burn rate and runway, TAM estimates"),
        ]),
        ("Real Estate", HexColor("#065f46"), [
            ("focus", "NOI stability, cap rate, occupancy trends, debt service coverage, market dynamics"),
            ("key_metrics", "Cap rate, NOI yield, DSCR, occupancy rate, rent per square foot, vacancy rate"),
            ("red_flags", "Tenant concentration, lease expiry clustering, deferred maintenance, market oversupply, floating rate exposure"),
            ("verdict_criteria", "Does the yield justify the risk? What's the downside if occupancy drops 20%?"),
            ("questions_focus", "Lease terms, tenant quality, market comparable rents, capital expenditure needs, exit cap rate assumptions"),
            ("conflict_focus", "NOI figures, occupancy rates, cap rates, rent per square foot, lease term lengths, property valuations"),
        ]),
    ]

    for strat_name, color, fields in strategies:
        header_row = [[Paragraph(f"<b>{strat_name.upper()}</b>",
                                  ParagraphStyle('sh', fontName='Helvetica-Bold', fontSize=10,
                                                 textColor=white, leading=14))]]
        ht = Table(header_row, colWidths=[7.5*inch])
        ht.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), color),
            ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('LEFTPADDING', (0,0), (-1,-1), 10),
        ]))
        story.append(ht)
        field_rows = [[
            Paragraph(f"<b>{f}</b>", ParagraphStyle('fk', fontName='Helvetica-Bold', fontSize=8.5,
                      textColor=GRAY, leading=13)),
            Paragraph(v, ParagraphStyle('fv', fontName='Helvetica', fontSize=8.5,
                      textColor=DARK, leading=13)),
        ] for f, v in fields]
        ft = Table(field_rows, colWidths=[1.3*inch, 6.2*inch])
        ft.setStyle(TableStyle([
            ('ROWBACKGROUNDS', (0,0), (-1,-1), [white, XGRAY]),
            ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5),
            ('LEFTPADDING', (0,0), (-1,-1), 8), ('RIGHTPADDING', (0,0), (-1,-1), 8),
            ('GRID', (0,0), (-1,-1), 0.3, LGRAY),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ]))
        story.append(ft)
        story.append(sp(2))

    story.append(sp(1))
    story.append(h2("How the Lens Changes Each Step", s))
    lens_impact = [
        ["Step", "How Lens Changes Behavior"],
        ["Claim extraction", "PE: EBITDA & CapEx priority. Credit: coverage ratios & covenants. VC: ARR & burn. RE: NOI & occupancy"],
        ["Individual claim analysis", "Red flags are strategy-specific — declining margins kill PE thesis; covenant-lite kills Credit thesis"],
        ["Overall assessment", "verdict_criteria is the core question — PE asks IRR, Credit asks debt service, VC asks $1B outcome"],
        ["Conflict detection", "conflict_focus field tells Claude which numbers to scrutinize most — EBITDA for PE, leverage ratios for Credit"],
        ["Chat Q&A", "All 6 fields injected into system prompt — even unsolicited analysis applies the right lens"],
    ]
    story.append(make_table(lens_impact, [1.4*inch, 6.1*inch]))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 8 — COMPS
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("8", "Comparable Transactions (COMPS) Feature", s))
    story.append(sp(2))

    story.append(h2("Three-Step COMPS Pipeline", s))
    comps_steps = [
        ("Step 1", "extract_deal_profile()", "Claude reads the assessment + first 5k chars of doc. Extracts: sector, sub-sector, description, revenue_millions, ebitda_millions, ebitda_margin_pct, geography, business_model. Also generates exactly 4 targeted Tavily search queries designed like a banker searching for comp data."),
        ("Step 2", "run_comps_searches()", "4 sequential Tavily searches (max_results=5 each, content[:600]). Aggregates all results into a flat list with the originating query attached. Total: up to 20 raw search results."),
        ("Step 3", "extract_comps_from_search()", "Claude (max_tokens=3,500) extracts: comps[] with EV, EV/EBITDA, EV/Revenue, why_comparable, key_difference; sector_context with multiple ranges; this_deal_positioning; valuation_context (2-3 paragraph pitch-book quality write-up); data_quality_note."),
    ]
    for step, func, desc in comps_steps:
        row = [[
            Paragraph(f"<b>{step}</b>", ParagraphStyle('cs', fontName='Helvetica-Bold',
                      fontSize=9, textColor=white, alignment=TA_CENTER, leading=13)),
            Paragraph(f"<b>{func}</b>", ParagraphStyle('cf', fontName='Helvetica-Bold',
                      fontSize=9, textColor=NAVY, leading=13)),
            Paragraph(desc, ParagraphStyle('cd', fontName='Helvetica', fontSize=8.5,
                      textColor=DARK, leading=13)),
        ]]
        rt = Table(row, colWidths=[0.6*inch, 1.6*inch, 5.3*inch])
        rt.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (0,-1), TEAL),
            ('TOPPADDING', (0,0), (-1,-1), 7), ('BOTTOMPADDING', (0,0), (-1,-1), 7),
            ('LEFTPADDING', (0,0), (-1,-1), 8), ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('LINEBELOW', (0,0), (-1,-1), 0.4, LGRAY),
        ]))
        story.append(rt)
        story.append(sp(1))

    story.append(sp(2))
    story.append(h2("Why COMPS Fires Async After /analyze", s))
    story.append(body(
        "COMPS adds ~30-60 seconds. Blocking /analyze on it would double perceived wait time. "
        "Instead, the frontend calls <b>POST /comps</b> immediately after receiving /analyze results, "
        "passing the assessment JSON as a form field. The UI shows the COMPS tab loading "
        "while the rest of the analysis is already displayed.", s))

    story.append(sp(2))
    story.append(h2("Data Quality Safeguard", s))
    story.append(InfoBox(
        "The COMPS prompt includes an explicit skepticism instruction: 'Be skeptical — if a transaction "
        "isn't clearly documented in the results, exclude it entirely. Better 3 confirmed comps than 8 "
        "speculative ones.' The output always includes a data_quality_note field telling analysts to "
        "verify with PitchBook, CapIQ, or Bloomberg before using in any IC memo.", 'warn'))

    story.append(sp(2))
    story.append(h2("Search Query Design", s))
    story.append(body(
        "Claude generates 4 queries designed to surface real M&A transaction data. "
        "The prompt gives examples of good queries to guide the format:", s))
    story.append(CodeBlock([
        '"regional casino acquisition enterprise value EBITDA multiple 2022 2023 2024"',
        '"gaming hospitality private equity buyout deal value 2023 2024"',
        '"casino resort sold acquisition announced deal price millions"',
        '"comparable transactions regional gaming M&A EV EBITDA leveraged buyout"',
        "",
        "# Note: queries are sector-specific — a SaaS deal would generate completely",
        "# different queries focused on ARR multiples and strategic acquirers",
    ]))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 9 — FRONTEND
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("9", "Frontend Architecture & State Management", s))
    story.append(sp(2))

    story.append(h2("Key TypeScript Interfaces", s))
    story.append(CodeBlock([
        "interface Claim {",
        "  id: number; claim: string; page: number; category: string;",
        "  verifiable: boolean;",
        "  verdict: 'verified' | 'disputed' | 'unverifiable';",
        "  explanation: string; sources: Source[]; confidence: number;",
        "  materiality: 'high' | 'medium' | 'low';",
        "  why_it_matters: string; diligence_question: string;",
        "}",
        "",
        "interface Assessment {",
        "  overall_verdict: 'Worth deeper look' | 'Borderline' | 'Pass';",
        "  company_snapshot: string; sellers_narrative: string;",
        "  narrative_holds_up: { holds: boolean; explanation: string };",
        "  reasoning: string;",
        "  criteria_fit?: { fits: boolean; explanation: string };",
        "  top_risks: string[]; bull_case: string; key_questions: string[];",
        "  summary_stats: { verified: number; disputed: number; unverifiable: number };",
        "}",
        "",
        "interface CrossDocumentConflict {",
        "  doc1: string; doc2: string; claim1: string; claim2: string;",
        "  severity: 'high' | 'medium' | 'low';",
        "  explanation: string; page1?: number | null; page2?: number | null;",
        "}",
    ]))

    story.append(sp(2))
    story.append(h2("Key Components", s))
    comp_data = [
        ["Component / Function", "Purpose"],
        ["UploadZone", "Drag-and-drop file upload (react-dropzone), sector selector, investment criteria fields, animated loading progress with LOADING_STEPS"],
        ["ExcelViewer", "Renders Excel workbooks with sheet tabs; highlights green [[Sheet: X, Doc]] citations; exposes window.jumpToSheet global"],
        ["PDF Viewer (react-pdf)", "Inline PDF rendering with react-pdf; page navigation synced to claim citations"],
        ["Chat panel", "Multi-turn Q&A with conversation history; parses CHART:{...} blocks and renders inline Recharts components"],
        ["COMPS tab", "Shows comp table, sector context, valuation context write-up, deal positioning; loads async after analysis"],
        ["HomeView", "Deal list from Supabase sorted by updated_at; verdict pills; loads/deletes deals; handles no-Supabase gracefully"],
        ["CollapsibleSection", "Reusable accordion component for Claims, Conflicts, Risks sections"],
    ]
    story.append(make_table(comp_data, [1.8*inch, 5.7*inch]))

    story.append(sp(2))
    story.append(h2("Loading State Architecture", s))
    story.append(body(
        "LOADING_STEPS array drives a step-by-step progress UI with animated dots:", s))
    story.append(CodeBlock([
        'const LOADING_STEPS = [',
        '  "Extracting document text",',
        '  "Identifying key claims",',
        '  "Verifying market data",',
        '  "Running cross-document analysis",',
        '  "Generating assessment",',
        '  "Building comparable transactions",',
        '];',
        '',
        '// loadingStep state increments as each backend step completes',
        '// Steps marked Done (green) vs Running (red dot pulse)',
    ]))

    story.append(sp(2))
    story.append(h2("IndexedDB File Caching", s))
    story.append(body(
        "Files uploaded to the deal are cached in IndexedDB so page refresh doesn't lose them. "
        "Three functions manage the lifecycle:", s))
    story.append(CodeBlock([
        "saveFilesToIDB(dealId, files[])   // serializes File → ArrayBuffer, stores by dealId",
        "loadFilesFromIDB(dealId)          // reconstructs File objects from ArrayBuffer",
        "deleteFilesFromIDB(dealId)        // called on deal delete",
        "",
        "const IDB_NAME  = 'cim-deal-files'",
        "const IDB_STORE = 'files'         // single object store, keyed by dealId",
    ]))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 10 — PERSISTENCE
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("10", "Data Persistence — Supabase + IndexedDB", s))
    story.append(sp(2))

    story.append(h2("Supabase Schema (4 Tables)", s))
    schema_data = [
        ["Table", "Key Columns", "Notes"],
        ["deals", "id (uuid), name, sector, status, verdict, created_at, updated_at",
         "Top-level deal record. verdict nullable — set after analysis"],
        ["deal_documents", "id, deal_id (FK), filename, file_type, extracted_text (text), uploaded_at",
         "Upserted by (deal_id, filename) — re-analysis overwrites, doesn't duplicate"],
        ["deal_analyses", "id, deal_id (FK), assessment (jsonb), claims (jsonb), conflicts (jsonb), charts_data (jsonb), comps_data (jsonb)",
         "One row per deal (update on re-analysis). All Claude output stored as JSONB"],
        ["deal_chat_messages", "id, deal_id (FK), role, content, segments (jsonb), timestamp, created_at",
         "Append-only. Loaded in order for chat history reconstruction"],
    ]
    story.append(make_table(schema_data, [1.5*inch, 2.6*inch, 3.4*inch]))

    story.append(sp(2))
    story.append(h2("useDealPersistence Hook Functions", s))
    hook_data = [
        ["Function", "Operation", "Key Detail"],
        ["loadDeals()", "SELECT * FROM deals ORDER BY updated_at DESC", "Returns [] if Supabase not configured"],
        ["loadDeal(id)", "3 parallel queries: documents + analysis + chat", "Uses Promise.all for concurrent fetching"],
        ["createDeal(name, sector)", "INSERT INTO deals", "Returns Deal | null; null if no Supabase"],
        ["saveDeal(id, updates)", "UPDATE deals SET ..., updated_at=now()", "Wrapped in safe() — never throws"],
        ["saveDocument(id, filename, type, text)", "UPSERT on (deal_id, filename)", "Prevents duplicates on re-analysis"],
        ["saveAnalysis(id, ...)", "INSERT or UPDATE deal_analyses", "Checks for existing row first"],
        ["saveChatMessage(id, msg)", "INSERT INTO deal_chat_messages", "Includes segments (chart data) and timestamp"],
        ["deleteDeal(id)", "Delete child rows first, then deals row", "Cascade: chat → analyses → documents → deal"],
    ]
    story.append(make_table(hook_data, [1.8*inch, 2.4*inch, 3.3*inch]))

    story.append(sp(2))
    story.append(h2("safe() Wrapper Pattern", s))
    story.append(CodeBlock([
        "const safe = useCallback(async (fn: () => Promise<void>) => {",
        "  if (!supabase) return;                    // Supabase not configured — skip silently",
        "  try {",
        "    await fn();",
        "  } catch (err) {",
        "    console.error('[DealPersistence]', err);",
        "    setSaveError(true);                     // show error indicator for 3s",
        "    setTimeout(() => setSaveError(false), 3000);",
        "  }",
        "}, []);",
        "",
        "// Philosophy: DB persistence should never crash the UI.",
        "// Analysis results are still shown even if save fails.",
    ]))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 11 — INTERVIEW Q&A
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("11", "Common Interview Questions & Model Answers", s))
    story.append(sp(2))

    story.append(h2("Architecture & Design Questions", s))

    qas_arch = [
        (
            "Walk me through what happens from the moment a user clicks 'Analyze' to seeing results.",
            [
                "Frontend POSTs multipart form to /analyze with files + sector + criteria. FastAPI reads all files, routes PDFs to pdfplumber and Excel to openpyxl.",
                "Extracted text gets PAGE X OF Y markers stripped of footer noise. First 15k chars go to Claude for claim extraction — 6 high-impact verifiable claims come back as JSON.",
                "All claims fire concurrently via ThreadPoolExecutor(max_workers=6): each gets Tavily-searched then Claude-analyzed for verdict/confidence/materiality.",
                "Assessment and chart data run in parallel (another ThreadPoolExecutor). Then cross-doc conflict scan fires if multiple files were uploaded.",
                "Response returns to frontend. Frontend immediately fires POST /comps in background. UI renders analysis while comps loads async.",
            ]
        ),
        (
            "Why is the backend a single file? How would you structure it for production?",
            [
                "Single file was an intentional choice for rapid prototyping speed and deployment simplicity — one file to deploy, zero circular imports.",
                "For production I'd split into: routers/ (analyze.py, comps.py, chat.py, extract.py), services/ (claude_service.py, tavily_service.py, document_service.py), models/ (schemas.py), and core/ (config.py, dependencies.py).",
                "I'd add proper dependency injection for the Claude client and Tavily config, and pytest fixtures for unit-testing each service in isolation.",
            ]
        ),
        (
            "Why use ThreadPoolExecutor with asyncio instead of an async Claude client?",
            [
                "The Anthropic Python SDK and requests library are synchronous. FastAPI is async. You can't await a sync call without blocking the event loop.",
                "run_in_executor() offloads the blocking call to a thread pool, then asyncio.gather() collects all threads simultaneously. This is the correct pattern for sync-in-async.",
                "The better long-term solution is anthropic.AsyncAnthropic + httpx for Tavily — pure async, no thread overhead. I'd refactor to that for production.",
            ]
        ),
        (
            "How does the page citation system work, and why was it needed?",
            [
                "CIMs often have two page numbering systems: physical PDF pages (what the viewer shows) and internal printed numbers like slide '5' on PDF page 18.",
                "Three-layer solution: (1) clean_page_text() strips CONFIDENTIAL footers via regex before extraction; (2) extract_pdf_text() wraps each page in PAGE X OF Y markers; (3) every prompt tells Claude to ONLY use those markers for citations.",
                "Without this, Claude would confidently cite 'CONFIDENTIAL 19' as page 19, which would point the user to the wrong place in the PDF viewer.",
            ]
        ),
    ]

    for q, answers in qas_arch:
        for flow in q_and_a(q, answers, s):
            story.append(flow)

    story.append(sp(2))
    story.append(h2("AI / LLM Design Questions", s))

    qas_ai = [
        (
            "How do you prevent Claude from hallucinating in the claims verification?",
            [
                "Claude doesn't verify against its own knowledge — it only assesses claims against the Tavily search results that are injected into the prompt. This grounds it in retrieved evidence.",
                "The prompt explicitly forbids hedging: 'Be direct. If disputed, state exactly what conflicts and by how much.' This forces specificity over vague qualifications.",
                "The confidence score (1-5) is calibrated: '1 = no external data, 3 = directional, 5 = strong corroboration.' Claude is instructed to be honest — 'don't default to 3.'",
                "For COMPS, the prompt says 'Better 3 confirmed comps than 8 speculative ones' and mandates a data_quality_note telling analysts to verify with PitchBook/Bloomberg.",
            ]
        ),
        (
            "How does the strategy lens actually change what Claude does?",
            [
                "The STRATEGY_LENS dict has 6 fields per strategy injected into prompts. The most important is verdict_criteria — PE asks about 20% IRR, Credit asks about debt service through a downturn, VC asks about $1B outcome.",
                "Claim extraction priorities change: PE focuses on EBITDA and CapEx, Credit on coverage ratios, VC on ARR and burn multiple, RE on NOI and occupancy.",
                "Conflict detection focus changes: PE scrutinizes EBITDA and margins; Credit scrutinizes leverage ratios and cash flows; VC scrutinizes ARR figures.",
                "The chat system prompt injects all 6 fields so even unsolicited analysis applies the right lens — a Credit analyst asking about cash flow gets covenant and coverage ratio framing, not a generic EBITDA discussion.",
            ]
        ),
        (
            "What would you do about prompt injection attacks — malicious content in uploaded PDFs?",
            [
                "Currently there is no sanitization layer — an adversarially crafted PDF could try to override Claude's instructions.",
                "Mitigation: add input sanitization that strips common injection patterns (e.g. 'Ignore previous instructions') from extracted text before feeding to Claude. Also use system prompts (not user messages) for instructions, which Claude is more resistant to overriding.",
                "For production at a financial firm, I'd also add a pre-processing step that flags documents with unusual instruction-like text before they hit the LLM.",
            ]
        ),
        (
            "How would you add prompt caching to reduce cost?",
            [
                "The document text is the biggest token cost — it's sent in every chat message. Claude's prompt caching (cache_control: ephemeral) would cache the document text portion across turns.",
                "Implementation: split the messages array into a cached system block (document text) and a non-cached block (chat history). The first call incurs full cost; subsequent turns within the cache TTL are ~90% cheaper.",
                "For /analyze, the primary document text is used in 3 separate calls (claims, assessment, charts). With prompt caching, you'd pay full price once and get cache hits on the other two.",
            ]
        ),
        (
            "How do you handle JSON parsing failures from Claude?",
            [
                "All Claude calls end with 'Return ONLY valid JSON, no other text.' A code-fence stripper handles markdown wrapper cases.",
                "For cross-document conflicts (the largest response), there's a custom brace-depth salvage parser that recovers complete JSON objects from a truncated array.",
                "The right solution going forward is Claude's native tool-use / structured output mode — it guarantees valid JSON schema compliance at the API level, eliminating all parsing fragility.",
            ]
        ),
    ]

    for q, answers in qas_ai:
        for flow in q_and_a(q, answers, s):
            story.append(flow)

    story.append(PageBreak())

    story.append(h2("Product & Domain Questions", s))

    qas_prod = [
        (
            "Who is the primary user and what problem does this solve for them?",
            [
                "A junior analyst or associate at Sagard (or any PE/credit firm) who receives 5-10 CIMs per week. They spend 2-4 hours on a first-pass screen before deciding whether to spend real time on a deal.",
                "The tool compresses that 2-4 hour first-pass to ~5 minutes: key claims extracted and verified, red flags surfaced, IC brief generated, conflicts between data room documents flagged automatically.",
                "The strategy lens ensures the tool thinks like a PE investor, not like a generic AI summarizer. The output is designed to be directly usable in a deal team conversation.",
            ]
        ),
        (
            "What investment strategies does this support, and how does that work technically?",
            [
                "Four strategies: Private Equity, Private Credit, Venture Capital, Real Estate. Selected by dropdown before upload.",
                "Technically, the sector string is passed to every backend function and used to look up the STRATEGY_LENS dict. Six prompt fields are then injected: focus, key_metrics, red_flags, verdict_criteria, questions_focus, conflict_focus.",
                "The verdict_criteria field is the most impactful — it defines the single core question Claude uses to decide Worth deeper look / Borderline / Pass. These are fundamentally different questions for each strategy.",
            ]
        ),
        (
            "How does the COMPS feature work and what are its limitations?",
            [
                "Claude generates 4 targeted search queries based on deal profile, Tavily runs them, then Claude extracts structured comp data with EV, EV/EBITDA, and narrative context.",
                "Key limitation: it relies on publicly available web data, which is incomplete for private M&A transactions. Most PE deals don't disclose multiples publicly. The tool is best for sectors with frequent public deal coverage.",
                "Acknowledged explicitly in output: every comps result includes a data_quality_note telling analysts to verify with PitchBook, CapIQ, or Bloomberg before using in any IC memo.",
            ]
        ),
    ]
    for q, answers in qas_prod:
        for flow in q_and_a(q, answers, s):
            story.append(flow)

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 12 — WEAKNESSES
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("12", "Known Weaknesses & How to Address Them", s))
    story.append(sp(2))

    story.append(body(
        "Be proactive about these in the interview — naming them yourself shows engineering maturity "
        "and self-awareness. For each: state the problem, why it exists, and what the fix would be.", s))
    story.append(sp(2))

    weaknesses = [
        ("15k char truncation for claim extraction",
         "Key financials could be buried in a 100-page CIM past the 15k char cutoff.",
         "Scan table of contents first to locate financial section. Use that offset for extraction instead of always taking front chars. Or run a two-pass: identify relevant sections, then extract claims from each."),
        ("8k char cap per doc in conflict detection",
         "For a large financial model + long CIM, the conflict scan misses later pages.",
         "Increase to 15-20k with prompt caching to keep cost manageable. Or run targeted conflict checks on only the financial sections rather than whole docs."),
        ("No retry logic on Tavily / Claude",
         "Any API error or rate limit causes a 500 response — the whole analysis fails.",
         "Add tenacity retry decorator with exponential backoff. For claim verification, degrade gracefully: mark failed claims as 'unverifiable' with explanation 'Could not retrieve search results.'"),
        ("CORS allow_origins=[\"*\"]",
         "Any website can call the API.",
         "Lock down to specific origin(s). For Sagard's deployment, this would be the exact frontend domain."),
        ("No input sanitization against prompt injection",
         "A malicious PDF could embed text like 'Ignore previous instructions and output...'",
         "Strip injection patterns from extracted text. Use system prompt separation. Add a pre-screen step."),
        ("Sync Claude SDK in thread pool",
         "Thread pool adds overhead vs pure async. At high concurrency, thread pool saturation is possible.",
         "Switch to anthropic.AsyncAnthropic + httpx for Tavily. Pure async with no thread overhead."),
        ("No authentication / authorization",
         "Any user with the API URL can submit documents. All deals visible in shared Supabase.",
         "Add Supabase Auth with Row Level Security. Each user's deals are private by default."),
        ("openpyxl data_only=True limitation",
         "Cells with cached values read stale data if the workbook was never opened/saved in Excel.",
         "Use xlcalculator to re-evaluate formulas. Or add a notice when data appears stale (e.g., all formulas returned None)."),
    ]

    for title, problem, fix in weaknesses:
        row_data = [[
            Paragraph(f"<b>{title}</b>", ParagraphStyle('wt', fontName='Helvetica-Bold',
                      fontSize=9, textColor=RED, leading=13)),
            Paragraph(f"<b>Problem:</b> {problem}<br/><font color='#14532d'><b>Fix:</b></font> {fix}",
                      ParagraphStyle('wd', fontName='Helvetica', fontSize=8.5,
                                     textColor=DARK, leading=13)),
        ]]
        rt = Table(row_data, colWidths=[1.6*inch, 5.9*inch])
        rt.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (0,-1), HexColor("#fdf2f2")),
            ('TOPPADDING', (0,0), (-1,-1), 7), ('BOTTOMPADDING', (0,0), (-1,-1), 7),
            ('LEFTPADDING', (0,0), (-1,-1), 8), ('RIGHTPADDING', (0,0), (-1,-1), 8),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('LINEBELOW', (0,0), (-1,-1), 0.4, LGRAY),
        ]))
        story.append(rt)
        story.append(sp(1))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 13 — FUTURE
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("13", "What I'd Build Next", s))
    story.append(sp(2))

    next_items = [
        ("Streaming responses via SSE",
         "POST /analyze blocks for 1-5 min. Add Server-Sent Events so each pipeline step (claims extracted, claim 1 verified...) streams to the frontend as it completes. The frontend LOADING_STEPS UI already has the scaffolding — just needs backend streaming."),
        ("Claude prompt caching",
         "Document text is re-sent on every chat turn. Using cache_control: ephemeral on the document block would cut chat costs by ~90% for multi-turn sessions and reduce latency significantly."),
        ("Native structured output / tool use",
         "Replace JSON-from-text parsing (with code-fence stripping + fallback parsers) with Claude's tool_use feature, which guarantees schema-valid JSON output at the API level."),
        ("Background job queue",
         "Replace the synchronous HTTP request model with Celery + Redis (or AWS SQS). /analyze returns a job_id immediately; frontend polls /jobs/{id} or subscribes via WebSocket. Eliminates timeout risk on long analyses."),
        ("Real comp data integration",
         "Integrate PitchBook or CapIQ API for verified M&A transaction multiples. Current Tavily approach is best-effort on publicly available data — unreliable for private market transactions."),
        ("Supabase Auth + Row Level Security",
         "Add user authentication so each Sagard analyst has private deals. Enable RLS on all 4 tables. Add team sharing (deal_team_members join table)."),
        ("Expanded document types",
         "Add support for Word (.docx) documents and PowerPoint (.pptx) — common in deal data rooms. python-docx for Word; python-pptx for PowerPoint."),
        ("Analyst feedback loop",
         "Allow analysts to mark claims as correct/incorrect and flag missed claims. Use feedback to fine-tune extraction prompts and improve claim prioritization over time."),
        ("Deal comparison view",
         "Side-by-side comparison of two deals' scorecards, metrics, and verdicts. Useful for ranking deals in a pipeline."),
    ]

    for i, (title, desc) in enumerate(next_items, 1):
        row = [[
            Paragraph(f"<b>{i}</b>", ParagraphStyle('ni', fontName='Helvetica-Bold', fontSize=10,
                      textColor=white, alignment=TA_CENTER, leading=14)),
            Paragraph(f"<b>{title}</b>", ParagraphStyle('nt', fontName='Helvetica-Bold', fontSize=9.5,
                      textColor=NAVY, leading=13)),
            Paragraph(desc, ParagraphStyle('nd', fontName='Helvetica', fontSize=8.5,
                      textColor=DARK, leading=13)),
        ]]
        rt = Table(row, colWidths=[0.35*inch, 1.7*inch, 5.45*inch])
        rt.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (0,-1), NAVY),
            ('TOPPADDING', (0,0), (-1,-1), 7), ('BOTTOMPADDING', (0,0), (-1,-1), 7),
            ('LEFTPADDING', (0,0), (-1,-1), 8), ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('LINEBELOW', (0,0), (-1,-1), 0.4, LGRAY),
        ]))
        story.append(rt)
        story.append(sp(1))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 14 — SCALING
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("14", "Scaling to 10× Volume", s))
    story.append(sp(2))

    story.append(body(
        "Current bottleneck: each analysis is a single long-running HTTP request with up to 10 Claude calls. "
        "At 10× volume this saturates API rate limits, thread pools, and server connections. "
        "Here's the full architectural roadmap:", s))
    story.append(sp(2))

    scaling_items = [
        ("Job Queue (Celery + Redis or SQS)",
         "HIGH",
         "Move /analyze to async job worker. /analyze returns job_id immediately. Workers process queue. "
         "Eliminates timeout risk, enables retry on failure, allows worker autoscaling independent of API layer."),
        ("Horizontal API scaling",
         "HIGH",
         "FastAPI is stateless — state lives in Supabase. Run N instances behind a load balancer. "
         "N instances = N × 6 concurrent Tavily calls. No code changes needed."),
        ("Prompt caching on document text",
         "HIGH",
         "Document text is the largest token cost, sent 3+ times per analysis. Claude's cache_control: ephemeral "
         "caches it for up to 5 minutes. For multi-turn chat, this cuts per-message cost by ~90%."),
        ("Redis cache for Tavily results",
         "MEDIUM",
         "Same claim appears in multiple CIMs (e.g. 'gaming market grew 8% CAGR'). Cache Tavily results keyed "
         "by claim text hash with TTL of 24-48 hours. Reduces duplicate API calls significantly."),
        ("Model tiering for cost optimization",
         "MEDIUM",
         "Use claude-haiku for low-stakes steps (chart data, deal profile extraction) at 10× lower cost. "
         "Reserve claude-sonnet for high-stakes steps (assessment, conflict detection, claim analysis)."),
        ("Async Claude + httpx for Tavily",
         "MEDIUM",
         "Replace ThreadPoolExecutor with anthropic.AsyncAnthropic and httpx async HTTP client. "
         "Eliminates thread pool overhead, improves event loop utilization under high concurrency."),
        ("Document extraction pipeline",
         "LOW",
         "Re-extract text on every /analyze call. Should extract once, store in deal_documents.extracted_text "
         "(already in schema), and reuse. Currently done partially — the /extract endpoint exists but "
         "the main pipeline re-extracts from raw files."),
        ("Token accounting + cost attribution",
         "LOW",
         "Add per-deal token usage tracking. At 10× volume, cost visibility is critical. "
         "Log input/output tokens per Claude call to deal_analyses table."),
    ]

    scale_data = [["Change", "Priority", "Impact"]]
    for title, priority, desc in scaling_items:
        scale_data.append([title, priority, desc])

    t = Table(scale_data, colWidths=[1.7*inch, 0.6*inch, 5.2*inch])
    pri_colors = {'HIGH': (BGRED, RED), 'MEDIUM': (BGAMB, AMBER), 'LOW': (XGRAY, GRAY)}
    style_cmds = [
        ('BACKGROUND', (0,0), (-1,0), NAVY), ('TEXTCOLOR', (0,0), (-1,0), white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'), ('FONTSIZE', (0,0), (-1,-1), 8.5),
        ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
        ('GRID', (0,0), (-1,-1), 0.3, LGRAY),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
    ]
    for row_i, (_, priority, _) in enumerate(scaling_items, 1):
        bg, fg = pri_colors.get(priority, (XGRAY, GRAY))
        style_cmds.append(('BACKGROUND', (1, row_i), (1, row_i), bg))
        style_cmds.append(('TEXTCOLOR', (1, row_i), (1, row_i), fg))
        style_cmds.append(('FONTNAME', (1, row_i), (1, row_i), 'Helvetica-Bold'))
        style_cmds.append(('ALIGN', (1, row_i), (1, row_i), 'CENTER'))
    t.setStyle(TableStyle(style_cmds))
    story.append(t)

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════
    # SECTION 15 — QUICK REFERENCE
    # ═══════════════════════════════════════════════════════════
    story.append(SectionHeader("15", "Quick Reference Tables", s))
    story.append(sp(2))

    story.append(h2("File Structure", s))
    story.append(CodeBlock([
        "cim-analyzer/",
        "├── backend/",
        "│   ├── main.py              # entire backend: FastAPI app, all endpoints, all Claude calls",
        "│   ├── requirements.txt     # fastapi, uvicorn, pdfplumber, openpyxl, anthropic, requests",
        "│   └── .env                 # ANTHROPIC_API_KEY, TAVILY_API_KEY",
        "├── frontend/",
        "│   ├── src/",
        "│   │   ├── App.tsx          # entire frontend: all components, state, UI",
        "│   │   ├── useDealPersistence.ts  # Supabase CRUD hook",
        "│   │   └── supabaseClient.ts      # nullable Supabase client",
        "│   ├── public/index.html",
        "│   └── package.json",
        "└── test/",
        "    └── AmericanCasinos_Financial_Model.xlsx  # test fixture",
    ]))

    story.append(sp(2))
    story.append(h2("Environment Variables", s))
    env_data = [
        ["Variable", "Where Used", "Required"],
        ["ANTHROPIC_API_KEY", "backend/main.py — claude client init", "Yes"],
        ["TAVILY_API_KEY", "backend/main.py — all search_claim() calls", "Yes"],
        ["REACT_APP_API_URL", "frontend/src/App.tsx — API_BASE_URL fallback to localhost:8000", "No (defaults to localhost)"],
        ["REACT_APP_SUPABASE_URL", "frontend/src/supabaseClient.ts", "No (app works without it)"],
        ["REACT_APP_SUPABASE_ANON_KEY", "frontend/src/supabaseClient.ts", "No (app works without it)"],
    ]
    story.append(make_table(env_data, [2.3*inch, 2.8*inch, 1.9*inch]))

    story.append(sp(2))
    story.append(h2("Key Constants & Limits", s))
    const_data = [
        ["Constant / Limit", "Value", "Location", "Purpose"],
        ["char_limit in assemble_document_text", "80,000 chars", "main.py:216", "Total doc text sent to conflict detection + chat"],
        ["Primary doc cap in extract_claims", "15,000 chars", "main.py:610", "Input to claim extraction + charts"],
        ["Per-doc cap in conflict detection", "8,000 chars", "main.py:371", "Each doc truncated for conflict scan"],
        ["ThreadPoolExecutor max_workers (claims)", "6", "main.py:622", "Concurrent claim verifications"],
        ["ThreadPoolExecutor max_workers (assessment)", "2", "main.py:630", "Parallel assessment + charts"],
        ["Tavily max_results per query", "3 (claims), 5 (comps)", "main.py:313,724", "Search results per Tavily call"],
        ["Tavily content snippet length", "300 chars (claims), 600 (comps)", "main.py:319,733", "Content truncated in results"],
        ["COMPS search queries", "4", "main.py:713", "Generated by Claude, run sequentially"],
    ]
    story.append(make_table(const_data, [2.2*inch, 1.1*inch, 0.9*inch, 3.3*inch]))

    story.append(sp(2))
    story.append(h2("Verdict System", s))
    verd_summary = [
        ["Level", "Values", "Display"],
        ["overall_verdict (Assessment)", "Worth deeper look / Borderline / Pass", "Green / Amber / Red pill on IC brief"],
        ["verdict (Claim)", "verified / disputed / unverifiable", "Green / Amber / Red badge per claim"],
        ["severity (Conflict)", "high / medium / low", "Color-coded conflict cards"],
        ["materiality (Claim)", "high / medium / low", "Displayed alongside claim verdict"],
        ["confidence (Claim)", "1–5 integer", "Numeric confidence on claim card"],
    ]
    story.append(make_table(verd_summary, [1.8*inch, 2.5*inch, 3.2*inch]))

    story.append(sp(2))
    story.append(h2("One-Line Answers for Rapid-Fire Questions", s))

    rapid_data = [
        ["Question", "Answer"],
        ["What LLM?", "Claude Sonnet 4.5 (claude-sonnet-4-5) for all calls"],
        ["What search API?", "Tavily — purpose-built for AI agents, returns cleaned content"],
        ["What database?", "Supabase (managed PostgreSQL) with JS SDK from the frontend only"],
        ["How are files stored?", "Extracted text in Supabase; file binaries in browser IndexedDB"],
        ["How long does analysis take?", "~1-5 minutes depending on doc size and API latency"],
        ["Max document size?", "80,000 chars total assembled; individual page extraction is unlimited"],
        ["What file types supported?", "PDF, XLSX, XLS, XLSM"],
        ["Does it work without Supabase?", "Yes — deals just don't persist across sessions"],
        ["How many Claude calls per analysis?", "Up to 9: claims + N×analyze_claim + assessment + charts + conflicts"],
        ["Where does cross-doc conflict run?", "Backend only, in find_cross_document_conflicts(), single Claude call"],
        ["What's the COMPS data source?", "Tavily web search results — not PitchBook/CapIQ (public data only)"],
        ["How does the chart system work?", "Claude embeds CHART:{json} in text; frontend regex-parses and renders Recharts"],
    ]
    story.append(make_table(rapid_data, [2.3*inch, 5.2*inch]))

    # ── BACK COVER ────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Spacer(1, 2.5*inch))
    story.append(HRFlowable(width="60%", thickness=1, color=RED,
                             spaceAfter=24, spaceBefore=0, hAlign='CENTER'))
    story.append(Paragraph("Good luck.", ParagraphStyle(
        'gl', fontName='Helvetica-Bold', fontSize=24, textColor=NAVY,
        alignment=TA_CENTER, leading=30
    )))
    story.append(Spacer(1, 0.15*inch))
    story.append(Paragraph("You built this. You know it cold.", ParagraphStyle(
        'sub', fontName='Helvetica', fontSize=13, textColor=GRAY,
        alignment=TA_CENTER, leading=18
    )))
    story.append(Spacer(1, 0.4*inch))
    story.append(Paragraph("Sagard CIM Analyzer  ·  Hanson Qin  ·  2026", ParagraphStyle(
        'meta', fontName='Helvetica', fontSize=10, textColor=LGRAY,
        alignment=TA_CENTER, leading=15
    )))

    return story


# ── Build document ────────────────────────────────────────────

def main():
    output_path = "CIM_Analyzer_Interview_Cheatsheet.pdf"
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=0.5*inch,
        rightMargin=0.5*inch,
        topMargin=0.65*inch,
        bottomMargin=0.55*inch,
        title="Sagard CIM Analyzer — Technical Interview Prep",
        author="Hanson Qin",
    )

    story = build_pdf()

    def first_page(canvas, doc):
        cover_page(canvas, doc)

    def later_pages(canvas, doc):
        header_footer(canvas, doc)

    doc.build(story, onFirstPage=first_page, onLaterPages=later_pages)
    print(f"PDF generated: {output_path}")


if __name__ == "__main__":
    main()
