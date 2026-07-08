# Final Word Report Generation

Use this reference when the technology-commercialization analysis needs its final `.docx` report, especially as the third file in the default Excel + HTML + Word delivery package or when converting a generated HTML report into Word.

## Required sequence

1. Confirm the Excel workbook and standalone HTML report have been produced, unless the user explicitly scoped the delivery differently.
2. Start from structured source material: workbook sheets, metadata JSON, or parsed HTML. Do not rebuild the report by copy/paste.
3. If HTML is the source, parse it with a real HTML parser such as `lxml` or BeautifulSoup. Preserve the order of `main > section` and compare the resulting Word headings against the HTML `h2` list.
4. Use the documents skill for DOCX generation. Read its `SKILL.md`, creation/editing guide, design preset guidance, and render/verify guide before producing the final Word artifact.
5. Pick a conservative report style such as `standard_business_brief` or a similarly restrained Chinese business-report style. Use explicit styles rather than Word defaults.
6. Generate the DOCX into a writable workspace first. Copy it to the project/output folder only after structural checks pass.
7. Run render/inspect QA with `render_docx.py` whenever `soffice`/LibreOffice is available. If rendering cannot be made available, perform structural QA and disclose that visual PNG review was not completed.

## HTML-to-Word content mapping pitfalls

- HTML cards are not always `div.card`; they may be `article.card`, `section.card`, or nested containers. Treat any element whose class contains `card`, `callout`, or a known report component class as a candidate content block.
- Do not assume grid children are only `div` elements. For opportunity sections, `article.card opportunity` is common and must be included.
- For cards with a `.row` heading and `.pill` status, create a Word subheading such as `Title - Status`, then write every paragraph below it.
- Skip interactive controls such as filters, search inputs, and sticky nav bars. Convert them only to static table headings or a simple contents list when useful.
- Preserve section-level notes, callouts, timeline items, opportunity cards, benchmark tables, interview-question tables, paper-browser tables, and sources/limits.
- Translate generic English headings into the target report language when the surrounding report is localized. For Chinese reports, use `执行摘要` instead of `Executive Summary`.

## Word layout pitfalls

- Do not rely on built-in Word `Heading 1/2/3` styles when previous templates or imports may contaminate numbering, bullets, or `keepNext`. Prefer custom styles for generated reports.
- Explicitly set East Asian fonts in OOXML (`w:eastAsia`) as well as `ascii`/`hAnsi`. For Chinese reports, prefer installed fonts such as `Noto Sans SC`, `Microsoft YaHei`, or `DengXian`; verify the font exists on the machine when possible.
- Clear heading `w:numPr`, `w:keepNext`, `w:pageBreakBefore`, and unwanted inherited paragraph settings. A heading with accidental numbering can render as black square/bullet-like marks.
- Use fixed table geometry: explicit `tblW`, `tblGrid`, `tcW`, table indent, and cell margins. Avoid autofit for benchmark, interview, and paper-browser tables.
- Put very wide tables, especially paper-browser tables, in landscape sections. Keep identifier columns compact and reserve width for analysis and plain-language application columns.
- Repeat table header rows for multi-page tables and keep row heights flexible. Do not use fixed row heights that can clip Chinese text.
- If a section renders as a nearly blank page, inspect the DOCX paragraphs around that heading. The most likely causes are skipped source elements, accidental page/section breaks, or `keepNext` forcing content forward.

## Tooling pitfalls from Windows runs

- Check for an existing `soffice.exe` before installing anything. Common locations include `C:\Program Files\LibreOffice\program\soffice.exe` and bundled runtime folders.
- Chocolatey installs often require an elevated administrator shell and may fail when Codex is not elevated.
- LibreOffice MSI administrative extraction can fail with Windows Installer errors such as `1603`, `2502`, or `2503`, or when `MsiSystemRebootPending=1`.
- PortableApps installers may not honor silent flags in every environment and can wait behind hidden UI. Do not leave hidden installer processes running.
- Word COM automation can hang or fail in desktop sessions. Smoke-test with a tiny DOCX before relying on it, and do not kill user-visible Word windows. Only clean up background processes you created and can identify.
- If rendering dependencies cannot be installed safely, stop trying after the reasonable routes above, perform structural QA, and state the limitation clearly.

## Structural QA checklist

- Compare the Word H1 list to the source report section list. Confirm localized heading replacements such as `执行摘要`.
- Confirm `商业化路径判断` contains all opportunity cards and their paragraphs: research basis, first product form, target customers/budget owners, build-vs-buy judgment, and recommendation.
- Confirm the `如果成立公司，可以做什么业务` section remains separate from `商业化路径判断`.
- Confirm table dimensions for benchmark, interview-question, and paper-browser tables against the source.
- Search the DOCX XML for obsolete headings or leaked English labels when a localized title is required.
- Check `word/document.xml` for unexpected `w:numPr`, `w:keepNext`, and `w:pageBreakBefore` in generated body headings.
- If the destination file is open and locked, write a sibling `_fixed.docx` or timestamped copy and tell the user why it was not overwritten.
