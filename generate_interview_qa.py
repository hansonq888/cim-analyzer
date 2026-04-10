"""
CIM Analyzer — Interview Q&A Cheatsheet (AI Enablement Role)
Run: python generate_interview_qa.py
Output: CIM_Interview_QA.pdf
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
QBLUE   = HexColor("#1e3a5f")
BGBLUE  = HexColor("#e8f0fe")
BGGRAY  = HexColor("#f9fafb")


def build_styles():
    s = {}
    s['cover_title'] = ParagraphStyle('cover_title', fontName='Helvetica-Bold', fontSize=30,
        textColor=white, leading=38, alignment=TA_CENTER, spaceAfter=8)
    s['cover_sub'] = ParagraphStyle('cover_sub', fontName='Helvetica', fontSize=13,
        textColor=ACCENT, leading=20, alignment=TA_CENTER, spaceAfter=6)
    s['cover_meta'] = ParagraphStyle('cover_meta', fontName='Helvetica', fontSize=10,
        textColor=HexColor("#cccccc"), alignment=TA_CENTER, leading=16)
    s['h2'] = ParagraphStyle('h2', fontName='Helvetica-Bold', fontSize=12,
        textColor=RED, leading=18, spaceBefore=16, spaceAfter=6)
    s['h3'] = ParagraphStyle('h3', fontName='Helvetica-Bold', fontSize=10,
        textColor=NAVY, leading=15, spaceBefore=10, spaceAfter=3)
    s['body'] = ParagraphStyle('body', fontName='Helvetica', fontSize=9,
        textColor=DARK, leading=14, spaceBefore=2, spaceAfter=2, alignment=TA_JUSTIFY)
    s['bullet'] = ParagraphStyle('bullet', fontName='Helvetica', fontSize=9,
        textColor=DARK, leading=14, spaceBefore=1, spaceAfter=1, leftIndent=14, firstLineIndent=-10)
    s['q_text'] = ParagraphStyle('q_text', fontName='Helvetica-Bold', fontSize=9.5,
        textColor=QBLUE, leading=14)
    s['a_text'] = ParagraphStyle('a_text', fontName='Helvetica', fontSize=9,
        textColor=DARK, leading=14)
    s['a_bullet'] = ParagraphStyle('a_bullet', fontName='Helvetica', fontSize=9,
        textColor=DARK, leading=14, leftIndent=12, firstLineIndent=-10)
    s['tip'] = ParagraphStyle('tip', fontName='Helvetica-Oblique', fontSize=8.5,
        textColor=AMBER, leading=13)
    s['warn'] = ParagraphStyle('warn', fontName='Helvetica-Oblique', fontSize=8.5,
        textColor=RED, leading=13)
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
        return availWidth, len(self.lines) * self.line_height + self.padding * 2

    def draw(self):
        c = self.canv
        h = len(self.lines) * self.line_height + self.padding * 2
        c.setFillColor(CODE_BG)
        c.roundRect(0, 0, self.width, h, 4, fill=1, stroke=0)
        c.setFont('Courier', 7.5)
        y = h - self.padding - self.line_height + 2
        for line in self.lines:
            c.setFillColor(CODE_FG)
            c.drawString(self.padding, y, line[:115])
            y -= self.line_height


def header_footer(canvas, doc):
    canvas.saveState()
    w, h = letter
    canvas.setStrokeColor(LGRAY)
    canvas.setLineWidth(0.5)
    canvas.line(0.5*inch, h - 0.45*inch, w - 0.5*inch, h - 0.45*inch)
    canvas.setFont('Helvetica-Bold', 7)
    canvas.setFillColor(RED)
    canvas.drawString(0.5*inch, h - 0.38*inch, "CIM ANALYZER — INTERVIEW Q&A")
    canvas.setFont('Helvetica', 7)
    canvas.setFillColor(GRAY)
    canvas.drawRightString(w - 0.5*inch, h - 0.38*inch, "AI Enablement Role  ·  Sagard Private Capital")
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


def qa_block(question, answer_paragraphs, tip_text, s, warn=False):
    """Renders a single Q&A block. answer_paragraphs is a list of strings (can be bullets starting with '•')."""
    items = []

    # Question box
    q_data = [[Paragraph(f"<b>Q:  {question}</b>", ParagraphStyle(
        'qt', fontName='Helvetica-Bold', fontSize=9.5, textColor=QBLUE, leading=14
    ))]]
    qt = Table(q_data, colWidths=[7.5*inch])
    qt.setStyle(TableStyle([
        ('BACKGROUND',    (0,0), (-1,-1), BGBLUE),
        ('LEFTPADDING',   (0,0), (-1,-1), 10),
        ('RIGHTPADDING',  (0,0), (-1,-1), 10),
        ('TOPPADDING',    (0,0), (-1,-1), 7),
        ('BOTTOMPADDING', (0,0), (-1,-1), 7),
        ('LINEBELOW',     (0,0), (-1,-1), 1.5, HexColor("#3b82f6")),
    ]))
    items.append(qt)

    # Answer rows
    a_rows = []
    for para in answer_paragraphs:
        is_bullet = para.startswith("•") or para.startswith("-")
        style = ParagraphStyle('ab', fontName='Helvetica', fontSize=9,
                               textColor=DARK, leading=14,
                               leftIndent=14 if is_bullet else 0,
                               firstLineIndent=-10 if is_bullet else 0)
        prefix = '<font color="#14532d"><b>A:</b></font>  ' if not is_bullet else ''
        a_rows.append([Paragraph(f"{prefix}{para}", style)])

    at = Table(a_rows, colWidths=[7.5*inch])
    at.setStyle(TableStyle([
        ('BACKGROUND',    (0,0), (-1,-1), BGGRN),
        ('LEFTPADDING',   (0,0), (-1,-1), 10),
        ('RIGHTPADDING',  (0,0), (-1,-1), 10),
        ('TOPPADDING',    (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    items.append(at)

    # Tip/warn row
    if tip_text:
        tip_color = HexColor("#fffbeb") if not warn else HexColor("#fdf2f2")
        label_color = "#92400e" if not warn else "#991b1b"
        label = "TIP:" if not warn else "WATCH OUT:"
        tip_data = [[Paragraph(
            f'<font color="{label_color}"><b>{label}</b></font>  {tip_text}',
            ParagraphStyle('tip', fontName='Helvetica', fontSize=8.5, textColor=DARK, leading=13)
        )]]
        tt = Table(tip_data, colWidths=[7.5*inch])
        tt.setStyle(TableStyle([
            ('BACKGROUND',    (0,0), (-1,-1), tip_color),
            ('LEFTPADDING',   (0,0), (-1,-1), 10),
            ('RIGHTPADDING',  (0,0), (-1,-1), 10),
            ('TOPPADDING',    (0,0), (-1,-1), 4),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('LINEABOVE',     (0,0), (-1,-1), 0.5, LGRAY),
        ]))
        items.append(tt)

    items.append(sp(2))
    return items


def build_pdf():
    s = build_styles()
    story = []

    # ── COVER ──────────────────────────────────────────────────
    story.append(Spacer(1, 2.0*inch))
    story.append(Paragraph("INTERVIEW PREP", s['cover_title']))
    story.append(Spacer(1, 0.08*inch))
    story.append(Paragraph("Q&A CHEATSHEET", s['cover_title']))
    story.append(Spacer(1, 0.2*inch))
    story.append(Paragraph("AI Enablement Role  ·  CIM Analyzer Project", s['cover_sub']))
    story.append(Spacer(1, 0.3*inch))
    story.append(HRFlowable(width=2.5*inch, thickness=1, color=RED,
                             spaceAfter=18, spaceBefore=0, hAlign='CENTER'))
    story.append(Paragraph("35+ questions  ·  Model answers  ·  Interviewer-lens framing", s['cover_meta']))
    story.append(Spacer(1, 0.08*inch))
    story.append(Paragraph(f"Generated {datetime.date.today().strftime('%B %d, %Y')}", s['cover_meta']))
    story.append(PageBreak())

    # ── INTRO ──────────────────────────────────────────────────
    story.append(SectionHeader("", "How to Use This Sheet"))
    story.append(sp(2))
    story.append(body(
        "Every answer is written from the perspective of what an AI enablement interviewer actually "
        "wants to hear. They are not testing if you memorized your code — they are testing whether you "
        "can <b>think about AI systems</b> at a product, design, and engineering level. "
        "Read each answer, internalize it, then put it in your own words. Don't recite verbatim.", s))
    story.append(sp(1))

    cat_data = [
        ["Section", "Focus Area", "# Questions"],
        ["1", "The Project — Open-Ended", "5"],
        ["2", "Technical Architecture & AI Pipeline", "8"],
        ["3", "Prompt Engineering & Model Behavior", "6"],
        ["4", "Product Thinking & Design Decisions", "6"],
        ["5", "Challenges, Failures & Tradeoffs", "5"],
        ["6", "AI at Sagard — Role-Specific", "5"],
        ["7", "Behavioral / Leadership", "5"],
        ["8", "Questions to Ask the Interviewer", "5"],
    ]
    story.append(make_table(cat_data, [0.5*inch, 5.5*inch, 1.0*inch]))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════
    # SECTION 1 — OPEN ENDED
    # ════════════════════════════════════════════════════════════
    story.append(SectionHeader("1", "The Project — Open-Ended"))
    story.append(sp(2))

    for item in qa_block(
        "Tell me about CIM Analyzer. What does it do?",
        [
            "CIM Analyzer is an AI-powered deal screening tool for investment professionals. You upload a Confidential Information Memorandum — the marketing document sellers send to prospective buyers — and the tool automatically reads it, fact-checks its key claims against real-time web data, and produces an investment thesis summary.",
            "The output includes: an overall verdict (Worth deeper look / Borderline / Pass), 6 verified claims with confidence scores, cross-document conflict detection, a comparable transactions analysis, financial charts, and a multi-turn chat interface for follow-up questions.",
            "The core value proposition: what used to take an analyst 2–3 hours to do manually — reading a CIM, pulling comps, Googling to verify claims — takes about 30 seconds.",
        ],
        "Lead with the user problem, not the technology. Interviewers want to see product thinking first.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "Why did you build this specifically? What was the problem you were solving?",
        [
            "At Sagard, deal teams receive dozens of CIMs. The first-pass read — 'is this even worth spending 2 hours on?' — is repetitive analytical work. A junior analyst reads the document, identifies the key claims, cross-references a few numbers against public data, and pulls some comparable deals. That pattern is ideal for automation.",
            "The deeper problem is that CIMs are marketing documents. Sellers frame everything optimistically. An analyst's job is to stress-test the narrative — are the revenue numbers verifiable? Does the market size claim hold up? Does the financial model match what the CIM says? I built the tool to do that verification automatically, so analysts spend their time on the nuanced judgment calls, not the mechanical work.",
        ],
        "The phrase 'marketing documents' and 'stress-test the narrative' will resonate strongly with finance-domain interviewers.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "What's the most impressive technical thing about it?",
        [
            "The concurrent claim verification pipeline. When a user uploads a CIM, the system identifies 6 high-stakes verifiable claims — revenue numbers, market size, competitive position — and then verifies all 6 in parallel. Each claim gets web-searched via Tavily and cross-referenced by Claude simultaneously, using a ThreadPoolExecutor with 6 workers.",
            "Without parallelism, 6 claims × (2s search + 4s Claude) = 36 seconds just for verification. With parallelism it takes 6–8 seconds total — the bottleneck becomes the slowest single claim, not the sum of all of them.",
            "The second thing I'm proud of is the page citation accuracy. PDFs often have printed footer numbers (like 'CONFIDENTIAL 19') that don't match the actual PDF page positions. I strip those with regex and inject PAGE X OF Y markers so Claude always cites the right page — the one the user sees in their PDF viewer.",
        ],
        "Have a specific number ready: '36 seconds sequential vs 6–8 seconds parallel'. Concrete before/after makes the answer land.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "Walk me through the full flow from upload to results.",
        [
            "Step 1 — Document extraction: pdfplumber extracts text page by page with explicit PAGE markers; openpyxl reads Excel sheets as pipe-delimited tables.",
            "Step 2 — Claim extraction: Claude reads the first 15,000 chars of the primary document and identifies the 6 most impactful verifiable claims as structured JSON.",
            "Step 3 — Parallel verification: all 6 claims are searched (Tavily) and analyzed (Claude) concurrently. Each gets a verdict: verified, disputed, or unverifiable, plus a confidence score 1–5 and a specific diligence question to ask management.",
            "Step 4+5 — Parallel Claude calls: overall assessment (Pass/Borderline/Worth deeper look, top risks, bull case, key questions) and financial chart data both run simultaneously.",
            "Step 6 — Conflict detection: if multiple files were uploaded, Claude scans all documents for numerical contradictions between them.",
            "The frontend then immediately fires a second async request for comparable M&A transactions — this takes 30–60 seconds so it's deliberately non-blocking.",
        ],
        "Memorize the step numbers. If you hesitate, say 'there are 6 steps in the /analyze pipeline' — it signals that you designed this intentionally.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "Who would use this, and how does it fit into a real investment workflow?",
        [
            "Primary user: a junior analyst or associate at a PE/credit fund who receives a CIM and needs to decide within the hour whether to flag it to a partner or pass.",
            "Workflow fit: the tool replaces the first 2–3 hours of manual first-pass work. The analyst uploads the CIM and any financial models, gets a summary in 30 seconds, and arrives at the partner meeting with already-verified data points and specific diligence questions — instead of a raw PDF and general impressions.",
            "Secondary use: deal teams running high-volume processes. If you're looking at 50 companies in a sector, you can screen them quickly and triage which ones deserve full diligence resources.",
            "Importantly, the tool never replaces analyst judgment — it structures the inputs. The 'verified/disputed/unverifiable' categories exist precisely because external verification can only get you so far with private company data.",
        ],
        "Ending with 'the tool never replaces analyst judgment' shows maturity and will resonate with an investment firm audience.",
        s
    ):
        story.append(item)

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════
    # SECTION 2 — TECHNICAL
    # ════════════════════════════════════════════════════════════
    story.append(SectionHeader("2", "Technical Architecture & AI Pipeline"))
    story.append(sp(2))

    for item in qa_block(
        "Why did you choose Claude over GPT-4 or Gemini?",
        [
            "Primarily: reliability on structured JSON output. The system requires every Claude call to return valid JSON — no markdown prose, no explanation, just a clean JSON object. Claude Sonnet is consistently better at following strict output formatting instructions than alternatives I tested, especially when the JSON schema is complex.",
            "Second: reasoning quality on financial documents. Claude handles the analytical reasoning required — not just extracting numbers, but assessing whether a claim is plausible and why. The 'senior PE analyst' persona in the prompts works particularly well with Claude's instruction-following behavior.",
            "Third: context window. CIM documents can be 60–80 pages. Passing the full text into context without chunking is simpler and more accurate than RAG for this use case — Claude Sonnet's 200k token window makes that feasible.",
        ],
        "Don't say 'it was just better'. Name the specific capability that mattered: structured output reliability, context window, reasoning quality.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "Why no RAG? Why pass the full document in context?",
        [
            "For CIM-length documents (60–80 pages, ~80k chars), full-context is simpler, faster, and more accurate than RAG for this specific use case.",
            "RAG introduces chunk boundary problems: if a claim spans two pages, a naive chunker will split it and neither chunk retrieves correctly. For financial documents where specific numbers on specific pages matter, you want the model to see the full document.",
            "The tradeoff: for very long documents (200+ pages), full-context hits limits. I handle this with a char_limit truncation that cuts at a complete PAGE marker — the model knows it's seeing a truncated document.",
            "If scale required it, the right RAG approach here would be page-level chunking with metadata (page number, document name) — each chunk is one full PDF page. That preserves citation integrity while enabling retrieval.",
        ],
        "The 'chunk boundary problem' is a specific, technical critique that shows you've thought past the standard 'use RAG for long docs' answer.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How does the concurrent execution work? Walk me through the threading model.",
        [
            "The Anthropic SDK and the requests library (used for Tavily) are both synchronous. FastAPI runs on an async event loop. If I called a synchronous function directly from an async handler, it would block the entire event loop — no other requests could be served while that call ran.",
            "The solution: loop.run_in_executor(ThreadPoolExecutor). This runs each synchronous function in a thread pool, keeping the event loop free. asyncio.gather() then awaits all threads simultaneously.",
            "For claim verification: ThreadPoolExecutor(max_workers=6), one thread per claim. For assessment + charts: ThreadPoolExecutor(max_workers=2) so both run in parallel.",
            "Thread safety is not an issue because the Anthropic client and requests are stateless — each thread makes independent API calls with no shared mutable state.",
        ],
        "Be ready to explain the difference between threading and multiprocessing if asked — threads share memory (fine here since no shared state), processes have separate memory (needed for CPU-bound work).",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How do you handle the case where Claude returns invalid JSON?",
        [
            "Two layers of defense. First: every prompt ends with 'Return ONLY valid JSON, no other text' — this reduces malformed output to rare edge cases.",
            "Second: every call strips markdown code fences before parsing. Claude sometimes wraps JSON in triple-backtick blocks even when told not to — the stripping handles that.",
            "Third: the cross-document conflict endpoint has a brace-depth fallback parser. If json.loads() fails on a long response that got truncated, I scan the raw string for complete {…} objects by tracking brace depth. Salvaging 4 out of 5 conflict objects is better than returning an empty array.",
            "In production I'd add Pydantic model validation on the parsed output — that would catch shape mismatches (wrong field names, wrong types) before they reach the frontend.",
        ],
        "Mentioning Pydantic as a production improvement shows you know the production gap and have thought about it.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How does the cross-document conflict detection work?",
        [
            "It's a single Claude call that receives all document texts concatenated with DOCUMENT boundary headers. Claude is instructed to scan for numerical contradictions between documents — specifically: revenue, EBITDA, margins, unit counts, customer concentration percentages, and any other specific figures.",
            "The prompt is deliberately aggressive: 'Flag any mismatch, no matter how small.' The severity tiers distinguish materiality — high is any discrepancy on a material figure, medium is a <10% difference or different framing, low is emphasis differences.",
            "The practical case this catches: a CIM saying EBITDA is $91M and the financial model showing $84M. That's a $7M discrepancy on the headline number — extremely relevant to deal pricing.",
            "Page citations are file-type aware: PDF docs use [[Page X, filename]], Excel docs use [[Sheet: SheetName, filename]] with page1/page2 set to null for Excel.",
        ],
        "The concrete example ($91M vs $84M) is more memorable than an abstract description. Have a real-world example ready.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "Describe the COMPS feature and why it fires asynchronously.",
        [
            "COMPS finds real M&A transactions comparable to the deal being analyzed. The pipeline: Claude extracts a deal profile and generates 4 targeted search queries, Tavily runs all 4 searches, then Claude synthesizes the results into structured comps with EV/EBITDA multiples and a valuation context write-up.",
            "It fires asynchronously because it takes 30–60 seconds. If it blocked the /analyze response, the user would wait 60–90 seconds before seeing anything. Instead, /analyze returns in 15–30 seconds with the full analysis, and the frontend immediately fires POST /comps in the background. The COMPS tab shows a loading state while everything else is already visible.",
            "The skepticism guardrail is important: the prompt explicitly instructs Claude to include only confirmed transactions from the search results. 'Better 3 confirmed comps than 8 speculative ones.' The output always includes a data_quality_note telling analysts to verify with PitchBook or CapIQ before using in any IC memo.",
        ],
        "The data quality note is a sign of professional judgment. Mention it — it shows you thought about how a real analyst would use this output.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How does the chat feature work? What's in the system prompt?",
        [
            "Multi-turn Q&A where Claude has the full document text as context. The system prompt does several things: sets the investment strategy lens (e.g., PE analysts want EBITDA analysis, not generic financial summaries), enforces citation format ([[Page X, filename]] or [[Sheet: S, filename]]), and explains the PAGE marker convention so Claude cites correctly.",
            "Chart generation is embedded inline: the system prompt includes a CHART: protocol — Claude can emit CHART:{type, title, data, config} blocks anywhere in its response. The frontend parses these out and renders them as Recharts components (line, bar, radar, area, scatter charts).",
            "Full conversation history is passed on every call. This means Claude maintains context across turns — if you asked about EBITDA in turn 3 and ask a follow-up in turn 7, it remembers the earlier answer.",
        ],
        "The inline CHART protocol is a clever design decision — mention it as an example of how you gave Claude 'UI capabilities' through the prompt.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "What model do you use, and why that specific version?",
        [
            "Claude Sonnet 4.5 (claude-sonnet-4-5). The decision: Sonnet sits at the optimal point on the capability-cost-speed curve for this use case. Opus would give marginally better reasoning but is 3–5× more expensive and slower — in a pipeline making 8–10 Claude calls per analysis, that adds up. Haiku is fast and cheap but the analytical reasoning quality drops noticeably for complex financial document tasks.",
            "Sonnet handles the structured JSON requirement reliably, reasons well about financial metrics under the specified investment lens, and returns responses fast enough that the user experience stays snappy.",
            "If I were productionizing, I'd A/B test Sonnet vs Opus specifically on the get_overall_assessment call — that's the most judgment-intensive step and might justify the cost upgrade.",
        ],
        "Having an opinion on which specific call might benefit from Opus shows architectural thinking, not just 'I picked the best model'.",
        s
    ):
        story.append(item)

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════
    # SECTION 3 — PROMPT ENGINEERING
    # ════════════════════════════════════════════════════════════
    story.append(SectionHeader("3", "Prompt Engineering & Model Behavior"))
    story.append(sp(2))

    for item in qa_block(
        "Walk me through your prompting strategy. What principles did you use?",
        [
            "Persona priming first: every prompt starts with 'You are a senior [sector] analyst.' This anchors Claude's tone and reference frame — a PE analyst and a credit analyst should give fundamentally different analyses of the same document.",
            "Structured output enforcement: every call ends with 'Return ONLY valid JSON, no other text.' Combined with explicit field constraints (e.g., 'explanation: MAX 2 sentences'), this keeps responses tight and machine-parseable.",
            "Anti-hedging instructions: the assess_claim prompt says 'Be direct — no hedging, no filler. Sound like a sharp senior associate — not a report.' Without this, Claude defaults to diplomatic, over-caveated language.",
            "Specificity requirements on key fields: the diligence_question field prompt says 'not generic, tied to this claim.' Without that instruction, you get boilerplate like 'How does management plan to grow revenue?' — useless for a real analyst.",
            "Context primers for citation: before any page content in the extracted PDF, I inject a note explaining the PAGE X OF Y marker system and warning Claude to ignore printed footer numbers.",
        ],
        "The anti-hedging and specificity requirements are the most insightful points here — they show you iterated on output quality, not just prompt structure.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How did you handle hallucinations? What's your approach to reliability?",
        [
            "Three layers. First: structural grounding. Every claim-level analysis includes the source text and Tavily search results as explicit context. Claude isn't asked to hallucinate information — it's asked to assess evidence it can see.",
            "Second: the verdict categories are designed to be honest. 'Unverifiable' is a first-class outcome, not a failure state. If a claim can't be externally checked, Claude says so — with a specific recommendation for what the analyst should do instead (ask management, request data room access).",
            "Third: confidence scoring (1–5) forces calibration. The prompt says 'Be honest — don't default to 3.' A score of 1 means no external data found; 5 means strong direct corroboration. This gradient tells the analyst how much to trust each verdict.",
            "What I haven't done yet: systematic evaluation. I'd add a test set of CIMs with known ground truth and measure verdict accuracy across model versions.",
        ],
        "Mentioning what you haven't done (systematic eval) and what you'd do next is honest and shows engineering maturity.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "What's the Strategy Lens system and why did you build it that way?",
        [
            "STRATEGY_LENS is a Python dictionary with four keys: Private Equity, Private Credit, Venture Capital, Real Estate. Each key maps to a configuration object with fields: focus, key_metrics, red_flags, verdict_criteria, questions_focus, and conflict_focus.",
            "Every Claude prompt in the system is parameterized by the selected lens. A PE analyst asks 'would this generate 20%+ IRR in a 5-year hold?' A credit analyst asks 'can this service the debt through a downturn?' A VC asks 'can this be a $1B+ outcome?'",
            "The design decision: single code path, lens-driven behavior. There are no if/else branches in the pipeline — all 4 investment strategies run through identical functions, just with different prompt variables. Adding a fifth strategy (e.g., infrastructure) means adding one dictionary entry.",
            "This was a deliberate abstraction over hard-coded PE-only prompts. The insight was that the analytical questions are the same (what are the key claims, are they true, what's the verdict) — only the lens through which you evaluate answers changes.",
        ],
        "The 'single code path, lens-driven behavior' framing is clean. Mention it shows software design thinking, not just prompting.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How did you engineer Claude to cite the right page numbers?",
        [
            "PDFs create a citation problem: they have physical page numbers (what the PDF viewer shows) and printed page numbers (what's in the footer text, e.g. 'CONFIDENTIAL 19'). These often don't match — the footer might say page 19 when you're actually on PDF page 27.",
            "My solution has three parts. First: regex stripping in clean_page_text() removes footer patterns ('Bear Stearns CONFIDENTIAL 19', standalone 'CONFIDENTIAL 19', trailing lone integers) before the text reaches Claude.",
            "Second: every page's extracted text is wrapped in an explicit PAGE X OF Y marker block that Claude reads before the page content.",
            "Third: the extraction note prepended to every document explicitly tells Claude: 'Use the PAGE X OF Y markers only. Never use printed numbers found in the page content.'",
            "Result: when Claude cites something from page 27 of the PDF, it reliably says [[Page 27]] — matching exactly what the user sees when they click to verify.",
        ],
        "This is a great answer because it shows you identified and solved a non-obvious real problem. The PDF footer mismatch issue is subtle — mentioning it signals domain expertise.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How do you ensure Claude doesn't just make up comparable transactions?",
        [
            "The COMPS prompt has a strong skepticism guardrail: 'Include ONLY real, confirmed M&A transactions found in the search results — not rumors, not projections, not public company trading multiples. Be skeptical — if a transaction isn't clearly documented, exclude it entirely. Better 3 confirmed comps than 8 speculative ones.'",
            "This matters because hallucinated M&A comps with specific EV/EBITDA multiples would be actively dangerous — an analyst might use them in an IC memo. The output always includes a data_quality_note field that reads: 'Comps are sourced from public web data and may be incomplete or inaccurate — analysts should verify with PitchBook, CapIQ, or Bloomberg before using in any IC memo.'",
            "In practice: Tavily provides real URLs and content snippets. Claude is instructed to only extract deal data it can trace to the search results. If a transaction appears in 3 different search results with consistent numbers, confidence is high. If Claude can't find it in the results, it should exclude it.",
        ],
        "The data_quality_note is a key detail — it shows you thought about downstream harm from incorrect outputs.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "What would you change about your prompting if you had more time?",
        [
            "Systematic prompt evaluation. Right now, prompt quality is judged by reading outputs. I'd build an eval harness: a set of test CIMs with known ground truth (correct verdicts, correct page citations, correct EBITDA numbers) and automated scoring of Claude's output against those.",
            "Few-shot examples in the claim extraction prompt. I currently rely on the instruction alone. Adding 2–3 high-quality example claims with good 'why_it_matters' reasoning would likely improve output consistency.",
            "Chained reasoning for assessment. The overall_assessment call sees only the verified claims — not the original document text. Giving it a brief document summary alongside the claims might improve verdict quality on edge cases where the claims don't fully capture the investment thesis.",
        ],
        "The eval harness answer is the most impressive — it shows you think like a software engineer about AI systems, not just a builder.",
        s
    ):
        story.append(item)

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════
    # SECTION 4 — PRODUCT THINKING
    # ════════════════════════════════════════════════════════════
    story.append(SectionHeader("4", "Product Thinking & Design Decisions"))
    story.append(sp(2))

    for item in qa_block(
        "What are the biggest design tradeoffs you made?",
        [
            "Full context vs RAG: I chose full-context document passing over retrieval. Simpler and more accurate for CIM-length docs, but doesn't scale to 200+ page documents. The right production approach is page-level chunking with document metadata.",
            "Monolithic files: both backend (main.py) and frontend (App.tsx) are single files. Fast to build and deploy, but hard to unit test in isolation. At scale: split backend into routers/services/models and frontend into component files with proper state management.",
            "Sync SDK in async framework: using ThreadPoolExecutor instead of the async Anthropic SDK. Works correctly but has thread overhead. The clean solution is anthropic.AsyncAnthropic + httpx.",
            "search_depth='basic' for Tavily: faster and cheaper than 'advanced', sufficient for first-pass screening. For deeper diligence mode, 'advanced' with longer content snippets would improve claim verification recall.",
        ],
        "Being able to name your tradeoffs — and the direction you'd move in — is a strong signal of engineering maturity.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How does the tool handle multi-document analysis? Why is that important?",
        [
            "Investment processes almost always involve multiple documents: the CIM (seller's narrative), a financial model (the numbers), and sometimes a management presentation (the story they tell in person). These often contradict each other — intentionally or not.",
            "The tool accepts multiple file uploads and runs cross-document conflict detection as a dedicated step. Claude reads all documents simultaneously and explicitly hunts for numerical contradictions — different revenue figures, different EBITDA margins, different market share claims.",
            "The frontend renders Excel files with a sheet-tab viewer and green [[Sheet: X, Doc]] citation links. When Claude cites a conflict from the Excel model, the user can click directly to that sheet. PDFs have inline page navigation synced to claim citations.",
            "This matters because catching a $7M EBITDA discrepancy between a CIM and a financial model is exactly the kind of thing a junior analyst might miss on a fast first read — but that directly affects deal pricing.",
        ],
        "Anchor to the '$7M EBITDA discrepancy' example. Concrete numbers are more memorable than abstract descriptions of features.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How does data persistence work? What's stored and where?",
        [
            "Two-layer persistence: Supabase (cloud Postgres) for structured deal data, IndexedDB (browser-native) for file binaries.",
            "Supabase has 4 tables: deals (top-level record), deal_documents (extracted text per file), deal_analyses (all Claude JSON output — assessment, claims, conflicts, charts, comps stored as JSONB), deal_chat_messages (full conversation history).",
            "IndexedDB stores the actual file binaries (ArrayBuffers) keyed by deal ID. This means if you refresh the page, the PDF viewer still works — the file is cached locally, not requiring re-upload.",
            "The Supabase optionality pattern: the app runs fully in-memory if Supabase isn't configured. supabaseClient.ts exports null when env vars are missing; useDealPersistence.ts checks `if (!supabase) return` before every DB operation. Useful for demos or local development.",
        ],
        "The 'optionality pattern' is a smart engineering decision. Mentioning it shows you thought about developer experience, not just production requirements.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How does the loading experience work? Why did you build it that way?",
        [
            "The analysis pipeline has 6 steps. Rather than showing a spinner for 20–30 seconds with no feedback, I built a step-by-step progress UI: 'Extracting document text' → 'Identifying key claims' → 'Verifying market data' → etc.",
            "Each step advances a loadingStep counter. Completed steps show a green checkmark; the current step shows a pulsing red dot. This gives users a sense of progress and makes the wait feel shorter.",
            "The COMPS tab loads separately — it shows its own loading state while the rest of the analysis is already visible. This is a deliberate UX decision: don't block the primary analysis on a 60-second secondary task.",
            "Principle: in AI applications, perceived latency matters as much as actual latency. Structured loading states transform a 'is it broken?' experience into a 'it's working' experience.",
        ],
        "The principle at the end ('perceived latency matters as much as actual latency') is a product insight worth having in your back pocket.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How would you make this production-ready?",
        [
            "Authentication and multi-tenancy: add Supabase Auth and Row Level Security so each user only sees their own deals. Currently the database has no access controls.",
            "Pydantic validation on all Claude outputs: catch shape mismatches before they reach the frontend rather than letting them cause UI errors.",
            "Rate limiting and cost controls: limit API calls per user, add circuit breakers for Tavily/Anthropic, implement cost tracking per deal.",
            "Async SDK migration: replace ThreadPoolExecutor with anthropic.AsyncAnthropic + httpx for cleaner async patterns.",
            "Evaluation pipeline: build a test harness with known-answer CIMs to measure claim extraction accuracy, verdict quality, and citation correctness across model versions.",
            "Observability: structured logging with request IDs, timing traces per pipeline step, alerting on elevated error rates for Claude/Tavily calls.",
        ],
        "Don't just list features. Lead with auth/multi-tenancy and eval pipeline — those are the two most critical gaps for a real deployment.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How would you scale this to 10× the volume?",
        [
            "The main bottleneck is Claude API rate limits and latency, not compute. At 10× volume, you'd hit token-per-minute limits. Solutions: request queuing (Redis queue with workers), model routing (cheaper model for simpler steps), and caching (skip re-verification for claims seen in similar documents).",
            "Document extraction is CPU-bound (pdfplumber). At scale, parallelize across workers or use a dedicated document processing service.",
            "The stateless FastAPI backend scales horizontally already — just add instances behind a load balancer. Supabase handles connection pooling via PgBouncer.",
            "For comps, consider caching search results by sector/sub-sector — many CIMs in the same space will hit the same Tavily queries.",
        ],
        "The insight that Claude rate limits (not compute) is the real bottleneck at scale shows systems thinking specific to AI applications.",
        s
    ):
        story.append(item)

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════
    # SECTION 5 — CHALLENGES & FAILURES
    # ════════════════════════════════════════════════════════════
    story.append(SectionHeader("5", "Challenges, Failures & Tradeoffs"))
    story.append(sp(2))

    for item in qa_block(
        "What was the hardest technical problem you faced?",
        [
            "Page citation accuracy. I assumed Claude would naturally cite page numbers correctly from a PDF. It didn't. The problem: PDFs have printed footer numbers ('CONFIDENTIAL 19') that don't correspond to actual PDF page positions. Claude was reading 'CONFIDENTIAL 19' as page 19, when the content was actually on PDF page 27.",
            "The fix required three layers: regex stripping of footer patterns, explicit PAGE X OF Y markers injected around each page's text, and a context primer at the top of every document telling Claude to trust only those markers.",
            "The meta-lesson: AI systems can fail in subtle, non-obvious ways that only appear with real production documents. You need to test with the actual messy data, not clean examples.",
        ],
        "This is a strong story because it shows a real problem, a diagnosis process, and a systematic solution — not just 'I fixed a bug'.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "What didn't work that you had to throw out?",
        [
            "My first approach to claim verification was to have Claude write search queries for each claim and then assess them. The results were too generic — Claude would write queries like 'healthcare market growth' instead of 'behavioral health services market CAGR 2023 2024'. I switched to using the exact claim text as the Tavily query, which produces much more targeted results.",
            "I also initially tried to have a single large Claude call do claim extraction AND assessment in one pass. The output quality degraded — the model tried to do too many things at once. Splitting into separate, focused calls (extract claims → verify each → synthesize) produced noticeably better results.",
        ],
        "The 'split into focused calls' insight is valuable — it's a general principle of prompt engineering that applies across many AI applications.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "What are the known weaknesses of the system?",
        [
            "Private company data is mostly unverifiable. CIM claims about private company EBITDA, customer counts, or market share can't be confirmed via web search. This is a structural limitation — Tavily can't find what isn't public. The 'unverifiable' category exists to handle this gracefully.",
            "The 15,000 char truncation for claim extraction means long CIMs lose their back half during this step. For a 100-page CIM, financial projections often appear late in the document and might be missed.",
            "Comps data quality depends entirely on what Tavily finds. M&A transaction data from small-cap or private deals is often sparse online. The data_quality_note guardrail helps, but the comps feature works best for sectors with strong public deal coverage.",
            "No human feedback loop. There's no mechanism for users to mark verdicts as wrong or correct — so the system can't learn from analyst corrections.",
        ],
        "Being proactively honest about weaknesses is a strong interview signal. Interviewers respect candidates who know their system's limits.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "What would you build next if you had 2 more weeks?",
        [
            "An evaluation harness. Take 10 CIMs with known-correct answers and build automated scoring for claim extraction accuracy, verdict correctness, and citation accuracy. This would let me safely iterate on prompts without regression.",
            "Streaming for /analyze. Currently the user waits for the full response. With Server-Sent Events, I could stream step completions — the assessment appears as soon as it's ready, claims appear as each is verified.",
            "Human-in-the-loop corrections. Let analysts mark a verdict as wrong, with a note. Feed those corrections back as few-shot examples in future prompt versions.",
        ],
        "Streaming is technically feasible with FastAPI's StreamingResponse. If asked how, mention FastAPI's EventSourceResponse and streaming the analysis steps as SSE events.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "If you were to rebuild this from scratch, what would you do differently?",
        [
            "Start with async from day one. Using anthropic.AsyncAnthropic instead of ThreadPoolExecutor would result in cleaner code and less complexity.",
            "Modular file structure earlier. A single 800-line main.py is fine for a prototype but accumulates technical debt fast. I'd split into routers/, services/, and models/ from the start.",
            "Typed Pydantic models for all Claude outputs from the beginning. Parsing raw JSON dict responses has no compile-time safety. Pydantic would catch output shape changes immediately.",
            "An eval harness before deploying any new prompt. The page citation problem would have been caught on day one with a test set of known-answer documents.",
        ],
        "The 'eval harness before any new prompt' point is the most sophisticated — it shows you think about AI development as a software engineering discipline, not just iteration by gut feel.",
        s
    ):
        story.append(item)

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════
    # SECTION 6 — ROLE SPECIFIC
    # ════════════════════════════════════════════════════════════
    story.append(SectionHeader("6", "AI Enablement at Sagard — Role-Specific"))
    story.append(sp(2))

    for item in qa_block(
        "What does AI enablement mean to you, in the context of a PE/credit firm?",
        [
            "AI enablement means identifying the highest-leverage places where AI can remove mechanical work from skilled professionals — so they spend more time on judgment, relationships, and decision-making.",
            "At a PE/credit firm specifically: deal sourcing and screening (like this tool), portfolio monitoring (flagging covenant breaches or financial deterioration), due diligence support (document summarization, expert call prep), and LP reporting (synthesizing portfolio company updates).",
            "The principle: AI should augment analyst judgment, not replace it. The right design gives analysts structured AI outputs with clear confidence signals — they stay in control of the decision, the AI handles the information preparation.",
        ],
        "The 'augment, not replace' framing is important at an investment firm audience. Avoid anything that sounds like the AI is making investment decisions.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How would you identify the next AI use case to build at Sagard?",
        [
            "I'd map the daily workflow of analysts and associates — where do they spend time on repeatable, information-intensive tasks? The best AI use cases have these properties: high repetition, structured outputs, measurable quality, and available data to feed the model.",
            "Specifically at a PE/credit firm: portfolio company reporting (reading monthly financials, flagging YoY changes), covenant monitoring (comparing actuals to covenant thresholds), and IC memo prep (summarizing diligence findings into a standard template).",
            "I'd also look at where analyst errors actually happen and cost the firm — citation errors in IC memos, missed covenant triggers, overlooked customer concentration. Those are higher-value targets than tasks where errors have low consequences.",
        ],
        "The 'where do errors happen and cost the firm' framing is more sophisticated than just 'where do analysts spend time'.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How do you think about AI governance and risk at an investment firm?",
        [
            "Three categories of risk. Hallucination risk: AI producing confident-sounding incorrect numbers in an investment context. Mitigated by grounding outputs in source documents with citations, using confidence scores, and requiring human verification for any number used in an IC memo.",
            "Data privacy risk: uploading confidential CIM data to third-party APIs. Anthropic and Tavily both have enterprise data privacy commitments, but the firm's legal team should evaluate these before production deployment. On-premise models are an option for highly sensitive deals.",
            "Automation bias risk: analysts over-trusting AI outputs and under-verifying. Mitigated by UI design — displaying confidence scores, explicitly labeling 'unverifiable' claims, and requiring human sign-off on any AI-generated output before it enters a formal memo.",
        ],
        "Mentioning 'automation bias' as a UI design problem (not just a training problem) is a sophisticated point that distinguishes you from candidates who only think about technical risk.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How would you measure the success of this tool in production?",
        [
            "Time to first decision. How long does it take from CIM receipt to a Pass/Proceed decision? If the tool is working, this should decrease.",
            "Claims validation rate. Track how often analyst review confirms or contradicts Claude's verdicts. Low contradiction rate = model is performing well. High contradiction rate = prompt iteration needed.",
            "Analyst adoption rate. If analysts bypass the tool and read CIMs manually instead, something is wrong — either trust, quality, or UX.",
            "Deal conversion rate. Harder to measure, but ultimately: does using the tool improve the quality of deals that reach IC? Are analysts spending time on the right opportunities?",
        ],
        "Starting with a business metric (time to first decision) before technical metrics (claims validation) shows product maturity.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How does this project demonstrate you can work in a finance domain as an AI engineer?",
        [
            "I had to learn the actual investment frameworks — what PE analysts care about is fundamentally different from VC or credit. The STRATEGY_LENS system required me to understand that PE wants LBO returns and EBITDA growth, while credit wants DSCR and covenant coverage. I didn't guess at those — I studied how investment analysts actually evaluate deals.",
            "The domain knowledge shows up in the prompts. 'Would this generate 20%+ IRR in a 5-year hold?' is the right PE verdict criteria. 'Can this service the debt through a downturn? What's the recovery value if it can't?' is the right credit question. Getting those right requires understanding the actual decision-making framework, not just building a generic document Q&A.",
            "I also designed the output around how analysts actually work — the output of the tool fits into a real workflow: read the summary, click through to the cited pages, bring the key questions to the diligence call, verify the comps before the IC memo.",
        ],
        "The domain knowledge answer is strong. Emphasize that you studied how investment professionals think, not just how to build with Claude.",
        s
    ):
        story.append(item)

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════
    # SECTION 7 — BEHAVIORAL
    # ════════════════════════════════════════════════════════════
    story.append(SectionHeader("7", "Behavioral / Leadership"))
    story.append(sp(2))

    for item in qa_block(
        "Tell me about a time you had to debug something in this project.",
        [
            "The page citation bug was the most instructive debugging experience. Analysts were clicking through to 'Page 19' but the content wasn't there — the PDF was opening to the wrong page.",
            "I initially assumed it was a pdfplumber bug. I logged the extracted text page by page and found that page 27 of the PDF was being correctly extracted — but the text of page 27 contained the footer 'CONFIDENTIAL 19'. Claude was reading that footer number and citing page 19.",
            "Fix: three-layer regex stripping in clean_page_text(), PAGE X OF Y markers around each page, and an explicit context primer. The meta-learning: test AI systems with real, messy production data from the start. My test CIMs were clean — the production CIM had footers.",
        ],
        "Use the STAR format implicitly: situation (wrong page citations), diagnosis (footer number confusion), action (three-layer fix), result (accurate citations). Don't explicitly say 'STAR'.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How do you approach building something when requirements are unclear?",
        [
            "I start by identifying the core user action and what success looks like for that action. For this tool: the core action is 'an analyst uploads a CIM and gets a verdict.' Success means the verdict is fast, accurate, and citable.",
            "Then I build the simplest version that demonstrates the core value — one Claude call, one PDF, one verdict. Get that working and validated before adding claim verification, cross-document analysis, comps, and chat.",
            "I ask: 'what would make this not useful?' That surfaces the must-haves. For this tool: citation accuracy was a must-have (unusable if the page numbers are wrong), concurrency was a nice-to-have initially (slow but usable).",
        ],
        "",
        s
    ):
        story.append(item)

    for item in qa_block(
        "How do you communicate technical concepts to non-technical stakeholders?",
        [
            "I anchor on outcomes, not mechanisms. Not 'Claude Sonnet uses a transformer architecture to parse financial documents' — but 'the system reads the CIM the same way an analyst does, except it cross-references every major claim against real-time internet data automatically.'",
            "I use the before/after framing: 'Before: an analyst reads a 60-page CIM and pulls comps manually — 2–3 hours. After: the tool does the first pass in 30 seconds and surfaces the 6 most important questions to verify.' Concrete numbers make the value tangible.",
            "I'm careful about confidence levels. When presenting AI outputs to stakeholders, I always include the caveats: 'This is a screening tool — verdicts need analyst review, and any number that goes into an IC memo should be independently verified.'",
        ],
        "The caveat at the end ('any number that goes into an IC memo should be independently verified') is critical for building trust with a finance audience. Include it naturally in conversation.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "Where do you see AI in investment management in 5 years?",
        [
            "The first wave is what CIM Analyzer represents: AI as an analyst assistant for repetitive information tasks — screening, summarization, data extraction. This is already happening.",
            "The second wave will be AI with access to live data — portfolio monitoring systems that ingest financial reporting in real time, flag covenant breaches as they emerge, and synthesize performance against plan without a quarterly reporting meeting.",
            "The third wave is more speculative: AI participating in deal sourcing — identifying acquisition targets proactively based on market signals, proprietary data, and portfolio strategy fit. This requires solving trust and governance challenges that aren't solved yet.",
            "What won't change: the judgment layer. IC decisions, LP relationships, portfolio company partnerships — these require human judgment, trust, and accountability that AI won't replace in my career horizon.",
        ],
        "The 'what won't change' ending is important — it shows you're not naively bullish on full automation, which resonates with investment professionals.",
        s
    ):
        story.append(item)

    for item in qa_block(
        "Why do you want this role specifically?",
        [
            "Building this tool showed me that the intersection of AI and investment workflows is underexplored and high-impact. The mechanical work that slows down smart analysts — first-pass reading, data verification, comps pulling — is exactly the work that AI systems can do well. There's a lot of runway.",
            "I want to work at an investment firm specifically because the quality bar is high and the feedback loop is tight. A wrong verdict matters. Citation accuracy matters. That rigor makes you a better AI engineer.",
            "Sagard specifically: the multi-strategy nature (PE, credit, VC) maps directly to the strategy lens system I built. I understand how different investment disciplines ask different questions of the same data — that's a relevant starting point for an AI enablement role here.",
        ],
        "Tailor the last bullet to what you actually know about Sagard. The multi-strategy point is accurate based on the lens system you built — lead with it.",
        s
    ):
        story.append(item)

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════
    # SECTION 8 — QUESTIONS TO ASK
    # ════════════════════════════════════════════════════════════
    story.append(SectionHeader("8", "Questions to Ask the Interviewer"))
    story.append(sp(2))
    story.append(body(
        "Asking sharp questions signals that you've thought seriously about the role. "
        "Aim for 2–3 questions. Never ask about salary, benefits, or what the company does.", s))
    story.append(sp(2))

    questions_to_ask = [
        ("What does AI enablement actually look like in the current workflow?",
         "Where are analysts spending time on mechanical tasks today? Are there existing internal tools, or is this greenfield?"),
        ("How do investment teams currently interact with AI tools — if at all?",
         "What's the adoption rate? Is there skepticism from senior people? What's the primary concern: accuracy, trust, or workflow disruption?"),
        ("What does the data infrastructure look like — how are deal documents stored and managed?",
         "This matters for feasibility of an AI pipeline. If documents live in email attachments and shared drives, the data access problem needs solving first."),
        ("What's the governance model for AI outputs that enter investment decisions?",
         "I want to understand how the firm thinks about human oversight — who reviews AI-generated analysis before it influences a decision?"),
        ("What would a successful first 6 months in this role look like?",
         "Shows you're thinking about impact, not just the interview. Lets you understand expectations before day one."),
    ]

    for q, context in questions_to_ask:
        q_data = [[Paragraph(f"<b>{q}</b>",
            ParagraphStyle('qask', fontName='Helvetica-Bold', fontSize=9.5, textColor=QBLUE, leading=14))]]
        qt = Table(q_data, colWidths=[7.5*inch])
        qt.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), BGBLUE),
            ('LEFTPADDING', (0,0), (-1,-1), 10),
            ('RIGHTPADDING', (0,0), (-1,-1), 10),
            ('TOPPADDING', (0,0), (-1,-1), 7),
            ('BOTTOMPADDING', (0,0), (-1,-1), 7),
            ('LINEBELOW', (0,0), (-1,-1), 1.5, HexColor("#3b82f6")),
        ]))
        story.append(qt)
        ctx_data = [[Paragraph(f"<i>{context}</i>",
            ParagraphStyle('ctx', fontName='Helvetica-Oblique', fontSize=8.5, textColor=HexColor("#374151"), leading=13))]]
        ct = Table(ctx_data, colWidths=[7.5*inch])
        ct.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), BGGRAY),
            ('LEFTPADDING', (0,0), (-1,-1), 10),
            ('RIGHTPADDING', (0,0), (-1,-1), 10),
            ('TOPPADDING', (0,0), (-1,-1), 5),
            ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ]))
        story.append(ct)
        story.append(sp(2))

    story.append(PageBreak())

    # ── QUICK REFERENCE BACK PAGE ──────────────────────────────
    story.append(SectionHeader("", "Quick Reference — Key Numbers & Facts"))
    story.append(sp(2))

    story.append(h2("Numbers to Have Ready", s))
    nums_data = [
        ["Metric", "Value", "Context"],
        ["Claude calls per /analyze", "4–10 total", "1 extract + 6 verify (parallel) + 1 assess + 1 charts + optionally 1 conflict"],
        ["Claim verification concurrency", "6 parallel threads", "ThreadPoolExecutor(max_workers=6)"],
        ["Sequential vs parallel verify time", "~36s vs ~8s", "6 × (2s Tavily + 4s Claude) sequential; parallel = slowest single claim"],
        ["Primary doc chars sent to Claude", "15,000 chars", "First pass for claim extraction and charts (~8–10 pages)"],
        ["Full assembled doc char limit", "80,000 chars", "For cross-doc conflict detection and chat context"],
        ["COMPS pipeline time", "30–60 seconds", "Why it's non-blocking (fires after /analyze returns)"],
        ["Max Tavily results per claim", "3 results, 300 chars each", "search_depth='basic', top 3 only"],
        ["Max Tavily results for comps", "5 results × 4 queries, 600 chars each", "More context needed for M&A transaction extraction"],
        ["Supabase tables", "4 tables", "deals, deal_documents, deal_analyses, deal_chat_messages"],
        ["Strategy lenses", "4 lenses", "Private Equity, Private Credit, Venture Capital, Real Estate"],
        ["Confidence score range", "1–5", "1=no data found, 5=strong direct corroboration"],
    ]
    story.append(make_table(nums_data, [2.5*inch, 1.8*inch, 3.2*inch]))

    story.append(sp(2))
    story.append(h2("Key Vocabulary to Use", s))
    vocab_data = [
        ["Term", "Use it when..."],
        ["Strategy lens", "Explaining how the system adapts analysis to investor type"],
        ["Concurrent claim verification", "Describing the parallelism in the pipeline"],
        ["Grounded generation", "Explaining why Claude has low hallucination risk — it reasons over provided evidence"],
        ["Structured output enforcement", "Describing the JSON-only output prompt strategy"],
        ["Citation integrity", "Describing the page number accuracy system"],
        ["Cross-document conflict detection", "The multi-file analysis feature"],
        ["Async non-blocking", "Why COMPS fires after /analyze and doesn't delay the response"],
        ["Supabase optionality pattern", "The null-check pattern for running without a database"],
        ["ThreadPoolExecutor / asyncio.gather", "The specific concurrency mechanism"],
        ["data_quality_note", "The built-in disclaimer on COMPS outputs"],
        ["Evaluation harness", "What you'd build next to measure prompt quality systematically"],
    ]
    story.append(make_table(vocab_data, [2.2*inch, 5.3*inch]))

    # ── BUILD ──────────────────────────────────────────────────
    doc = SimpleDocTemplate(
        "CIM_Interview_QA.pdf",
        pagesize=letter,
        rightMargin=0.5*inch,
        leftMargin=0.5*inch,
        topMargin=0.65*inch,
        bottomMargin=0.65*inch,
    )
    doc.build(story, onFirstPage=cover_page, onLaterPages=header_footer)
    print("OK: CIM_Interview_QA.pdf generated")


if __name__ == "__main__":
    build_pdf()
