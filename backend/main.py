from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import pdfplumber
import anthropic
import requests
import json
import io
import os
import re
import time
import asyncio
from concurrent.futures import ThreadPoolExecutor

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://*.vercel.app",
        "https://cim-analyzer.vercel.app",
        "*",  # temporary for demo — restrict in production
    ],
    allow_credentials=True,
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


def clean_page_text(text: str) -> str:
    """
    Strip printed footer lines that contain internal document page numbers.
    These cause Claude to cite the wrong page (e.g. 'CONFIDENTIAL 19' on PDF page 27).
    The regexes are ordered from most-specific to most-general to avoid over-stripping.
    """
    # "Bear, Stearns & Co. Inc. CONFIDENTIAL 19" (and minor punctuation variants)
    text = re.sub(
        r'Bear,?\s*Stearns?\s*&\s*Co\.?\s*Inc\.?\s*CONFIDENTIAL\s+\d+',
        '', text, flags=re.IGNORECASE
    )
    # Standalone "CONFIDENTIAL 19" line (with optional surrounding whitespace)
    text = re.sub(
        r'^\s*CONFIDENTIAL\s+\d+\s*$',
        '', text, flags=re.MULTILINE | re.IGNORECASE
    )
    # Lone page-number line at the very end of a page block: a single integer
    # on its own line, 1–3 digits, not preceded or followed by other text on that line.
    # Anchor to end-of-string so we only strip the final trailing number.
    text = re.sub(r'\n\s*\d{1,3}\s*$', '', text)
    return text.strip()


def extract_pdf_text(file_bytes: bytes) -> str:
    pages_text = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        total = len(pdf.pages)
        for i, page in enumerate(pdf.pages):
            page_num = i + 1  # 1-based, matches the PDF viewer exactly
            body = page.extract_text() or ""

            # Strip printed footer numbers before they can mislead Claude
            body = clean_page_text(body)

            # Extract tables and append as structured text
            tables = page.extract_tables()
            table_text = ""
            for table in tables:
                for row in table:
                    if row:
                        clean_row = [str(cell or "").strip() for cell in row]
                        table_text += " | ".join(clean_row) + "\n"

            if table_text.strip():
                body += "\n[TABLES ON THIS PAGE]:\n" + table_text

            # Always include every page — blank pages get a placeholder so that
            # page numbers stay perfectly in sync with the PDF viewer.
            content = body.strip() if body.strip() else "[No extractable text on this page]"
            pages_text.append(
                f"\n\n{'=' * 60}\n"
                f"PAGE {page_num} OF {total}\n"
                f"{'=' * 60}\n"
                f"{content}"
            )

    # Prepend a note that Claude reads first, before any page content.
    # This primes it to trust the PAGE X OF Y markers over any numbers in the text.
    extraction_note = (
        "DOCUMENT EXTRACTION NOTE: This document may contain internal printed page numbers "
        "(e.g. confidentiality footers or slide numbers) that DO NOT match the actual PDF "
        "page positions. Always use the PAGE X OF Y markers for citations — never the "
        "printed numbers found within page content.\n"
    )
    return extraction_note + "\n".join(pages_text)


def extract_all_documents_text(files_bytes: list[tuple[str, bytes]]) -> dict:
    """Returns {filename: extracted_text} for all uploaded files."""
    return {filename: extract_pdf_text(data) for filename, data in files_bytes}


def assemble_document_text(documents: dict, char_limit: int = 80000) -> str:
    """
    Concatenate all document texts with clear DOCUMENT boundary headers so Claude
    always knows which file each PAGE marker belongs to.  Truncates at a page
    boundary (never mid-marker) and appends an explicit truncation notice.
    """
    parts = []
    boundary = "#" * 60
    for filename, text in documents.items():
        header = (
            f"{boundary}\n"
            f"DOCUMENT: {filename}\n"
            f"Page numbers below are physical page numbers for this document only.\n"
            f"They match exactly what the PDF viewer shows.\n"
            f"{boundary}"
        )
        parts.append(header + "\n" + text)

    full_text = "\n\n".join(parts)

    if len(full_text) <= char_limit:
        return full_text

    # Truncate at the last complete page marker before the limit so we never
    # cut through a ====PAGE X OF Y==== header and confuse Claude.
    page_marker = "\n\n" + "=" * 60 + "\n"
    truncate_at = full_text.rfind(page_marker, 0, char_limit)
    if truncate_at > 0:
        full_text = full_text[:truncate_at].rstrip()
    else:
        full_text = full_text[:char_limit]

    full_text += "\n\n[TRUNCATED — remaining pages not included in this context]"
    return full_text


def extract_claims(text: str, sector: str, criteria_context: str = "") -> list:
    sector_focus = SECTOR_EXTRACT_FOCUS.get(sector, SECTOR_EXTRACT_FOCUS["Private Equity"])
    # Only inject criteria block when non-empty; cap at 500 chars to avoid bloat
    criteria_section = ""
    if criteria_context and criteria_context.strip():
        criteria_section = "\n" + criteria_context.strip()[:500] + "\n"

    prompt = (
        f"You are a senior {sector} analyst doing a first-pass on a CIM.\n\n"
        "Extract the 6 MOST IMPACTFUL verifiable claims — the ones that would actually change whether you pursue this deal.\n\n"
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
        f"{text}"
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


def extract_financial_charts_data(text: str, sector: str) -> dict:
    prompt = (
        "You are a financial analyst. Extract structured data from these deal documents to populate two charts. "
        "Return ONLY valid JSON with no other text, in exactly this format:\n"
        '{\n'
        '  "margin_trend": {\n'
        '    "years": [2001, 2002, 2003, 2004, 2005, 2006],\n'
        '    "revenue_growth": [null, 12.3, 8.1, 15.2, 10.4, -2.1],\n'
        '    "ebitda_margin": [11.6, 12.5, 16.8, 24.1, 27.3, 21.3],\n'
        '    "revenue_absolute": [null, 280.1, 302.5, 348.2, 384.1, 385.7]\n'
        '  },\n'
        '  "deal_scorecard": {\n'
        '    "dimensions": [\n'
        '      {"name": "Market Position", "score": 6, "reasoning": "one sentence"},\n'
        '      {"name": "Financial Health", "score": 4, "reasoning": "one sentence"},\n'
        '      {"name": "Management Quality", "score": 5, "reasoning": "one sentence"},\n'
        '      {"name": "Growth Trajectory", "score": 3, "reasoning": "one sentence"},\n'
        '      {"name": "Competitive Moat", "score": 4, "reasoning": "one sentence"},\n'
        '      {"name": "Deal Terms", "score": 3, "reasoning": "one sentence"}\n'
        '    ],\n'
        '    "overall_score": 4.2\n'
        '  }\n'
        '}\n\n'
        "Rules:\n"
        "- Scores are 1-10 where 10 is best\n"
        "- Use null for years where data is genuinely not available\n"
        "- revenue_growth is year-over-year percentage change\n"
        "- ebitda_margin is EBITDA as percentage of revenue\n"
        "- Only include years explicitly mentioned in the documents\n"
        "- For the scorecard, base scores strictly on what the documents say — do not assume anything positive that isn't stated\n"
        "- overall_score is the average of all dimension scores rounded to 1 decimal\n\n"
        "DEAL DOCUMENTS:\n"
        f"{text[:15000]}"
    )

    try:
        response = claude.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())
    except Exception as e:
        print(f"Error in extract_financial_charts_data: {e}")
        return {
            "margin_trend": {"years": [], "revenue_growth": [], "ebitda_margin": [], "revenue_absolute": []},
            "deal_scorecard": {"dimensions": [], "overall_score": 0},
        }


@app.post("/analyze")
async def analyze_cim(
    files: list[UploadFile] = File(...),
    sector: str = Form(default="Private Equity"),
    min_ebitda: str = Form(default=""),
    deal_size_range: str = Form(default=""),
    target_sectors: str = Form(default=""),
    geography: str = Form(default=""),
):
    start_total = time.time()
    print(f"[TIMING] Analysis started")

    # Step 1: read and extract text from all files
    files_bytes = [(f.filename or f"document_{i+1}.pdf", await f.read()) for i, f in enumerate(files)]
    documents = extract_all_documents_text(files_bytes)
    print(f"[TIMING] PDF extraction: {time.time() - start_total:.1f}s")

    primary_filename = files_bytes[0][0]
    primary_text = documents[primary_filename]

    # Build criteria context (empty string if no criteria provided)
    criteria_context = build_criteria_context(min_ebitda, deal_size_range, target_sectors, geography, sector)

    # Step 2: extract claims from primary CIM (truncated to keep Claude fast)
    claims = extract_claims(primary_text[:15000], sector, criteria_context)
    print(f"[TIMING] Claims extraction: {time.time() - start_total:.1f}s")

    # Step 3: search + analyze each claim concurrently using a thread pool
    # (Tavily and Claude SDK are sync — run them in parallel threads)
    def search_and_analyze(claim: dict) -> dict:
        search_results = search_claim(claim["claim"])
        analysis = analyze_claim(claim, search_results, sector)
        return {**claim, **analysis}

    verifiable_claims = [c for c in claims if c.get("verifiable")]
    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = [loop.run_in_executor(executor, search_and_analyze, claim) for claim in verifiable_claims]
        analyzed_claims = list(await asyncio.gather(*futures))
    print(f"[TIMING] Web verification ({len(verifiable_claims)} claims): {time.time() - start_total:.1f}s")

    combined_text = assemble_document_text(documents, char_limit=80000)

    # Step 4 + 6: overall assessment and chart data in parallel
    with ThreadPoolExecutor(max_workers=2) as executor:
        assessment_future = loop.run_in_executor(
            executor, get_overall_assessment, analyzed_claims, sector, criteria_context
        )
        charts_future = loop.run_in_executor(
            executor, extract_financial_charts_data, primary_text[:15000], sector
        )
        assessment, charts_data = await asyncio.gather(assessment_future, charts_future)
    print(f"[TIMING] Overall assessment + charts: {time.time() - start_total:.1f}s")

    # Step 5: cross-document conflict detection (only with multiple files)
    cross_document_conflicts = []
    if len(files_bytes) > 1:
        cross_document_conflicts = find_cross_document_conflicts(documents, sector)
        print(f"[TIMING] Cross-doc conflicts: {time.time() - start_total:.1f}s")

    print(f"[TIMING] Total: {time.time() - start_total:.1f}s")

    return {
        "assessment": assessment,
        "claims": analyzed_claims,
        "cross_document_conflicts": cross_document_conflicts,
        "document_text": combined_text,
        "charts_data": charts_data,
        "documents_text": documents,
    }


def extract_deal_profile(assessment: dict, doc_text_preview: str, sector: str) -> dict:
    """Use Claude to extract a searchable deal profile and generate targeted search queries."""
    prompt = f"""You are a senior {sector} analyst. Extract a deal profile for comparable M&A transaction research.

ASSESSMENT:
Company snapshot: {assessment.get('company_snapshot', '')}
Seller narrative: {assessment.get('sellers_narrative', '')}
Reasoning: {assessment.get('reasoning', '')}
Bull case: {assessment.get('bull_case', '')}

DOCUMENT EXCERPT (first 5000 chars):
{doc_text_preview[:5000]}

Return ONLY valid JSON with no other text:
{{
  "sector": "broad sector (e.g. Gaming & Hospitality, Healthcare Services, Business Services, Industrial)",
  "sub_sector": "specific sub-sector (e.g. Regional Casino, Behavioral Health, B2B SaaS, Specialty Manufacturing)",
  "description": "2-sentence description for comp search context — be specific about size, geography, business model",
  "revenue_millions": 385,
  "ebitda_millions": 91,
  "ebitda_margin_pct": 23.6,
  "geography": "e.g. US Sunbelt, Western US, North America, Midwest",
  "business_model": "e.g. asset-heavy, subscription, fee-based, project-based",
  "search_queries": [
    "4 specific search queries designed to surface real M&A transaction data with multiples"
  ]
}}

For search_queries, write exactly 4 queries that will return actual deal data. Think like an analyst searching Bloomberg or PitchBook. Examples of good queries:
- "regional casino acquisition enterprise value EBITDA multiple 2022 2023 2024"
- "gaming hospitality private equity buyout deal value 2023 2024"
- "casino resort sold acquisition announced deal price millions"
- "comparable transactions regional gaming M&A EV EBITDA leveraged buyout"

Tailor queries specifically to this sector and deal type. Use null for financial fields if genuinely unknown."""

    try:
        response = claude.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())
    except Exception as e:
        print(f"Error in extract_deal_profile: {e}")
        raise


def run_comps_searches(deal_profile: dict) -> list:
    """Run Tavily searches for comparable M&A transactions."""
    queries = deal_profile.get("search_queries", [])[:4]
    all_results = []
    for query in queries:
        try:
            response = requests.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": TAVILY_API_KEY,
                    "query": query,
                    "max_results": 5,
                    "search_depth": "basic"
                }
            )
            results = response.json().get("results", [])
            for r in results:
                all_results.append({
                    "query": query,
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "content": r.get("content", "")[:600]
                })
        except Exception as e:
            print(f"Tavily comps search error for '{query}': {e}")
    return all_results


def extract_comps_from_search(deal_profile: dict, search_results: list, sector: str) -> dict:
    """Use Claude to extract structured comp data from search results with institutional rigor."""
    revenue = deal_profile.get("revenue_millions")
    ebitda = deal_profile.get("ebitda_millions")
    margin = deal_profile.get("ebitda_margin_pct")

    prompt = f"""You are a senior {sector} analyst at a top-tier investment bank. You have web search results for comparable M&A transactions. Extract structured comp data with the rigor you'd apply in a Goldman or Lazard pitch book.

DEAL PROFILE (the target company being analyzed):
Sector: {deal_profile.get('sector', 'Unknown')} / {deal_profile.get('sub_sector', '')}
Description: {deal_profile.get('description', '')}
Revenue: ${revenue}M | EBITDA: ${ebitda}M ({margin}% margin)
Geography: {deal_profile.get('geography', 'Unknown')}
Business model: {deal_profile.get('business_model', 'Unknown')}

SEARCH RESULTS:
{json.dumps(search_results, indent=2)}

EXTRACTION RULES:
1. Include ONLY real, confirmed M&A transactions found in the search results — not rumors, not projections, not public company trading multiples
2. Be skeptical — if a transaction isn't clearly documented in the results, exclude it entirely
3. Better 3 confirmed comps than 8 speculative ones
4. If EV and EBITDA are both stated but the multiple isn't, calculate it; label derived figures
5. For each comp, explain WHY it's comparable to THIS specific deal and the most important difference

Return ONLY valid JSON with no other text:
{{
  "comps": [
    {{
      "company": "Target company name",
      "acquirer": "Acquirer name or 'Undisclosed'",
      "date": "Q1 2023 or just 2023",
      "ev_millions": 850,
      "ev_ebitda": 9.5,
      "ev_revenue": 2.1,
      "why_comparable": "1 sentence: the specific attribute that makes this comp directly relevant — be precise, name the similarity",
      "key_difference": "1 sentence: the most important way this comp differs — size, geography, margin profile, asset quality, etc.",
      "source_url": "url or null"
    }}
  ],
  "sector_context": {{
    "typical_ev_ebitda_low": 7.0,
    "typical_ev_ebitda_high": 12.0,
    "multiple_drivers": [
      "specific driver of premium multiples in this sector (1 sentence)",
      "another premium driver"
    ],
    "discount_drivers": [
      "specific driver of discount multiples (1 sentence)",
      "another discount driver"
    ]
  }},
  "this_deal_positioning": {{
    "implied_ev_ebitda": null,
    "implied_ev_revenue": null,
    "vs_comp_set": "In line | Premium | Discount | Cannot determine",
    "rationale": "1-2 sentences on where this deal sits vs the comp set — be specific"
  }},
  "valuation_context": "2-3 paragraph written synthesis — the quality of a pitch book page. What do these comps tell us about this deal's valuation? Cite specific comps by name. What would justify a premium or discount relative to the median? What should the buyer push back on? Be direct, no hedging.",
  "data_quality_note": "1 sentence noting that comps are sourced from public web data and may be incomplete or inaccurate — analysts should verify with PitchBook, CapIQ, or Bloomberg before using in any IC memo."
}}

CRITICAL: Only include comps with real data confirmed in the search results. If fewer than 3 credible comps are found, return what you found and be transparent about the gap."""

    try:
        response = claude.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=3500,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw.strip())
        result["deal_profile"] = deal_profile
        return result
    except Exception as e:
        print(f"Error in extract_comps_from_search: {e}")
        raise


@app.post("/comps")
async def get_comparable_transactions(
    assessment_json: str = Form(...),
    document_text_preview: str = Form(default=""),
    sector: str = Form(default="Private Equity"),
):
    """
    Comparable transaction analysis. Called by the frontend after /analyze completes.
    Runs independently so main analysis results are not blocked.
    """
    try:
        assessment = json.loads(assessment_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid assessment JSON")

    # Step 1: Extract deal profile + generate targeted search queries
    deal_profile = extract_deal_profile(assessment, document_text_preview, sector)

    # Step 2: Run Tavily searches
    search_results = run_comps_searches(deal_profile)

    # Step 3: Extract structured comps from search results
    comps_data = extract_comps_from_search(deal_profile, search_results, sector)

    return comps_data


@app.post("/extract")
async def extract_document(file: UploadFile = File(...)):
    """Extract text from a single document (PDF only). Used by the file explorer to add documents."""
    content = await file.read()
    filename = file.filename or "document.pdf"
    if not filename.lower().endswith(".pdf"):
        return {"text": ""}
    text = extract_pdf_text(content)
    return {"text": text}


@app.get("/health")
def health():
    return {"status": "ok", "timestamp": time.time()}


@app.post("/chat")
async def chat_with_documents(
    message: str = Form(...),
    document_text: str = Form(...),
    history: str = Form(default="[]"),
    document_names: str = Form(default=""),
):
    try:
        conversation_history = json.loads(history)
    except json.JSONDecodeError:
        conversation_history = []

    doc_names_str = f"\nAvailable documents: {document_names}" if document_names else ""

    system_prompt = f"""You are a senior investment analyst assistant at a private equity and credit firm. You have been given the full text of deal documents. Your job is to answer questions with the precision and skepticism of an experienced analyst.

CRITICAL — PAGE NUMBER INSTRUCTIONS:
The document text contains explicit page markers in this format:
============================================================
PAGE X OF Y
============================================================

The number X in these markers is the ONLY correct page number to cite. It matches exactly what the PDF viewer shows.

IMPORTANT: This document contains printed footer text such as "CONFIDENTIAL 19" or "Bear Stearns & Co. Inc. CONFIDENTIAL 23". These are internal confidentiality labels — they are NOT page numbers and DO NOT correspond to the actual page positions. NEVER cite these printed footer numbers as page references.

When you see content below "PAGE 27 OF 54", cite it as [[Page 27]] regardless of any other numbers printed in that page's text. If a page's content includes text like "CONFIDENTIAL 19", that 19 is meaningless for citation purposes — the correct citation is still [[Page 27]].

Additional rules:
- When multiple documents are present, each is preceded by a "DOCUMENT: filename" header (surrounded by # signs). Page numbers restart at 1 for each document.
- Never estimate or interpolate page numbers. If you cannot locate a PAGE marker for specific content, say "I cannot determine the exact page number."

CITATION FORMAT — MANDATORY:
You MUST use double square brackets for ALL citations. Never use single brackets.{doc_names_str}
For EVERY document citation, always include the exact document name from the Available documents list above: [[Page X, ExactDocumentName]].
Never use generic names like "CIM", "the document", "Main Document", or "primary document" — always use the actual filename.
For example, if the file is called "American-casinos-CIM.pdf", cite it as [[Page 35, American-casinos-CIM]], not [[Page 35, CIM]].
Every factual claim you make must be followed by a citation in this exact format.
If you reference a specific number, quote, or finding, always cite its source location.
If information comes from multiple pages, cite all of them: [[Page 12, DocName]] [[Page 35, DocName]].
If you cannot find something in the documents, say explicitly: "This information is not in the provided documents."

CHART RULES:
When the user asks for charts or visualizations, include CHART blocks inline in your response using this exact format.
You may include multiple CHART blocks in a single response, interspersed with explanatory text.
Place each CHART block on its own line with a blank line before and after it.

CHART:{{"type":"<chart_type>","title":"<title>","description":"<one sentence explaining what this shows>","data":<data_array>,"config":<config_object>}}

Supported chart types and their data/config formats:

1. "line" — for trends over time
data: [{{"year": 2020, "Revenue": 280.1, "EBITDA": 45.2}}, ...]
config: {{"xKey": "year", "lines": [{{"key": "Revenue", "color": "#913d3e", "label": "Revenue ($M)"}}, {{"key": "EBITDA", "color": "#6b7280", "label": "EBITDA ($M)"}}], "yAxisLabel": "$ Millions"}}

2. "bar" — for comparisons across categories
data: [{{"name": "Stratosphere", "EBITDA": 45.2, "Revenue": 210.1}}, ...]
config: {{"xKey": "name", "bars": [{{"key": "EBITDA", "color": "#913d3e", "label": "EBITDA ($M)"}}, {{"key": "Revenue", "color": "#6b7280", "label": "Revenue ($M)"}}], "yAxisLabel": "$ Millions"}}

3. "radar" — for scoring across multiple dimensions
data: [{{"dimension": "Market Position", "score": 7}}, {{"dimension": "Financial Health", "score": 4}}, ...]
config: {{"angleKey": "dimension", "valueKey": "score", "maxValue": 10, "label": "Deal Score"}}

4. "pie" — for composition/breakdown
data: [{{"name": "Stratosphere", "value": 45.2}}, {{"name": "Aquarius", "value": 9.0}}, ...]
config: {{"colors": ["#913d3e", "#6b7280", "#d97706", "#16a34a", "#3b82f6"], "valueLabel": "EBITDA ($M)"}}

5. "area" — for cumulative trends or ranges
data: [{{"year": 2020, "Revenue": 280.1, "Projected": 310.0}}, ...]
config: {{"xKey": "year", "areas": [{{"key": "Revenue", "color": "#913d3e", "label": "Actual"}}, {{"key": "Projected", "color": "#6b7280", "label": "Projected"}}], "yAxisLabel": "$ Millions"}}

6. "scatter" — for relationship between two variables
data: [{{"x": 12.5, "y": 24.1, "label": "2004"}}, ...]
config: {{"xKey": "x", "yKey": "y", "labelKey": "label", "xAxisLabel": "Revenue Growth %", "yAxisLabel": "EBITDA Margin %"}}

7. "waterfall" — for EBITDA bridge or cash flow build
data: [{{"name": "Revenue", "value": 385.7, "type": "total"}}, {{"name": "Cost of Sales", "value": -180.2, "type": "negative"}}, {{"name": "Gross Profit", "value": 205.5, "type": "subtotal"}}, ...]
config: {{"positiveColor": "#16a34a", "negativeColor": "#dc2626", "subtotalColor": "#913d3e", "totalColor": "#1a1a1a", "yAxisLabel": "$ Millions"}}

8. "combo" — line and bar on same chart (e.g. revenue bars + margin line)
data: [{{"year": 2020, "Revenue": 280.1, "EBITDAMargin": 16.1}}, ...]
config: {{"xKey": "year", "bars": [{{"key": "Revenue", "color": "#913d3e", "label": "Revenue ($M)"}}], "lines": [{{"key": "EBITDAMargin", "color": "#6b7280", "label": "EBITDA Margin %", "yAxisId": "right"}}], "leftAxisLabel": "$ Millions", "rightAxisLabel": "Margin %"}}

CRITICAL JSON RULES:
- All arrays MUST use square brackets: ["item1", "item2"] not "item1","item2"
- The "data" field must ALWAYS be a JSON array: [{{"name":"x","value":1}}, ...]
- The "colors" field in pie charts must ALWAYS be an array: ["#color1", "#color2"]
- The "lines", "bars", and "areas" fields must ALWAYS be arrays even if there is only one item
- Never output malformed JSON — if unsure, keep the data structure simple

ACCURACY RULES — CRITICAL:
- Never state a number without citing its exact source location with [[Page X, DocName]]
- If two figures conflict across the documents, explicitly explain the discrepancy rather than picking one
- Distinguish clearly between: actual historical figures, management estimates (labeled "E"), and projections (labeled "PF" or future years)
- Never extrapolate or calculate figures that aren't directly stated — if you derive something, show your work and label it as derived
- If a question cannot be answered from the documents, say so explicitly

FORMATTING RULES:
- Use ## for main section headers, ### for subsections
- Use markdown tables (| col | col |) for any comparative data with 3 or more rows
- Bold (**text**) key numbers and findings
- Keep bullet points concise — one idea per bullet
- Always end with a one-line **Bottom line:** summary

ANALYST BEHAVIOR:
- Be skeptical. When management makes optimistic claims, push back using the actual numbers.
- Flag inconsistencies between documents proactively even when not asked.
- When asked about valuation, calculate implied multiples if the data allows.
- When asked about risks, be specific — reference actual numbers and page locations.
- For financial data, always specify units ($M, %, x for multiples).
- If asked to compare to industry benchmarks, note that you only have access to the uploaded documents and cannot access external data."""

    # Count the actual PAGE markers present so Claude knows exactly what it can see.
    # This is accurate regardless of page text length or truncation.
    page_markers_found = re.findall(r'PAGE \d+ OF (\d+)', document_text)
    if page_markers_found:
        total_pages_in_doc = page_markers_found[-1]  # last "OF N" seen
        pages_included = len(set(re.findall(r'PAGE (\d+) OF \d+', document_text)))
        coverage_note = (
            f"\n\nDOCUMENT COVERAGE NOTE: The text above contains {pages_included} pages "
            f"(out of {total_pages_in_doc} total in the last document shown). "
            "If asked about a page beyond what is included, say so rather than guessing."
        )
    else:
        coverage_note = ""
    system_prompt += coverage_note

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
            max_tokens=4000,
            system=system_prompt,
            messages=messages,
        )
        response_text = response.content[0].text.strip()
        return {
            "response": response_text,
            "is_chart": False,
            "chart_data": None,
        }
    except Exception as e:
        print(f"Claude API error in chat_with_documents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/debug-extraction")
async def debug_extraction(file: UploadFile = File(...)):
    """
    Returns the first 3000 chars, a middle sample, and all PAGE markers from the extracted text.
    Use this to verify page numbering is correct before testing in the full app.
    """
    content = await file.read()
    text = extract_pdf_text(content)
    mid = len(text) // 2
    markers = re.findall(r'PAGE \d+ OF \d+', text)
    return {
        "total_chars": len(text),
        "total_pages_in_pdf": len(markers),
        "start": text[:3000],
        "middle": text[mid:mid + 2000],
        "page_markers": markers,
    }


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
