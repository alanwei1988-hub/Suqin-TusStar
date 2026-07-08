# Deliverable Schema

Default to a three-file final package: a structured Excel workbook, a standalone readable HTML report, and a polished Word report. Narrow the package only when the user explicitly requests another format or a single-format delivery. Markdown is acceptable only as an internal note or source draft.

## Default final package

Unless explicitly scoped otherwise, deliver exactly these user-facing files:

- Excel workbook (`.xlsx`) for structured research data, paper browsing, analysis tables, and interview questions
- Standalone HTML report (`.html`) for readable navigation, filters, tables, and section anchors
- Polished Word report (`.docx`) as the final narrative report for sharing and review

## Recommended workbook sheets

### Overview

Purpose: give the user a one-screen orientation.

Columns or sections:

- Professor/lab identity
- Time window
- Total included works
- Downloaded PDFs
- Main research directions
- Most commercially relevant directions
- Key caveats

### Paper Browser

Purpose: enable paper-by-paper filtering and review.

Recommended columns:

- Paper #
- Year
- Title
- Venue
- Type
- Authors
- Research Direction
- Technical Keywords
- Analysis Summary
- Plain-Language Explanation and Application Scenarios
- Commercial Relevance
- Evidence Confidence
- DOI/arXiv/URL
- Local PDF Path
- Download Status

The `Plain-Language Explanation and Application Scenarios` column is mandatory. It must explain, for a non-specialist reader, what the result is, why it matters, and where it might be used.

### Directions

Purpose: summarize research clusters.

Recommended columns:

- Direction
- Paper Count
- Representative Papers
- Core Capability
- Main Evidence
- Industrial Pain Point
- Productization Potential
- Key Limits

### Timeline

Purpose: show research evolution.

Recommended columns:

- Year
- Representative Papers
- Direction
- Technical Milestone
- Commercial Meaning
- Notes

### Deep Dives

Purpose: test selected commercialization hypotheses.

Recommended columns:

- Paper #
- User Hypothesis
- Evidence Found
- Accuracy Judgment
- Better Product Framing
- Missing Work
- Suggested Next Validation

### Commercialization

Purpose: translate research into possible company strategy.

Recommended columns:

- Opportunity
- Target Customer
- Pain Point
- Research Basis
- Product Form
- Buy-vs-Build Risk
- Competitive Pressure
- Go-to-Market Wedge
- Readiness
- Recommendation

### Benchmarks

Purpose: compare domestic and international peers.

Recommended columns:

- Direction
- Foreign Benchmarks
- Domestic Benchmarks
- What They Sell
- Differentiation Gap
- White Space or "Temporarily Sparse"
- Source Links

### Interview Questions

Purpose: give a technical manager a targeted question list for interviewing the scholar after the research and commercialization analysis.

Recommended columns:

- Section
- Priority
- Question
- Follow-up Prompt
- Why Ask This
- Analysis Basis
- Expected Signal
- Related Paper # or Direction
- Notes During Interview

The questions must be specific to the scholar's actual research directions and commercialization evidence. Avoid generic questionnaires that could apply to any professor.

## HTML report structure

- Executive summary
- Research directions
- Timeline
- Paper table or browser
- Selected deep dives
- Commercialization options
- Benchmarks
- Targeted scholar interview questions
- Sources and limits

HTML must be readable as a standalone report, with tables, anchors, filters, or section navigation when the corpus is large.

For large paper browser tables, use a reader-first layout: keep identifier fields (`#`, year, title, source, direction, signal) compact and allocate the most horizontal space to `Analysis Summary` and `Plain-Language Explanation and Application Scenarios`. Use explicit column widths or a `colgroup`; avoid letting long titles or venue names dominate the table. Keep sticky headers scoped to the table's own scroll container.

## Word report structure

Before creating the final Word report, read `word-report-finalization.md`.

- Executive summary / localized execution summary such as `执行摘要`
- Research directions, trajectory, and key nodes
- Plain-language explanation of major results
- Selected deep dives, if the user chose any
- Commercialization path judgment, including product/component/service opportunities
- Benchmarks and build-vs-buy analysis
- Company-formation or business-design recommendation, when relevant
- Targeted scholar interview question list
- Sources and limits

## Style rules

- Keep technical summaries compact and sourced.
- Make plain-language summaries useful to a non-specialist investor or operator.
- Label inference clearly.
- Avoid "promising" language unless the evidence supports product readiness.
- Prefer "possible wedge" or "requires validation" for early-stage ideas.
- For HTML, verify at a normal desktop width that no table columns are wastefully wide, no important narrative columns are squeezed, and sticky headers or nav bars do not cover content.

For Word reports, validate that every narrative section contains content after its heading; empty pages or heading-only sections usually indicate skipped HTML containers or inherited pagination settings.
