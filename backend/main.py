from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import pdfplumber
import anthropic
import requests
import json
import io
import os

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

SECTOR_EXTRACT_FOCUS = {
    "Private Equity": (
        "Focus on: EBITDA margins and growth, revenue CAGR, customer concentration (top 10 customers as % of revenue), "
        "market share claims, competitive moat, and any exit comparable references."
    ),
    "Private Credit": (
        "Focus on: EBITDA and free cash flow figures, leverage multiples, interest coverage ratios, "
        "debt capacity claims, downside scenario references, and any covenant or liquidity mentions."
    ),
    "Venture Capital": (
        "Focus on: TAM/SAM size claims, MoM/YoY growth rates, unit economics (CAC, LTV, payback period), "
        "team background claims, and market share or competitive positioning assertions."
    ),
    "Real Estate": (
        "Focus on: cap rate claims, NOI figures, occupancy rates, market rent vs. in-place rent, "
        "lease term and tenant quality claims, and market comparable references."
    ),
}

SECTOR_ANALYZE_LENS = {
    "Private Equity": (
        "Apply a PE lens: flag anything relevant to multiple expansion potential, operational improvement levers, "
        "or exit comparable credibility."
    ),
    "Private Credit": (
        "Apply a credit lens: flag anything relevant to EBITDA coverage ratios, debt capacity, downside scenarios, "
        "or covenant headroom."
    ),
    "Venture Capital": (
        "Apply a VC lens: flag market size credibility, team background verifiability, and growth rate sustainability."
    ),
    "Real Estate": (
        "Apply a real estate lens: flag cap rate assumptions, occupancy claims vs. market, "
        "and rent comparables."
    ),
}


def build_criteria_context(
    min_ebitda: str,
    deal_size_range: str,
    target_sectors: str,
    geography: str,
    sector: str,
) -> str:
    """Returns a formatted criteria string if any fields are set, otherwise empty string."""
    parts = []
    if min_ebitda:
        parts.append(f"Minimum EBITDA: {min_ebitda}")
    if deal_size_range:
        parts.append(f"Deal size range: {deal_size_range}")
    if target_sectors:
        parts.append(f"Target sectors: {target_sectors}")
    if geography:
        parts.append(f"Geography: {geography}")
    if not parts:
        return ""
    return "INVESTOR CRITERIA:\n" + "\n".join(f"- {p}" for p in parts)


def extract_pdf_text(file_bytes: bytes) -> str:
    text = ""
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text += f"\n--- Page {page.page_number} ---\n{page_text}"
    return text


def extract_all_documents_text(files_bytes: list[tuple[str, bytes]]) -> dict:
    """Returns {filename: extracted_text} for all uploaded files."""
    return {filename: extract_pdf_text(data) for filename, data in files_bytes}


def extract_claims(text: str, sector: str, criteria_context: str = "") -> list:
    sector_focus = SECTOR_EXTRACT_FOCUS.get(sector, SECTOR_EXTRACT_FOCUS["Private Equity"])
    # Only inject criteria block when non-empty; cap at 500 chars to avoid bloat
    criteria_section = ""
    if criteria_context and criteria_context.strip():
        criteria_section = "\n" + criteria_context.strip()[:500] + "\n"

    prompt = (
        f"You are a senior {sector} analyst doing a first-pass on a CIM.\n\n"
        "Extract the 8-10 MOST IMPACTFUL verifiable claims — the ones that would actually change whether you pursue this deal.\n\n"
        "Prioritize (in order of importance):\n"
        "1. Revenue / EBITDA / margin claims with specific numbers\n"
        "2. Market size and growth rate claims\n"
        "3. Competitive position claims (market share, named moat)\n"
        "4. Customer concentration claims\n"
        "5. Key operational metrics\n\n"
        f"{sector_focus}"
        f"{criteria_section}\n"
        "Skip: vague qualitative statements, mission statements, aspirational language, "
        "anything that cannot be fact-checked against external data.\n\n"
        "Return ONLY a valid JSON array, no other text:\n"
        "[\n"
        "  {\n"
        '    "id": 1,\n'
        '    "claim": "specific, checkable statement — quote or close paraphrase",\n'
        '    "page": 1,\n'
        '    "category": "financial | market | competitive | operational",\n'
        '    "verifiable": true,\n'
        '    "why_it_matters": "one sentence: why this claim affects the investment thesis"\n'
        "  }\n"
        "]\n\n"
        "CIM TEXT:\n"
        f"{text[:12000]}"
    )

    try:
        response = claude.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=2500,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as e:
        print(f"Claude API error in extract_claims: {e}")
        raise

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def search_claim(claim: str) -> list:
    response = requests.post(
        "https://api.tavily.com/search",
        json={
            "api_key": TAVILY_API_KEY,
            "query": claim,
            "max_results": 3,
            "search_depth": "basic"
        }
    )
    results = response.json().get("results", [])
    return [{"title": r.get("title"), "url": r.get("url"), "content": r.get("content", "")[:300]} for r in results]


def analyze_claim(claim: dict, search_results: list, sector: str) -> dict:
    sector_lens = SECTOR_ANALYZE_LENS.get(sector, SECTOR_ANALYZE_LENS["Private Equity"])

    try:
        response = claude.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=800,
            messages=[{
                "role": "user",
                "content": f"""You are a senior {sector} analyst. Assess this CIM claim against the search evidence. Be direct — no hedging, no filler.

CLAIM: "{claim['claim']}"
WHY IT MATTERS: "{claim.get('why_it_matters', '')}"
SECTOR LENS: {sector_lens}

SEARCH RESULTS:
{json.dumps(search_results, indent=2)}

Rules:
- explanation: MAX 2 sentences. If verified: state the corroborating evidence. If disputed: state exactly what conflicts and by how much. If unverifiable: one sentence on why it can't be checked externally, then one sentence on what the analyst should do about it.
- confidence: 1-5. No external data = 1. Directionally supported = 3. Strong corroboration = 5. Be honest — don't default to 3.
- materiality: how much does this specific claim matter to the overall investment thesis?

Return ONLY valid JSON, no other text:
{{
  "verdict": "verified | disputed | unverifiable",
  "explanation": "max 2 sentences, direct and specific",
  "sources": [{{"title": "", "url": ""}}],
  "confidence": 3,
  "materiality": "high | medium | low",
  "diligence_question": "specific question to ask management — not generic, tied to this claim"
}}"""
            }]
        )
    except Exception as e:
        print(f"Claude API error in analyze_claim: {e}")
        raise

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def find_cross_document_conflicts(documents: dict, sector: str) -> list:
    """Single Claude call across all document texts to surface contradictions."""
    doc_blocks = "\n\n".join([
        f"=== DOCUMENT: {filename} ===\n{text[:8000]}"
        for filename, text in documents.items()
    ])

    try:
        response = claude.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4000,
            messages=[{
                "role": "user",
                "content": f"""You are a senior {sector} analyst reviewing multiple documents from the same deal package. Your job is to find every numerical contradiction between these documents. Be aggressive — if two documents state different numbers for the same metric, that is a conflict and must be flagged.

Scan every document exhaustively for these specific data points, then compare across documents:

NUMERICAL (flag any mismatch, no matter how small):
- Revenue figures (LTM, projected, historical) — exact dollar amounts
- EBITDA and EBITDA margins — exact dollar amounts and percentages
- Slot machine counts and table game counts
- Hotel room counts and hotel capacity figures
- Market growth rates and visitor/traffic numbers
- Capital expenditure totals and project budgets
- Land acreage and property size claims
- Headcount and employee figures
- Customer concentration percentages
- Any other specific dollar, unit, or percentage figures

NARRATIVE (flag direct contradictions):
- Competitive positioning described differently across documents
- Market share claims that conflict
- Timeline or milestone dates that don't align
- Strategy or product descriptions that contradict each other

DOCUMENTS:
{doc_blocks}

Return ONLY a valid JSON array. If no real contradictions exist, return []. Do not manufacture contradictions — only flag genuine discrepancies where two documents state different values for the same thing.

[
  {{
    "doc1": "exact filename as shown above",
    "doc2": "exact filename as shown above",
    "claim1": "what doc1 specifically states, including the exact number",
    "claim2": "what doc2 specifically states, including the exact number",
    "severity": "high | medium | low",
    "explanation": "1 sentence: the specific discrepancy and why it matters to the investment decision"
  }}
]

Severity:
- high: any numerical discrepancy on a material figure (revenue, EBITDA, unit counts), or a direct contradiction on a key investment thesis point
- medium: minor numerical difference (<10%) or meaningfully different framing of a material claim
- low: different level of detail or emphasis, not necessarily contradictory"""
            }]
        )
    except Exception as e:
        print(f"Claude API error in find_cross_document_conflicts: {e}")
        raise

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        return json.loads(raw.strip())
    except json.JSONDecodeError:
        # Response was truncated — return whatever complete objects we can salvage
        text = raw.strip()
        salvaged = []
        depth = 0
        start = None
        for i, ch in enumerate(text):
            if ch == "{":
                if depth == 0:
                    start = i
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0 and start is not None:
                    try:
                        salvaged.append(json.loads(text[start:i + 1]))
                    except json.JSONDecodeError:
                        pass
                    start = None
        return salvaged


def get_overall_assessment(claims_with_verdicts: list, sector: str, criteria_context: str = "") -> dict:
    criteria_section = f"\n{criteria_context}\n" if criteria_context else ""
    criteria_fit_field = ""
    if criteria_context:
        criteria_fit_field = """  "criteria_fit": {
    "fits": true,
    "explanation": "1 sentence: does this deal fit the specified investor criteria above?"
  },"""

    try:
        response = claude.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1500,
            messages=[{
                "role": "user",
                "content": f"""You are a senior Sagard {sector} analyst. You just read this CIM on the train and are giving a 2-minute verbal briefing to a partner. Be direct, specific, no fluff. Sound like a sharp senior associate — not a report.

SECTOR: {sector}
{criteria_section}
CLAIMS ANALYSIS:
{json.dumps(claims_with_verdicts, indent=2)}

Return ONLY valid JSON, no other text:
{{
  "overall_verdict": "Worth deeper look | Borderline | Pass",
  "company_snapshot": "2 sentences max: what does this company actually do, and what are they selling in this CIM? Plain English.",
  "sellers_narrative": "1 sentence: what story is the seller trying to tell?",
  "narrative_holds_up": {{
    "holds": true,
    "explanation": "1 sentence: does the claim evidence actually support that narrative?"
  }},
  "reasoning": "2-3 sentences MAX. Sound like a partner talking to an associate — direct and specific. Name the specific things that drove the verdict.",
  {criteria_fit_field}
  "top_risks": [
    "1 sentence, specific and actionable — not generic",
    "1 sentence, specific and actionable — not generic",
    "1 sentence, specific and actionable — not generic"
  ],
  "bull_case": "1 sentence: the single strongest argument for this deal",
  "key_questions": [
    "strategic-level question an analyst must answer before proceeding",
    "strategic-level question an analyst must answer before proceeding",
    "strategic-level question an analyst must answer before proceeding"
  ],
  "summary_stats": {{
    "verified": 0,
    "disputed": 0,
    "unverifiable": 0
  }}
}}"""
            }]
        )
    except Exception as e:
        print(f"Claude API error in get_overall_assessment: {e}")
        raise

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


@app.post("/analyze")
async def analyze_cim(
    files: list[UploadFile] = File(...),
    sector: str = Form(default="Private Equity"),
    min_ebitda: str = Form(default=""),
    deal_size_range: str = Form(default=""),
    target_sectors: str = Form(default=""),
    geography: str = Form(default=""),
):
    # Step 1: read and extract text from all files
    files_bytes = [(f.filename or f"document_{i+1}.pdf", await f.read()) for i, f in enumerate(files)]
    documents = extract_all_documents_text(files_bytes)

    primary_filename = files_bytes[0][0]
    primary_text = documents[primary_filename]

    # Build criteria context (empty string if no criteria provided)
    criteria_context = build_criteria_context(min_ebitda, deal_size_range, target_sectors, geography, sector)

    # Step 2: extract claims from primary CIM
    claims = extract_claims(primary_text, sector, criteria_context)

    # Step 3: search + analyze each claim
    analyzed_claims = []
    for claim in claims:
        if claim.get("verifiable"):
            search_results = search_claim(claim["claim"])
            analysis = analyze_claim(claim, search_results, sector)
            analyzed_claims.append({**claim, **analysis})

    # Step 4: overall assessment
    assessment = get_overall_assessment(analyzed_claims, sector, criteria_context)

    # Step 5: cross-document conflict detection (only with multiple files)
    cross_document_conflicts = []
    if len(files_bytes) > 1:
        cross_document_conflicts = find_cross_document_conflicts(documents, sector)

    combined_text = "\n\n".join(documents.values())[:80000]

    return {
        "assessment": assessment,
        "claims": analyzed_claims,
        "cross_document_conflicts": cross_document_conflicts,
        "document_text": combined_text,
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat")
async def chat_with_documents(
    message: str = Form(...),
    document_text: str = Form(...),
    history: str = Form(default="[]"),
):
    try:
        conversation_history = json.loads(history)
    except json.JSONDecodeError:
        conversation_history = []

    system_prompt = (
        "You are an investment analyst assistant. You have been given the full text of deal documents uploaded by the analyst. "
        "Answer questions precisely and concisely. Always cite the specific location (page number, section name, or document name) "
        "where you found the information. If a piece of information is not in the documents, say so explicitly — do not guess. "
        "Flag anything that looks like a red flag for a PE or credit investor."
    )

    messages = [
        {"role": "user", "content": f"DEAL DOCUMENTS:\n\n{document_text}"},
        {"role": "assistant", "content": "I have reviewed the deal documents. I'm ready to answer your questions."},
    ]
    for msg in conversation_history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": message})

    try:
        response = claude.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1000,
            system=system_prompt,
            messages=messages,
        )
        return {"response": response.content[0].text}
    except Exception as e:
        print(f"Claude API error in chat_with_documents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/test-claude")
def test_claude():
    try:
        response = claude.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=50,
            messages=[{"role": "user", "content": "Reply with: OK"}],
        )
        return {"status": "ok", "response": response.content[0].text.strip()}
    except Exception as e:
        return {"status": "error", "error": str(e)}
