# docs/tools — the scripts that build the deliverables

Six Python scripts. They exist so that the SRS and the SAD are **built, not
hand-assembled**, and so that anyone can see exactly what changed between two
versions of a `.docx` — which is otherwise impossible, because Word files are
binary and `git diff` cannot read them.

You need these for two things: keeping the Markdown copies in step with the Word
documents, and producing the next version of a document.

> `docs/Templates/` next door holds the **blank course templates** (the `.doc` and
> `.docx` files the course gave us). Those are inputs. These are the code.

---

## Setup

```powershell
pip install python-docx
```

That is the only dependency. Run any script from anywhere — they all work out the
repository root from their own location, so there are no absolute paths to fix.

---

## The two you will actually use

### `_docx_to_md.py` — keep the Markdown copies in step

```powershell
python docs/tools/_docx_to_md.py
```

Reads the current `.docx` of each deliverable and rewrites its Markdown mirror in
`docs/Deliverables/`.

**Run this every time you edit a `.docx`.** The Markdown files carry a banner saying
"this file is generated, do not edit by hand" and pointing at this script — if you
edit the Word file and forget to run it, that banner becomes a lie and the two drift
apart again. That drift already cost the team a day once, when nobody could say which
copy was normative.

Safe to run as often as you like: it only reads the `.docx` and only writes the `.md`.

**Why keep a Markdown copy at all?** A `.docx` is a binary blob. In a pull request it
shows as "file changed" and nothing else. The mirror means a reviewer can see the
actual sentences that moved.

### `_docx_patch.py` — the shared library

Not run directly. It is imported by the patch scripts below and holds the fiddly
parts: finding a table by its contents, replacing a sentence that Word has split
across several runs, cloning a table row so it keeps its borders, inserting a
paragraph in the right place.

The one piece worth knowing about is **`must_replace()`**. Every edit goes through
it, and it raises an error if the sentence it was looking for is not found. That
matters because Word silently re-types hyphens as en-dashes and quotes as curly
quotes, so a match string that looks right can quietly fail. Failing loudly means you
find out immediately, instead of shipping a document that skipped half its edits.

---

## Producing the next version

### `_patch_srs_v1_1.py` and `_patch_sad_v1_1.py`

These made **v1.1 from v1.0**. They have already run, and they now refuse to run again:

```
Software_Requirement_Specification_v1.1.docx already exists.
This script rebuilds v1.1 from v1.0 and would overwrite any Word edits
(refreshed fields, replaced figures) already made to it.
```

That guard matters. Each one starts by copying v1.0 over v1.1, so re-running it after
you have replaced the figures in Word would destroy that work without a word.

So treat them as **the record of what changed between v1.0 and v1.1**, in executable
form. Every edit is one call with the old text, the new text, and a comment saying
why. If someone asks "what exactly is different in v1.1?", the revision-history row
in the document is the summary and this file is the proof.

### Why patch, instead of rebuilding from the template?

Because rebuilding throws away everything added since. The v1.0 documents contain 23
embedded figures, hand-rewritten tables and manually-numbered captions. Regenerating
from the blank course template would lose all of it.

Patching copies the previous version and edits it, so **every style, header, footer,
margin, numbering definition, embedded image and field code is inherited
byte-for-byte** — because it is literally the same file.

### Making v1.2

The rule: **never edit an older version, and never re-run an old patch script.** Once
a version folder ships, it is frozen.

```
docs/Deliverables/SRS/
├── v1.0/  ← frozen
├── v1.1/  ← frozen
└── v1.2/  ← produced by a NEW script that reads v1.1
```

Four steps:

1. Copy `_patch_srs_v1_1.py` to `_patch_srs_v1_2.py`
2. Point `SRC` at v1.1 and `OUT` at v1.2
3. Delete the v1.1 edit list, write the v1.2 one, and add a revision-history row
4. Run it, then run `_docx_to_md.py`

`_docx_patch.py` is not touched — that is exactly why it is a separate file.

A minimal edit looks like this:

```python
note("FR-1", must_replace(
    doc,
    "the old sentence, exactly as it appears in the document",
    "the new sentence",
    whole=True))          # whole=True means: match the entire paragraph
```

Then at the end the script prints every edit it made, so you can check the count
before opening Word.

---

## Historical

### `_build_srs_docx.py` and `_build_sad_docx.py`

These built the **original skeleton** of each document from the blank course template
— headings, empty tables, figure captions, and the title page. That is how v0.1
started, before there was any content to patch.

They are superseded and marked `⚠️ HISTORICAL` at the top. They now write to
`docs/Deliverables/_generated/` and refuse to overwrite, so a careless run cannot
touch a real deliverable.

Kept for two reasons: they record how the document structure was first laid out, and
they are the only code that knows how to inherit a course template's styles, headers,
footers and numbering from scratch. If a **new** deliverable is ever needed — a Test
Plan, say, from `docs/Templates/6 = Template for Test plan.docx` — copy one of these
rather than starting over.

---

## After editing a `.docx` in Word

Two things, in order:

1. **Ctrl + A, then F9, twice.** The table of contents, the list of tables and every
   caption number are Word *fields*; they do not recalculate until asked. The first
   pass fixes the numbers, the second fixes the page references that moved because the
   numbers changed.
2. **`python docs/tools/_docx_to_md.py`** so the Markdown copy follows.

Neither script can do step 1 — refreshing a field requires Word itself.

---

## File map

| File | Run it? | What it is |
|---|---|---|
| `_docx_to_md.py` | **Yes, often** | Regenerates the Markdown mirrors from the `.docx` |
| `_docx_patch.py` | No — imported | Shared helpers for editing a `.docx` safely |
| `_patch_srs_v1_1.py` | Already ran; guarded | SRS v1.0 → v1.1, and the record of those 25 edits |
| `_patch_sad_v1_1.py` | Already ran; guarded | SAD v1.0 → v1.1, and the record of those 44 edits |
| `_build_srs_docx.py` | Historical | Built the original SRS skeleton from the course template |
| `_build_sad_docx.py` | Historical | Built the original SAD skeleton from the course template |
