# Workflow Checklist

Use this checklist for a full professor/lab research and commercialization project.

## 1. Intake

- If the user only invokes "技术商业化分析skill", "技术商业化分析", or the skill name, ask: "你想研究哪个机构的哪位学者？如果已有关注时间范围、重点产业方向或交付格式，也可以一起告诉我。"
- Capture the user-provided name, institution, time window, target language, output format, and intended business question.
- If unspecified, assume a 10-year window and a three-file final delivery package: Excel workbook, standalone HTML report, and polished Word report.
- Keep the workflow usable for an entry-level technical manager: gather missing context from sources instead of repeatedly asking the user.
- Create a project folder with subfolders for `metadata`, `papers`, `notes`, `scripts`, and `deliverables`.

## 2. Identity disambiguation

- Confirm affiliation through official university/lab pages.
- Cross-check with at least two scholarly indexes when possible.
- Track name variants in Chinese/English, initials, previous affiliations, and common coauthors.
- Watch for same-name researchers in different fields.

## 3. Corpus construction

- Sources to consider: official CV/lab page, Google Scholar, DBLP, Semantic Scholar, OpenAlex, Crossref, arXiv, ACM, IEEE, Springer, USENIX, NDSS, and conference pages.
- Normalize titles by lowercasing, removing punctuation, and collapsing whitespace.
- Deduplicate by DOI first, then normalized title plus year/coauthors.
- Keep an inclusion/exclusion note for borderline items.

## 4. PDF and text handling

- Download open PDFs, arXiv versions, author manuscripts, or publisher pages that are publicly accessible.
- Do not bypass paywalls or copy full copyrighted text into deliverables.
- For important PDFs, extract title, abstract, intro, methodology, evaluation, conclusion, and future-work passages.
- Preserve local PDF filenames with a stable paper number and title slug.

## 5. Paper analysis

For each paper, capture:

- Research problem
- Core method or system
- Main result or evidence
- Limitation or assumption
- Technical significance
- Plain-language meaning
- Possible application scenarios
- Commercial relevance score or note
- Confidence level based on source quality

## 6. Direction and timeline synthesis

- Cluster papers by recurring technical problems, not only keywords.
- Label each cluster with a buyer-readable direction, such as "privacy-preserving data collaboration" instead of only "MPC".
- Identify phases: early foundation, expansion, consolidation, recent pivot.
- Mark key nodes: first paper in a direction, strongest paper, most applied paper, and most recent paper.

## 7. Optional user checkpoint and deep dives

This is the only planned user checkpoint. After the numbered `Paper Browser` or equivalent research-result list exists, ask the user once:

> 请选择需要深入分析的成果序号；也可以补充你的商业假设。没有也没关系，我会直接进入商业化综合分析。

Rules:

- Accept paper/result numbers, ranges, or short descriptions that map to the numbered list.
- Treat the commercial hypothesis as optional.
- If the user does not answer, declines, or only wants the overall analysis, continue directly to commercialization synthesis.
- Do not ask additional clarifying questions unless the selected number cannot be mapped to a result.

When analyzing a user-selected paper or hypothesis:

- Start with the user's hypothesis in one sentence.
- Search the paper for the exact commercial keywords and adjacent technical terms.
- Compare the claim against the paper's stated problem, threat model, assumptions, and evaluation.
- State whether the hypothesis is accurate, partially accurate, or inaccurate.
- Rewrite the hypothesis into a product claim that the evidence can support.
- List missing work needed before commercialization.

## 8. Commercialization synthesis

- Move from technology to customer pain: who has the problem, how often, and what budget owns it?
- Separate "can be delivered as a project" from "can become a repeatable product".
- Evaluate whether the key asset is algorithm, software component, workflow, data, certification, or expert service.
- Compare against domestic and international companies.
- Discuss build-vs-buy dynamics for large customers.
- Recommend one or two wedge products instead of many unfocused opportunities.

## 9. Targeted scholar interview question list

- Generate this after paper analysis, direction synthesis, and commercialization synthesis.
- Use the reference flow: warm-up and project overview; technology and maturity; IP and ownership; market and commercialization; team and role; capital and policy; challenges, risks, and needs; closeout.
- Tailor every major section to the scholar's actual research directions, representative papers, application scenarios, and commercial hypotheses.
- Include the reason for asking each question and the signal a technical manager should listen for.
- Mark questions as `Must ask`, `If time`, or `Optional`.
- Keep the list interview-ready for a 45-60 minute conversation; do not turn it into a long due-diligence memo.
- Finish with the final Word report packaging step so the default user-facing package contains Excel, HTML, and Word files.

## 10. Final Word report packaging

- Read `word-report-finalization.md` before generating the final `.docx`.
- Confirm the final deliverables folder contains the expected three user-facing files: `.xlsx`, `.html`, and `.docx`, unless the user explicitly scoped the request differently.
- Use structured source data or parsed HTML; do not manually copy/paste report sections.
- Preserve every major analytical section, including `商业化路径判断`, benchmarks, company-formation/business design, interview questions, and sources/limits.
- Use explicit Chinese-capable fonts and custom heading styles for Chinese reports.
- Validate headings, critical section content, table dimensions, and DOCX XML for accidental numbering or pagination artifacts.
- Render and inspect with the documents skill when LibreOffice/`soffice` is available; otherwise disclose the render limitation.

## 11. Final QA

- Confirm all counts match between metadata, workbook/report, and downloaded files.
- Confirm the final user-facing package includes Excel, HTML, and Word versions unless explicitly scoped otherwise.
- Check hyperlinks and local file paths.
- Confirm the interview question list is specific, uses plain language, and maps back to the analysis.
- For HTML reports, inspect table ergonomics: title/source columns should not crowd out analysis and plain-language columns; sticky headers must not cover the first row or anchor targets.
- Re-run generation scripts when source data changes.
- Include a short "known limits" section: missing PDFs, uncertain authorship, market facts needing refresh, or thin evidence.
