# -*- coding: utf-8 -*-
"""Render a deliverable .docx into the Markdown copy kept in docs/Deliverables/.

    python docs/tools/_docx_to_md.py

The Markdown is **generated, not maintained**. That is the whole point. Before
this script existed the .md and the .docx were edited separately, drifted, and
the team lost a day working out which one was normative. Now the .docx is the
deliverable and the .md is a read-only mirror of it, regenerated whenever the
.docx changes, so "which is right?" has one answer.

What the mirror is for: reading and diffing in the repository and in pull
requests, where a .docx is an opaque blob. It is not the submission.

Figures are not exported. They are embedded images in the .docx and are
maintained as draw.io sources under docs/Diagrams/UMLs/; the mirror records each
caption and points there.
"""
from __future__ import annotations

import os
import re

import docx
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

JOBS = [
    {
        "src": "docs/Deliverables/SRS/v1.1/Software_Requirement_Specification_v1.1.docx",
        "dst": "docs/Deliverables/Software_Requirements_Specification.md",
        "title": "Code Sage AI — Software Requirements Specification",
        "subtitle": "For the AI-Powered Technical-Debt Analytics Dashboard · Version 1.1",
        "source_label": "SRS/v1.1/Software_Requirement_Specification_v1.1.docx",
    },
    {
        "src": "docs/Deliverables/SAD/v1.1/Software_Architecture_Document_v1.1.docx",
        "dst": "docs/Deliverables/Software_Architecture_Document.md",
        "title": "Code Sage AI — Software Architecture Document",
        "subtitle": "For the AI-Powered Technical-Debt Analytics Dashboard · Version 1.1",
        "source_label": "SAD/v1.1/Software_Architecture_Document_v1.1.docx",
    },
]

HEADING = re.compile(r"^Heading (\d)$")
CAPTION = re.compile(r"^(Table|Figure)\s", re.I)
# Word writes a TOC and its List of Tables as field codes; the cached text is
# stale the moment a heading moves, so it is skipped and the mirror relies on
# GitHub's own heading anchors instead.
FIELD_JUNK = re.compile(r"(PAGEREF|TOC \\|SEQ Table|STYLEREF|MERGEFORMAT|HYPERLINK)")


def clean(text: str) -> str:
    text = (text.replace(" ", " ").replace("’", "'").replace("‘", "'")
                .replace("“", '"').replace("”", '"')
                .replace("–", "-").replace("—", "-"))
    return re.sub(r"[ \t]+", " ", text).strip()


def cell_text(cell) -> str:
    parts = [clean(p.text) for p in cell.paragraphs]
    return "<br>".join(p for p in parts if p).replace("|", "\\|")


def render_table(table: Table) -> list[str]:
    rows = []
    for row in table.rows:
        seen, cells = set(), []
        for cell in row.cells:
            # Merged cells repeat the same underlying element across the row;
            # emitting each one would widen the Markdown table incorrectly.
            if cell._tc in seen:
                continue
            seen.add(cell._tc)
            cells.append(cell_text(cell))
        rows.append(cells)
    if not rows:
        return []

    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    out = ["| " + " | ".join(rows[0]) + " |",
           "|" + "|".join(["---"] * width) + "|"]
    out += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    out.append("")
    return out


def is_list_item(paragraph) -> bool:
    """True when Word is auto-numbering or bulleting this paragraph.

    Style alone is not enough: the deliverables number most of their lists
    through numbering.xml on otherwise Normal paragraphs, so a style check would
    flatten those lists into loose prose.
    """
    props = paragraph._p.find(qn("w:pPr"))
    return props is not None and props.find(qn("w:numPr")) is not None


def body_blocks(document):
    """Yield paragraphs and tables in the order Word stores them."""
    for child in document.element.body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, document)
        elif child.tag == qn("w:tbl"):
            yield Table(child, document)


def preamble(job) -> list[str]:
    return [
        f"# {job['title']}",
        "",
        f"*{job['subtitle']}*",
        "",
        "> **This file is generated. Do not edit it by hand.**",
        "> The deliverable is "
        f"[`{job['source_label']}`](./{job['source_label']}); this Markdown is a "
        "mirror of it so the document can be read and diffed in the repository. "
        "Regenerate with `python docs/tools/_docx_to_md.py` after editing the "
        "`.docx`.",
        "",
        "> **Figures are not reproduced here.** Each caption below marks where a "
        "figure sits in the deliverable; the editable sources are in "
        "[docs/Diagrams/UMLs/](../Diagrams/UMLs/).",
        "",
        "---",
        "",
    ]


def collapse(lines: list[str]) -> str:
    out, previous_blank = [], False
    for line in lines:
        is_blank = not line.strip()
        if is_blank and previous_blank:
            continue
        out.append(line)
        previous_blank = is_blank
    return "\n".join(out).rstrip() + "\n"


class Renderer:
    """Walks the document once, holding the heading counters and spacing state."""

    def __init__(self, job):
        self.lines = preamble(job)
        self.counters = [0, 0, 0]
        self.started = False   # suppress the title page and the cached TOC
        self.blank = False

    def heading(self, level: int, text: str) -> None:
        self.counters[level - 1] += 1
        for deeper in range(level, 3):
            self.counters[deeper] = 0
        number = ".".join(str(self.counters[i]) for i in range(level))
        self.lines += ["", f"{'#' * (level + 1)} {number} {text}", ""]
        self.started = True
        self.blank = True

    def paragraph(self, block, text: str, style: str) -> None:
        if CAPTION.match(text):
            self.lines += [f"*{text}*", ""]
            self.blank = True
        elif style == "List Paragraph" or is_list_item(block):
            self.lines.append(f"- {text}")
            self.blank = False
        else:
            if not self.blank:
                self.lines.append("")
            self.lines += [text, ""]
            self.blank = True

    def feed(self, block) -> None:
        if isinstance(block, Table):
            if self.started:
                self.lines += render_table(block)
                self.blank = False
            return

        text = clean(block.text)
        style = block.style.name if block.style else "Normal"
        match = HEADING.match(style)
        if match and text:
            self.heading(int(match.group(1)), text)
        elif not match and self.started and text and not FIELD_JUNK.search(block._p.xml):
            self.paragraph(block, text, style)


def convert(job) -> str:
    document = docx.Document(os.path.join(ROOT, job["src"]))
    renderer = Renderer(job)
    for block in body_blocks(document):
        renderer.feed(block)
    return collapse(renderer.lines)


for job in JOBS:
    text = convert(job)
    path = os.path.join(ROOT, job["dst"])
    with open(path, "w", encoding="utf8", newline="\n") as handle:
        handle.write(text)
    print(f"{job['dst']}  ({text.count(chr(10))} lines)")
