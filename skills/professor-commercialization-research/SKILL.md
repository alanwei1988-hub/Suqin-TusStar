---
name: professor-commercialization-research
description: Build a sourced research and commercialization dossier from a professor, researcher, PI, lab, or academic team name. Use when Codex needs to disambiguate an academic identity, collect publications, summarize papers, map research directions and timeline, deep-dive selected papers, benchmark companies, generate targeted scholar interview question lists, or advise on technology transfer/startup opportunities. Also use when the user says "技术商业化分析skill", "技术商业化分析", or asks for a technology commercialization analysis skill. If invoked without a target institution and scholar, first ask which institution/lab and scholar the user wants to study.
---

# Technology Commercialization Analysis

## Overview

Turn a professor or lab name into a traceable dossier covering publications, research trajectory, key results, and commercialization potential. Favor evidence-backed analysis over broad biography.

If the user gives no scope, assume the last 10 years, include peer-reviewed papers plus relevant preprints/chapters, and produce outputs in the user's language. By default, produce a three-file final delivery package: an Excel workbook for structured research, a standalone readable HTML report, and a polished Word report. Only narrow this to a single format when the user explicitly asks for HTML-only, workbook-only, Word-only, or another custom delivery mode. Do not use Markdown as the final user-facing deliverable unless the user explicitly asks for it.

Run autonomously for an entry-level technical manager. The only planned user checkpoint is step 5, where the user may optionally choose specific research results for deeper commercial-hypothesis testing.

## Invocation

If the user invokes only "技术商业化分析skill", "技术商业化分析", or the skill name without naming a target, ask one short question before starting:

> 你想研究哪个机构的哪位学者？如果已有关注时间范围、重点产业方向或交付格式，也可以一起告诉我。

If the user already provides the institution and scholar, start the workflow without additional intake questions unless the identity is ambiguous.

## Workflow

1. **Scope and identity**
   - If the target institution/lab and scholar are missing, ask for them first using the invocation question above.
   - Disambiguate the person with affiliation, department, lab page, name variants, coauthors, ORCID/DBLP/Google Scholar/Semantic Scholar/OpenAlex, and official university pages.
   - Record assumptions, source URLs, and any ambiguity before building the corpus.
   - If the identity is genuinely ambiguous, ask a concise clarification question.

2. **Corpus acquisition**
   - Build a publication table with title, year, venue, authors, DOI/arXiv/URL, source, type, and inclusion status.
   - Deduplicate by DOI, normalized title, and author/year; keep rejected near-duplicates in notes if they could affect trust.
   - Download only open, lawful PDFs or author copies. Keep the PDF source URL and a download status.
   - Save machine-readable metadata early so later analysis can be regenerated.

3. **Paper-level analysis**
   - For each included paper, write one compact paragraph explaining the research question, method, result, and limitation.
   - Add a plain-language explanation that answers: what is it, why does it matter, and where might it be used?
   - Separate what the paper proves from what is an inferred application.

4. **Research direction synthesis**
   - Cluster papers by technical theme, target problem, method, and application domain.
   - Create a timeline showing shifts in methods, domains, collaborators, and venues.
   - Identify key nodes: first appearance of a direction, strongest result, most commercially relevant paper, and recent pivot.

5. **Optional user checkpoint: selected-paper deep dives**
   - After producing or previewing the numbered research-result list, ask once whether the user wants any specific results deep-dived.
   - Ask for paper/result numbers matching the Excel `Paper Browser` or equivalent list; ask for a commercial hypothesis only as optional context.
   - Use a lightweight prompt such as: "请选择需要深入分析的成果序号；也可以补充你的商业假设。没有也没关系，我会直接进入商业化综合分析。"
   - Do not block the project if the user does not provide selections. Continue to step 6 with no user-selected deep dives, or with agent-selected high-signal examples only when useful.
   - When the user proposes a commercialization hypothesis, test it against the paper's actual claims.
   - Use full text where available: search for keywords, read abstract/introduction/method/evaluation/conclusion, and extract concise evidence.
   - Classify the hypothesis as accurate, partially accurate, or inaccurate; then rewrite it into the most defensible product framing.

6. **Commercialization analysis**
   - Map research capabilities to industry pain points, buyer personas, deployment constraints, and regulatory/tailwind context.
   - Distinguish product, component, data asset, evaluation service, consulting, and custom project opportunities.
   - Explicitly assess build-vs-buy risk: what large customers will self-build, what they still buy, and where a neutral third party matters.
   - Benchmark domestic and international companies; say "temporarily sparse/blank" when a true product category is not yet visible.

7. **Interview question list**
   - Generate a targeted question list for a technical manager interviewing the scholar.
   - Adapt the general flow of project overview, technology maturity, IP/ownership, market/commercialization, team, funding, risks, needs, and closeout.
   - Ground questions in the analyzed research directions, representative papers, plain-language applications, commercialization hypotheses, benchmarks, and missing evidence.
   - Do not reuse the reference document's title/background unless the user explicitly asks. Produce an interview-ready artifact, not a generic questionnaire.

8. **Deliverables**
   - By default, deliver three user-facing files: an Excel workbook (`.xlsx`), a standalone readable HTML report (`.html`), and a polished Word report (`.docx`).
   - For the Excel workbook, use the spreadsheet skill and include sheets such as `Overview`, `Paper Browser`, `Directions`, `Timeline`, `Deep Dives`, `Commercialization`, `Benchmarks`, and `Interview Questions`.
   - For the HTML report, create a standalone readable report with filters, tables, or section anchors when useful.
   - For the Word report, use the final Word report packaging step after the workbook and HTML report are available as structured source material.
   - Keep source PDFs, metadata, scripts, supporting notes, and final deliverables in a dedicated project folder.

9. **Validation**
   - Verify paper counts, downloaded PDF counts, source links, and date range.
   - Check that every included paper has both technical and plain-language summaries.
   - Check that the interview question list is specific to the scholar's research rather than generic.
   - For HTML deliverables, check table layout: compact identifier columns, give analysis/plain-language columns enough width, and ensure sticky headers or anchors do not cover content.
   - Browse for current market, company, policy, or regulatory facts; cite sources.
   - Flag confidence levels and avoid overstating commercial readiness.

10. **Final Word report packaging**
   - Treat a polished Word report as the final step and third user-facing file in the default technology-commercialization delivery package, after the Excel workbook and standalone HTML report, unless the user explicitly asks for a narrower delivery mode.
   - If an HTML report or workbook already exists, use it as structured source material for the Word report; do not manually copy/paste or rely on ad hoc string parsing.
   - Read `references/word-report-finalization.md` before generating the final Word report.
   - Use the documents skill for DOCX generation and its render/inspect workflow when a usable renderer is available.
   - Preserve every major section from the analytical report, including execution summary, research directions, timeline, deep dives, commercialization path judgment, benchmarks, company-formation/business design, interview questions, and sources/limits.
   - Before delivery, run structural checks that compare report headings, section counts, critical paragraphs, table dimensions, font declarations, and heading numbering state against the source.

## References
- Read `references/workflow-checklist.md` when starting a new professor/lab dossier.
- Read `references/deliverable-schema.md` before creating an Excel, Word, or HTML deliverable.
- Read `references/commercialization-framework.md` before writing startup, productization, benchmark, or build-vs-buy analysis.
- Read `references/interview-question-guide.md` before generating a scholar interview question list.
- Read `references/word-report-finalization.md` before creating the final Word report, converting an HTML report to Word, or debugging DOCX layout/rendering.
