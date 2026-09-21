"""Render PHASE_1_SCOPE.md to a SEPARATE .docx for preview.

The authoritative document is:
    docs/ASG Mantra - Phase 1 Scope & Estimate.docx

That file is edited directly and carries its own design, hours and figures. This script
must never write to it. It renders to a "(generated)" filename instead, and refuses to
run if that would collide with the authoritative file.

PHASE_1_SCOPE.md is a hand-maintained mirror of the authoritative document, kept so the
content is visible in the repo.

Usage:
    cd backend
    venv\\Scripts\\python.exe scripts\\build_scope_docx.py
"""
import os
import re
import sys

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor, Inches

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "PHASE_1_SCOPE.md")
# Deliberately NOT the authoritative filename — see module docstring.
AUTHORITATIVE = os.path.join(ROOT, "docs", "ASG Mantra - Phase 1 Scope & Estimate.docx")
OUT = os.path.join(ROOT, "docs", "ASG Mantra - Scope & Estimate (generated preview).docx")

ACCENT = RGBColor(0x1E, 0x6B, 0x45)      # deep green for headings
MUTED = RGBColor(0x59, 0x59, 0x59)
TITLE_GREEN = RGBColor(0x14, 0x53, 0x35)


def strip_md(text: str) -> str:
    """Remove inline markdown so Word shows clean prose."""
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", text)
    return text.strip()


def add_table(doc, rows):
    """rows[0] is the header. Widths are left to Word's autofit."""
    if not rows:
        return
    t = doc.add_table(rows=1, cols=len(rows[0]))
    t.style = "Light Grid Accent 6"   # green banding
    for i, h in enumerate(rows[0]):
        cell = t.rows[0].cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(strip_md(h))
        run.bold = True
        run.font.size = Pt(9)
    for row in rows[1:]:
        cells = t.add_row().cells
        for i, val in enumerate(row[: len(rows[0])]):
            cells[i].text = ""
            run = cells[i].paragraphs[0].add_run(strip_md(val))
            run.font.size = Pt(9)
    doc.add_paragraph()


def main():
    if not os.path.exists(SRC):
        sys.exit(f"missing {SRC}")
    if os.path.abspath(OUT) == os.path.abspath(AUTHORITATIVE):
        sys.exit("refusing to overwrite the authoritative document")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)

    lines = open(SRC, encoding="utf-8").read().split("\n")
    doc = Document()

    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(10)
    for s in doc.sections:
        s.left_margin = s.right_margin = Inches(0.8)

    table_buf, in_code, skip_toc = [], False, False

    def flush():
        nonlocal table_buf
        if table_buf:
            add_table(doc, table_buf)
            table_buf = []

    for raw in lines:
        line = raw.rstrip()

        if line.startswith("```"):
            flush()
            in_code = not in_code
            continue
        if in_code:
            p = doc.add_paragraph()
            r = p.add_run(raw)
            r.font.name = "Consolas"
            r.font.size = Pt(8)
            continue

        # Table rows
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c or "-") for c in cells):
                continue  # separator
            table_buf.append(cells)
            continue
        flush()

        if not line.strip():
            continue
        if line.startswith("> "):
            p = doc.add_paragraph()
            r = p.add_run(strip_md(line[2:]))
            r.italic = True
            r.font.color.rgb = MUTED
            p.paragraph_format.left_indent = Inches(0.3)
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            level, text = len(m.group(1)), strip_md(m.group(2))
            if text.lower().startswith("table of contents"):
                skip_toc = True
                continue
            skip_toc = False
            if level == 1:
                h = doc.add_heading(text, 0)
                h.alignment = WD_ALIGN_PARAGRAPH.CENTER
                for r in h.runs:
                    r.font.color.rgb = TITLE_GREEN
            else:
                h = doc.add_heading(text, min(level - 1, 3))
                for r in h.runs:
                    r.font.color.rgb = ACCENT
            continue

        if skip_toc:
            continue
        if re.fullmatch(r"-{3,}", line.strip()):
            continue

        m = re.match(r"^\s*[-*]\s+(.*)$", line)
        if m:
            doc.add_paragraph(strip_md(m.group(1)), style="List Bullet")
            continue
        m = re.match(r"^\s*(\d+)\.\s+(.*)$", line)
        if m:
            doc.add_paragraph(strip_md(m.group(2)), style="List Number")
            continue

        doc.add_paragraph(strip_md(line))

    flush()
    doc.save(OUT)
    print(f"written: {OUT}")
    print(f"paragraphs={len(doc.paragraphs)} tables={len(doc.tables)}")
    print("note: this is a preview render. The authoritative document is")
    print(f"      {AUTHORITATIVE}")


if __name__ == "__main__":
    main()
