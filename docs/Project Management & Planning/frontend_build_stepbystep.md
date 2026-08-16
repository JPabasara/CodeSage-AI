# Code Sage AI — Frontend Build Guide (step-by-step, tiniest steps)

A hands-on, do-this-then-that guide to build the whole frontend from an empty machine. Every step says **why**. Every phase ends with **how to test it** and **what to commit**.

- For the *architecture and design decisions* (layout, flow, contracts), read **[frontend_prototype_plan.md](./frontend_prototype_plan.md)**. This file is the *execution recipe* for that plan.
- Commands are written for **Windows PowerShell** (each is a single line — no `\` line-breaks). They also work in Git Bash.

---

## How to use this guide

1. **Do the phases in order.** Each one builds on the last.
2. **Don't skip the "✅ Test / verify" boxes.** They catch a broken setup early, when it's cheap to fix.
3. **Commit after every phase** (the `💾 Commit` line). Small commits = easy to undo one mistake.
4. If a step's *why* doesn't make sense yet, that's OK — do it, and it'll click when you use it.

### The mental model (read this once)

We build in this order **on purpose**:

```
Install tools ─► Scaffold app ─► Configure ─► Theme ─► Types (the "contract")
   ─► Build the SCREENS with fake static data  ─► add the MOCK BACKEND (MSW)
   ─► wire interactions ─► test end-to-end ─► polish ─► (later) swap to real backend
```

**Why the mock backend comes late:** you'll first make the UI *look* right using hardcoded sample objects passed straight into components. That's the fastest way to see progress. Then — once the screens exist — you add **MSW** (a fake API) so the same data arrives over the network, exactly like the real backend will send it later. Because we write the **contract types** early (Phase 5), the components are already the right shape, so "static data → mock API → real API" are three painless swaps, not three rewrites.

### Phase overview

| Phase | What you do | Kind |
|---|---|---|
| 0 | Install Node, pnpm, Git, VS Code + extensions | Install |
| 1 | Scaffold Next.js + shadcn, first run | Install/Config |
| 2 | Add UI components + libraries | Install |
| 3 | Configure Prettier/ESLint + test runners (+ a smoke test) | Config/**Test** |
| 4 | Theme & design tokens (colors, dark mode) | Config |
| 5 | The contract — TypeScript types | Build |
| 6 | App shell & routing (left rail, pages) — static | Build |
| 7 | Build the screens with **static data** + component tests | Build/**Test** |
| 8 | **The mock backend (MSW)** — make data flow | Build |
| 9 | Wire the interactions (scan, branch, tree→graph, detail) | Build |
| 10 | End-to-end tests (Playwright) | **Test** |
| **10.5** | **CR-001 migration — contract, chips, profile sliders, in-place finding detail** | **Build/Test** |
| 11 | Polish — states, a11y, contrast, responsive + Definition of Done | Build/**Test** |
| 12 | (Later) Swap mock → real backend | Build |

---

## Phase 0 — Install the toolchain

**Goal:** get the tools every later step needs.
**Why this phase:** you can't run a single command in Phase 1 without these. Doing it once, cleanly, prevents "works on my machine" between you and your teammate.

### 0.1 Node.js (LTS, v20+)
- *Why:* Next.js is a Node program; Node runs it and all the CLI tools.
- Install (PowerShell): `winget install OpenJS.NodeJS.LTS`
  (or download the **LTS** installer from nodejs.org and click through.)

### 0.2 pnpm (our package manager)
- *Why:* pnpm is fast and keeps **one lockfile** so both teammates install identical versions. Node ships with `corepack`, which can turn on pnpm without a separate install.
- Enable it: `corepack enable` then `corepack prepare pnpm@latest --activate`
  (fallback: `npm install -g pnpm`)

### 0.3 Git
- *Why:* version control; you already have this repo. Just confirm it's there.

### 0.4 VS Code + extensions
- *Why:* these give you inline color swatches, format-on-save, autocompletion for Tailwind, and one-click test running — the "watch it change live" experience.
- Install these extensions (Extensions panel → search → Install):
  - **Tailwind CSS IntelliSense** — autocompletes classes, shows a color chip as you type `bg-…`. *The important one.*
  - **Color Highlight** — shows the real color next to any hex/hsl in your CSS.
  - **Prettier - Code formatter** and **ESLint** — format + catch mistakes on save.
  - **ES7+ React/Redux snippets** — type `rafce` to scaffold a component instantly.
  - **Auto Rename Tag** + **Error Lens** — rename JSX tag pairs; show errors inline.
  - **Playwright Test for VSCode** — run/record end-to-end tests from the editor.

**✅ Test / verify** — run each and expect a version number (not an error):
```powershell
node -v
pnpm -v
git --version
```

**💾 Commit:** nothing yet (no project files changed).

---

## Phase 1 — Scaffold the project + first run

**Goal:** create the real Next.js app inside `apps/web`, add shadcn, and see it in the browser.
**Why this phase:** this is the skeleton everything else hangs on. `create-next-app` wires TypeScript, Tailwind, routing, and the `@/*` import shortcut for you; `shadcn init` sets up the component system and theme variables.

### 1.1 Make room for the scaffolder
- *Why:* `create-next-app` needs an (almost) empty folder. Our planning `.md` files are in `apps/web`, so park them for a moment.
- From the **repo root** (PowerShell):
  ```powershell
  Move-Item apps\web\frontend_prototype_plan.md, apps\web\frontend_build_stepbystep.md, apps\web\README.MD docs\
  ```
- *(After scaffolding you can keep them in `docs/` — the app will generate its own `apps/web/README.md`.)*

### 1.2 Create the Next.js app
- *Why:* the standard, best-documented way to start a Next.js project.
- From the repo root:
  ```powershell
  pnpm create next-app@latest apps/web
  ```
- Answer the prompts like this (and why each):
  - **TypeScript? → Yes** — typed code catches mistakes as you write.
  - **ESLint? → Yes** — flags bad patterns.
  - **Tailwind CSS? → Yes** — our styling system; shadcn needs it.
  - **`src/` directory? → Yes** — keeps source in one tidy folder.
  - **App Router? → Yes** — the current Next.js routing model (folders = routes).
  - **Turbopack? → Yes** — faster dev refresh.
  - **Customize import alias? → No** (keep the default `@/*`) — lets you write `@/components/...` instead of long `../../..` paths.
- Newer versions of the wizard add two extra prompts:
  - **React Compiler? → No** — still experimental; can break older packages. Turn it on later if you want.
  - **Include AGENTS.md? → Yes** (optional) — a hints file for coding agents. Harmless either way.

#### ⚠️ If it ends with `ERR_PNPM_IGNORED_BUILDS` / "Aborting installation. pnpm install has failed."
*Why it happens:* pnpm blocks native packages (`sharp`, `unrs-resolver`) from running their install scripts until you approve them, and `create-next-app` treats that block as a failure. **Nothing is broken** — the files were created, the install just stopped early. Recover with:
```powershell
cd apps\web
pnpm approve-builds     # press `a` to select all → Enter → `y`
pnpm install            # finishes the aborted install — do NOT skip this
```
If `pnpm approve-builds` errors or hangs, do the same thing by hand — add this to `apps/web/package.json` at the top level, then re-run `pnpm install`:
```json
"pnpm": {
  "onlyBuiltDependencies": ["sharp", "unrs-resolver"]
}
```
Either way the result is a `pnpm` block in `package.json` — commit it, so teammates don't hit the same prompt.

#### ⚠️ Other small traps
- **`pnpm create next -app@latest`** (space before `-app`) silently installs the wrong package and shows no prompts. The command is `next-app@latest`, no space.
- **`corepack enable` → `EPERM ... C:\Program Files\nodejs\pnpm`** — run it once in a PowerShell opened as **Administrator**, then go back to your normal terminal. (Fallback: `npm install -g pnpm`.)

### 1.3 Initialize shadcn
- *Why:* shadcn copies component *source code* into your repo (you own and can restyle it) and creates the theme variables in `globals.css`.
  ```powershell
  cd apps/web
  pnpm dlx shadcn@latest init
  ```
- **Component library → Radix UI.** Newer shadcn versions ask this first and mark *Base UI* as recommended, but almost every shadcn tutorial and code snippet online assumes Radix — picking it means copy-pasted examples actually match our components.
- Choose **Base theme → Mira** (you can still retheme it in Phase 4 — it only sets the starting CSS variables).
- **Icon library → Lucide.** ⚠️ Newer shadcn versions ask this too and may default to **Hugeicons**. Pick **Lucide** — it's what every shadcn example uses, and the choice is baked into the components you generate in Phase 2 (they'll `import { XIcon } from "lucide-react"`). Getting this wrong is annoying to undo later.
- **Verify before moving on:** open [components.json](../../apps/web/components.json) and confirm it says `"iconLibrary": "lucide"`. If it says `hugeicons`, change it to `lucide` **now**, before you generate components in Phase 2 — otherwise every generated component imports the wrong icon set and you have to rewrite them by hand.

### 1.4 Run it
- *Why:* confirm the skeleton actually works before you build on it.
  ```powershell
  pnpm dev
  ```
- Open **http://localhost:3000**.

**✅ Test / verify:** the default Next.js page loads with no red errors in the terminal or browser console. Edit the headline text in `src/app/page.tsx`, save, and watch the browser update in ~1 second (**Fast Refresh** — this live loop is your main tool from now on). Stop the server with `Ctrl+C`.

**💾 Commit:**
```powershell
git add -A
git commit -m "chore(web): scaffold Next.js + shadcn baseline"
```

---

## Phase 2 — Add UI components + libraries

**Goal:** pull in the shadcn components and the extra libraries you'll use.
**Why this phase:** better to add the toolbox now so later phases just *use* pieces instead of stopping to install them.

### 2.1 Add shadcn components (one line)
- *Why:* each maps to a real piece of the layout — `sidebar` = the left rail, `sheet` = the finding slide-over, `chart` = every graph, `progress` = the scan bar, etc.
  ```powershell
  pnpm dlx shadcn@latest add sidebar navigation-menu card badge button table tabs dialog sheet select chart skeleton sonner tooltip separator input progress
  ```
- *Why `chart` matters:* it installs **shadcn Chart** (a themed wrapper over Recharts). This is our **only** charting tool — it re-colors itself from your theme automatically.

### 2.2 Add the icon set
- *Why:* lucide is our icon set, used all over the UI. If you picked **Lucide** in step 1.3, shadcn already installed `lucide-react` for you and the components in 2.1 import from it — this command is just a safety net.
  ```powershell
  pnpm add lucide-react
  ```
- **✅ Check:** `pnpm exec eslint src` should report no unused-import errors, and searching `src/` for `hugeicons` should return **nothing**. If it returns hits, your icon library was set wrong in 1.3 — fix `components.json`, then either re-add those components or swap the imports by hand (e.g. `Cancel01Icon` → `XIcon`, `ArrowDown01Icon` → `ChevronDownIcon`, `SidebarLeftIcon` → `PanelLeftIcon`).

### 2.3 Add the testing libraries
- *Why:* Vitest runs fast component tests; Testing Library renders components the way a user sees them; Playwright drives a real browser for end-to-end tests; MSW is the mock backend (used in Phase 8).
  ```powershell
  pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test msw
  ```

### 2.4 Finish the two tools that need a one-time setup
- *Why:* Playwright must download real browser binaries; MSW must drop a small worker file into `public/` so it can intercept network calls in the browser.
  ```powershell
  pnpm exec playwright install
  pnpm exec msw init public --save
  ```

**✅ Test / verify:** `pnpm dev` still starts cleanly and the page still loads. Check that `public/mockServiceWorker.js` now exists and that `src/components/ui/` filled up with component files (button.tsx, card.tsx, chart.tsx, …).

**💾 Commit:** `git add -A` then `git commit -m "chore(web): add shadcn components + libraries"`

---

## Phase 3 — Configure tooling (format, lint, test runners)

**Goal:** make the editor format on save and make both test runners work.
**Why this phase:** consistent formatting stops pointless diffs; a *proven* test runner now means every later "test it" step is trustworthy.

### 3.1 Format-on-save
- *Why:* code auto-tidies so you never argue about spacing.
- Create `apps/web/.vscode/settings.json`:
  ```json
  {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" }
  }
  ```

### 3.2 Vitest config
- *Why:* tells the test runner to use a fake browser (`jsdom`), understand the `@/` alias, and load a setup file.
- Create `apps/web/vitest.config.ts`:
  ```ts
  import { defineConfig } from "vitest/config";
  import react from "@vitejs/plugin-react";
  import { fileURLToPath } from "node:url";

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
    },
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  });
  ```

### 3.3 Test setup file
- *Why:* adds friendly matchers like `toBeInTheDocument()`. (Phase 8 adds the mock server here too.)
- Create `apps/web/src/test/setup.ts`:
  ```ts
  import "@testing-library/jest-dom/vitest";
  ```

- **Also create `apps/web/src/test/vitest-globals.d.ts`:**
  ```ts
  /// <reference types="vitest/globals" />
  ```
- *Why this is needed:* `globals: true` (step 3.2) lets you write `test(...)` / `expect(...)` in test files **without importing them** — which is how the example tests in Phase 7 are written. But that only works at *runtime*; TypeScript still says `Cannot find name 'test'` and `pnpm exec tsc --noEmit` fails. This one-line file tells TypeScript those globals exist.
- *Why a `.d.ts` reference instead of adding `"types": ["vitest/globals"]` to `tsconfig.json`:* setting the `types` array **replaces** TypeScript's default behaviour of auto-including every `@types/*` package, which can silently break node/react globals. The reference file only *adds*, so nothing else changes.

### 3.4 Playwright config
- *Why:* tells Playwright where the E2E tests live and to auto-start your dev server before running them.
- Create `apps/web/playwright.config.ts`:
  ```ts
  import { defineConfig } from "@playwright/test";

  export default defineConfig({
    testDir: "./e2e",
    use: { baseURL: "http://localhost:3000" },
    webServer: { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true },
  });
  ```

### 3.5 Add scripts
- *Why:* short commands you'll type constantly.
- In `apps/web/package.json`, add to `"scripts"`:
  ```json
  "test": "vitest",
  "test:run": "vitest run",
  "test:e2e": "playwright test"
  ```

**✅ Test / verify** — prove the runner works with a throwaway test:
- Create `apps/web/src/test/smoke.test.ts`:
  ```ts
  import { test, expect } from "vitest";
  test("test runner works", () => { expect(1 + 1).toBe(2); });
  ```
- Run: `pnpm test:run` → expect **1 passed**. (You can delete `smoke.test.ts` after.)

**💾 Commit:** `git add -A` then `git commit -m "chore(web): configure prettier, vitest, playwright"`

---

## Phase 4 — Theme & design tokens

**Goal:** set your colors once as CSS variables, including the **severity** and **heat-map** colors that do real work.
**Why this phase:** shadcn components (and charts) read these variables. Set them well now and the whole app — including the file-tree heat map and graphs — is consistent and re-themeable by editing one file.

### 4.1 (Optional but recommended) design the palette visually
- *Why:* picking hex values blind is hard. **tweakcn.com** shows real shadcn components; drag sliders, then **export the CSS variables**.

### 4.2 Put the tokens in `globals.css`
- *Why:* one source of truth for color.
- In `src/app/globals.css`, keep shadcn's variables and add your semantic ones (names, not raw colors, so components stay readable):
  ```css
  :root {
    /* severity — drives finding badges */
    --severity-critical: 0 72% 51%;   /* red   */
    --severity-high:     25 95% 53%;   /* orange */
    --severity-medium:   38 92% 50%;   /* amber */
    --severity-low:      215 16% 47%;  /* slate */
    /* health heat map — tree tint from bad → good */
    --health-bad:  0 72% 51%;
    --health-mid:  38 92% 50%;
    --health-good: 142 71% 45%;
  }
  ```

### 4.3 Add a tiny color helper
- *Why:* the file tree colors each node by health; keep that logic in one place.
- In `src/lib/utils.ts` add:
  ```ts
  export function healthColor(score: number) {
    if (score < 40) return "hsl(var(--health-bad))";
    if (score < 70) return "hsl(var(--health-mid))";
    return "hsl(var(--health-good))";
  }
  ```

**✅ Test / verify:** run `pnpm dev`, temporarily set a big colored box in a page using `style={{ background: "hsl(var(--severity-critical))" }}`, confirm it's red, then change `--severity-critical` and watch it update on save. Remove the test box.

**💾 Commit:** `git add -A` then `git commit -m "feat(web): theme tokens (severity + heat-map colors)"`

---

## Phase 5 — The contract (TypeScript types) ← *the most important phase*

**Goal:** write **one file**, `src/lib/types/index.ts`, that defines the **exact shape** of every piece of data the app touches — a repo, a branch, a scan's status, the health report, a file-tree node, a finding.

**Why this phase is the keystone:** these types are the **agreement** ("contract") between your frontend and your backend teammate. Three different data sources must all fit this one mold:

```
static sample data (Phase 7)  ┐
mock API / MSW    (Phase 8)   ├─►  ALL must match  ►  src/lib/types  ◄─ the real FastAPI backend (Phase 12)
your components   (Phase 6–9) ┘
```

Because they share one mold, "static → mock → real" are painless **swaps**, not rewrites. And a wrong shape becomes a **red squiggle in your editor today**, not a **bug on demo day**.

> ### Read this once: *the contract IS your v1 feature list*
> Every field answers a product question. `Finding.severity` exists because the product ranks problems worst-first. `Finding.reason` (a one-line human explanation) exists because "low-noise, actionable" is your whole pitch. `HealthReport.history` exists **only if** v1 draws a trend chart. `Finding.status` exists **only if** v1 lets users *act* on findings, not just read them.
> So you can't finish this file without deciding what v1 does — **and that's the point.** You finalize your v1 features *by* finalizing this file. Do **5.0 before you type a single `interface`.**

### 5.0 Finalize the v1 scope (do this with your backend teammate)
- *Why:* the contract is a shared agreement, and its fields are your features. Settle scope once, here, so neither side builds a shape the other won't honor.
- Go through this map. Each row is a feature; the middle column is the type/field that encodes it; the right column is the **release** it lands in (see **[release-roadmap.md](./release-roadmap.md)**). Everything tagged **v1.0** is built now; **v1.1/v2** fields stay in the contract (kept optional) but the UI waits.

| Feature the user sees | Type / field | Release |
|---|---|---|
| Sign in with GitHub (mocked in prototype) | auth response `{ user, repos }` | **v1.0** |
| Connect a repo by public URL (1 repo = 1 project) | `Repo` (`url`, `source`, `visibility`, `owner`) | **v1.0** |
| Projects list + health hint + Select | `Repo.latestHealth` | **v1.0** |
| Branch selector (re-scopes the snapshot) | `Branch` | **v1.0** |
| Manual scan with % progress + Stop | `ScanStatus`, `ScanPhase` | **v1.0** |
| Last analyzed time + commit SHA | `HealthReport.scannedAt` / `commitSha` | **v1.0** |
| Overall Health card (score · grade · delta · red count) | `HealthReport.healthScore/grade/delta/redIssueCount` | **v1.0** |
| Category **pie** on the Health card | `HealthReport.categoryBreakdown`, `CategoryBreakdownItem` | **v1.0** |
| Health Graph **trend** (Card B, repo scope) | `HealthReport.history`, `HealthPoint` | **v1.0** |
| Refactor-First list (+ **filter by debt type**) | `HealthReport.findings`, `Finding`, `Severity`, `Source`, `Category` | **v1.0** |
| Finding detail (reason · file · line · evidence) | `Finding.reason/file/line/symbol/source/category/ruleId/metricValue` | **v1.0** (snippet = v1.1) |
| Heat-map file tree (red→amber→green, drill-in) | `HealthReport.tree`, `TreeNode.healthScore` | **v1.0** |
| Per-file debt / risk numbers + risk badge | `FileScore`, `TreeNode.debtScore/riskScore` | **v1.0** |
| Scan-history tab (list past scans, load one) | `ScanSummary` | **v1.0** |
| Scoring profile — select a preset | `ScoreProfile` | **v1.0** (custom sliders = v1.1) |
| Act on a finding (accept / resolve / false-positive) | `Finding.status`, `FindingStatus` | **v1.1** (view-only in v1.0) |
| Standalone category-breakdown view | group / filter by `Category` | **v1.1** |
| Private repos (GitHub App) | `Repo.visibility = "private"` | **v1.1** |
| Card B per-node health (hover a file) | per-node `HealthPoint` series | **v2** |
| Multi-repo workspace + rollup, Team / RBAC | `Workspace`, `Member`, `Role` | **v2** |

- **Three decisions to settle now** — they're the only things that change the file:
  1. **Finding actions** — can a user *change* a finding (Accept debt / Resolve), or only *read* findings in v1? (Drives `status` + whether the backend needs write endpoints.)
  2. **Health Graph (Card B)** — a **trend over time** (needs the backend to keep scan history from day one) or a **current-score gauge** (no history needed)? (Drives whether `history` is Core or Later.)
  3. **Which detectors are real in v1** — security secrets? TODO/FIXME (SATD)? code-design (complexity/duplication)? requirement/doc gaps? Only claim what the backend can actually produce for the demo — it sets the real values of `source` and `category`.

- **✅ Locked for CodeSage v1** (decided with the team):
  1. **Findings are read-only** — view + detail panel; no Accept/Resolve. `status` stays in the type, set by the backend (default `"open"`); no user actions or write endpoints in v1.
  2. **Card B = trend over time** — `history` is Core; the mock supplies points now, the backend fills them as scans accumulate.
  3. **Detectors = the full v1 engine** — rule engine (**code-design** rules *and* **security** patterns: secrets, SQL concat, `eval`/`exec`) + **SATD classifier** (`code-design` / `requirement` / `documentation` / `test`) + **risk model** (per-file 0–1 score → hotspot colour + ranking boost, *not* a line item). So the Refactor-First list carries `source: "rule" | "satd" | "security"` findings, and the golden-repo fixture keeps its **critical hardcoded-secret** and **medium TODO** examples (they match the backend's worked example, `code-sage_backend-analysis-engine.md` §6). *(This supersedes the earlier "code-design only" draft — the backend analysis doc restores security + SATD as core.)*

- **The scope lever:** keep the *full* contract from §6.1 (it shows the backend the whole roadmap), but for anything you tagged **Later**, mark its field **optional** with `?` and a `// later:` comment — so neither the mock nor the backend is forced to fill it in v1. (Or leave the field out entirely and add it when you build that feature.)

### 5.1 Create the file ✅ *(done — the file now exists)*
- `src/lib/types/index.ts` has been created with the finalized v1 contract:
  - **enums:** `Severity`, `Source`, `Category`, `FindingStatus`, `Grade`
  - **entities:** `Finding`, `FileScore`, `TreeNode`, `Repo`, `Branch`, `ScanStatus`/`ScanPhase`, `ScanSummary`, `HealthPoint`, `CategoryBreakdownItem`, `ScoreProfile`, `HealthReport`
  - **v2 seam:** `Role`, `Member`, `Workspace`
  - Later-release fields are marked `// v1.1` / `// v2` and kept optional.
- This file is now the **canonical** contract (the plan's §6.1 is a documented mirror; keep them in sync via PR).
- *Why one file:* everyone imports from `@/lib/types`, so a shape changes in exactly one place — and one PR to review when it does.

### 5.2 Label every type with the feature it serves
- *Why:* a one-line comment above each type (`// Refactor-First list row`) keeps the file readable **and** doubles as your SRS "dashboard outputs" notes (plan §9) — you're writing requirements for free.

### 5.3 Freeze it
- *Why:* once screens are built on these shapes, a silent change breaks both teammates. After 5.0–5.2, tell the team **"types are frozen."** From then on, any shape change is a PR you both review (plan §9).

**✅ Test / verify:** `pnpm exec tsc --noEmit` → **0 errors** (already passing). Nothing imports the types yet, so this just proves the file itself is valid TypeScript.

**💾 Commit:** `git add -A` then `git commit -m "feat(web): data contract types"`

---

## Phase 6 — App shell & routing (static first)

**Goal:** create the pages and the **left rail** so you can click through the whole app — Login → Projects → Dashboard → Scan History → Profiles — with **placeholder text and no data yet**.
**Why this phase:** get the navigation skeleton solid *before* filling screens. In the App Router **folders are routes**, so this phase is mostly creating the right files plus one client component (the rail).

> **Scope note (finalized).** The rail now has more destinations than the original two. **v1.0 rail:** Projects · Dashboard · Scan History · Profiles, plus an **Account** menu pinned to the bottom. **Team** is **v2** — add it as a disabled "Coming soon" stub or skip it. (See [release-roadmap.md](./release-roadmap.md).)

### 6.0 The five App Router ideas you'll use (read once)
1. **Folder = route.** A folder under `src/app/` with a `page.tsx` becomes a URL. `projects/page.tsx` → `/projects`.
2. **Route group `(name)`.** A folder in parentheses groups routes **without** adding to the URL, so a group can have its **own `layout.tsx`**. We use `(auth)` (login — *no rail*) and `(app)` (everything else — *with rail*).
3. **Dynamic segment `[param]`.** `dashboard/[repoId]/page.tsx` → `/dashboard/anything`. Read it from the page's `params` prop. This is why a dashboard link is shareable — the repo id lives in the URL.
4. **Nested layouts persist.** A `layout.tsx` wraps every page beneath it and **stays mounted across navigation** — perfect for the rail (it doesn't re-render when you switch pages).
5. **Server vs Client.** Pages are **Server Components** by default (fast, ship no JS). Only the **rail** needs interactivity (highlight the active link) → it gets `"use client"`. Keep that boundary small: **rail = client, pages = server.**

### 6.1 Create the route files
- *Why:* each file is a screen; the `(auth)`/`(app)` split gives login and the app different chrome.

```
src/app/
├── layout.tsx                       # root (already exists) — fonts, providers
├── page.tsx                         # "/" → redirect to /projects (see 6.2)
├── (auth)/
│   └── login/page.tsx               # "Sign in with GitHub" button — NO rail (wired in Phase 8)
└── (app)/
    ├── layout.tsx                   # the shell: <AppRail/> + the page beside it
    ├── projects/page.tsx            # "Projects" heading + placeholder
    ├── dashboard/[repoId]/
    │   ├── page.tsx                 # "Dashboard" placeholder (reads params.repoId)
    │   └── history/page.tsx         # "Scan History" placeholder (per project)
    ├── profiles/page.tsx            # "Profiles" placeholder (select a scoring preset)
    └── team/page.tsx                # v2 STUB — "Coming soon" (optional)
```
- Each `page.tsx` for now is just a heading + one line of placeholder text. No data, no feature components yet.
- In `dashboard/[repoId]/page.tsx`, prove the dynamic segment works by reading and showing the id. **Gotcha (Next.js 16):** `params` is a **Promise** — the page must be `async` and `await` it:
  ```tsx
  export default async function Page({ params }: { params: Promise<{ repoId: string }> }) {
    const { repoId } = await params;
    return <h1>Dashboard — {repoId}</h1>;
  }
  ```

### 6.2 Redirect the root
- *Why:* out of the box `/` is the Next.js welcome page; send it into the app.
- In `src/app/page.tsx`:
  ```tsx
  import { redirect } from "next/navigation";
  export default function Home() { redirect("/projects"); }   // later: /login when signed out
  ```

### 6.3 The two layouts
- **`src/app/(app)/layout.tsx`** renders the rail next to the content. It can stay a **Server Component** — it just composes client pieces:
  ```tsx
  import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
  import { AppRail } from "@/components/layout/app-rail";
  export default function AppLayout({ children }: { children: React.ReactNode }) {
    return (
      <SidebarProvider>
        <AppRail />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    );
  }
  ```
  *(Passing server `children` into the client `SidebarInset` is allowed — the layout itself stays server.)*
- **`(auth)`** needs no rail: `login/page.tsx` renders on its own (optionally add a tiny `(auth)/layout.tsx` that just centers its child).

### 6.4 Build the left rail
- *Why:* the app's primary navigation, persistent across screens, with the **active** item highlighted.
- `src/components/layout/app-rail.tsx` — a **client** component using shadcn `sidebar` + `lucide-react` icons. The one tricky bit is the active state; here's the skeleton — **you fill the JSX**:
  ```tsx
  "use client";                                   // usePathname → must be a client component
  import Link from "next/link";
  import { usePathname } from "next/navigation";
  import { FolderGit2, LayoutDashboard, History, SlidersHorizontal, Users } from "lucide-react";
  // shadcn pieces: Sidebar, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter

  const NAV = [
    { href: "/projects",                     label: "Projects",     icon: FolderGit2,        match: "/projects" },
    { href: "/dashboard/demo-repo",          label: "Dashboard",    icon: LayoutDashboard,   match: "/dashboard" }, // hardcode a demo id for now
    { href: "/dashboard/demo-repo/history",  label: "Scan History", icon: History,           match: "/history"  },
    { href: "/profiles",                     label: "Profiles",     icon: SlidersHorizontal, match: "/profiles" },
    { href: "/team",                         label: "Team",         icon: Users,             match: "/team", badge: "v2" },
  ];

  export function AppRail() {
    const pathname = usePathname();
    const isActive = (m: string) => pathname === m || pathname.startsWith(m);
    // return <Sidebar> … map NAV → <SidebarMenuButton asChild isActive={isActive(item.match)}>
    //   <Link href={item.href}><item.icon /> {item.label}</Link> … </SidebarMenuButton>
    //   … then a <SidebarFooter> with the Account menu (Sign out / Settings / Billing — stubs for now)
  }
  ```
- **Active-state logic is the thing to get right.** Compare `usePathname()` to each item's `match`. Note `/dashboard/demo-repo/history` starts with `/dashboard` **and** `/history` — so check the **more specific** match first (or match `/history` explicitly) or Scan-History will also light up Dashboard.
- **`SidebarMenuButton asChild` + `<Link>`** is the shadcn pattern that makes a menu item a real client-side link.
- **Account (footer):** for now a simple button showing the (fake) user; wire the real menu later. When you want a proper dropdown, add it — it isn't installed yet: `pnpm dlx shadcn@latest add dropdown-menu`.
- *Why hardcode `demo-repo`:* there's no "selected project" state until Phase 9, so the Dashboard/History links point at a fake id purely so navigation works. Phase 9 swaps in the actually-selected repo.

### What is NOT in this phase
No data fetching, no `useHealthReport`; **no top nav** (the branch dropdown, Scan button, and last-checked/SHA come in Phases 7 + 9); no real auth (Phase 8/12); Team is a stub. Everything is placeholder text — that's correct.

**✅ Test / verify:** `pnpm dev`, then:
- `/` redirects to `/projects`.
- The rail shows Projects · Dashboard · Scan History · Profiles (· Team stub), and the **active** item highlights as you click.
- `/login` shows the sign-in button **with no rail**.
- `/dashboard/demo-repo` prints the id `demo-repo` (dynamic segment works); `/dashboard/demo-repo/history` shows the Scan-History placeholder.
- It's ugly and empty — that's the goal.

**💾 Commit:** `git add -A` then `git commit -m "feat(web): app shell + left rail routing"`

---

## Phase 7 — Build the screens with STATIC data (+ component tests)

**Goal:** make every screen *look* finished, using hardcoded sample objects (typed by the Phase 5 contract) passed straight into components. Add a component test as you finish each one.
**Why this phase:** fastest way to a real-looking UI, and it forces every component to be **presentational** (data in through props) — which is exactly what makes the Phase 8 mock swap trivial and the tests easy.

### 7.0 Add the colour helpers (in `src/lib/utils.ts`)
- *Why:* the severity/health tokens are CSS variables, **not** Tailwind colours, so components read them through helpers (returning `hsl(var(--…))` strings for `style={{ color }}`):
  - `gradeColor(grade)` — A/B green · C amber · D orange · E red.
  - `severityColor(severity)` — `hsl(var(--severity-<severity>))`, drives finding badges.
  - `shortSha(sha)` — first 7 chars for the top-nav SHA. (`healthColor` already exists from Phase 4.)

### 7.1 A place for sample data
- *Why:* one tidy file of realistic examples you can import anywhere while there's no backend.
- Create `src/lib/mocks/fixtures.ts`. Because the contract grew (Phase 5), a full `HealthReport` fixture now needs **all** of: `scanId`, `commitSha`, `scannedAt`, `healthScore`, `grade`, `delta`, `profile`, `redIssueCount`, `history[]` (trend), `tree[]` (varied `healthScore` → red/amber/green), `fileScores[]`, `findings[]` (each with a `priority` so the list sorts), and `categoryBreakdown[]` (the pie). Include the **critical hardcoded-secret** and **medium SATD TODO** findings from the backend worked example, plus `mockRepos`, `mockBranches`, `mockScanHistory`, `mockProfiles`.

### 7.2 Build the components (import the fixtures for now)
Build these one at a time; render each with a fixture object. Each is **presentational** — data in through props, no fetching. *Props are typed by `@/lib/types`.*

- `dashboard/overall-health-card.tsx` — **Card A**: score / grade / delta / **red-issue count** + a small **category pie**. Grade colour via `gradeColor`.
- `dashboard/health-graph-card.tsx` — **Card B**: a **shadcn Chart** area chart of `history` (repo trend). Compose Recharts primitives *inside* `ChartContainer`; **never import a bare Recharts chart.** ⚠️ **Recharts v3:** `<Cell>` is deprecated — colour slices by putting a `fill` field on each datum instead.
- `dashboard/refactor-first-list.tsx` — findings **Table**, sorted by `priority` (desc), severity **badges**, and a **filter-by-debt-type** `Select`. Row click → `onSelect(finding)`.
- `dashboard/finding-detail-panel.tsx` — a **Sheet** slide-over: severity/category/source badges, `file:line`, the one-line **reason**, and **evidence** (`metricValue` vs `threshold`). *(Snippet is v1.1.)* Controlled by `open` / `onOpenChange`.
- `dashboard/file-tree/file-tree.tsx` — the **heat-map tree** (recursive placeholder). Each row is a `<button>` (keyboard-accessible) tinted via `colorFor(node)`; folders expand/collapse; emits `onHoverNode` / `onSelectNode`. Keep the prop contract stable so a real tree lib swaps in here only.
- `layout/dashboard-topnav.tsx` + `layout/scan-control.tsx` — branch **Select**, the **Scan** state machine (`idle → running(%) + Stop`), last-analyzed time + short SHA. In Phase 7 `scan` is static (`phase: "idle"`); Phase 9 wires the real state machine.
- `projects/connect-repo.tsx` + `projects/project-list.tsx` — public-URL **Tabs**/input (+ private stub) and the vertical project list with a **Select**.

### 7.3 Assemble the pages
- **Dashboard** — the page owns state (selected finding, hovered node, active branch), so split it: keep `dashboard/[repoId]/page.tsx` a **Server Component** that `await`s `params` and renders a **client** `components/dashboard/dashboard-view.tsx` (`"use client"`) which holds the state and composes everything from the fixture. *(Server page → client view is the pattern for any stateful screen behind a dynamic route.)*
- **Projects** — `projects/page.tsx` is a **client** page (`"use client"`, uses `useRouter`) rendering `<ConnectRepo/>` + `<ProjectList onSelect={r => router.push(\`/dashboard/${r.id}\`)} />`.

### 7.4 Component tests (the testing stage)
- *Why:* lock in the logic (grade/delta, sorting, filtering, heat-map tint, scan states) so future changes can't silently break them.
- ⚠️ **Test-setup gotcha (do this first, or every UI test crashes).** jsdom lacks browser APIs that shadcn/Radix/Recharts rely on. In `src/test/setup.ts` add polyfills **and** auto-cleanup:
  ```ts
  import "@testing-library/jest-dom/vitest";
  import { afterEach } from "vitest";
  import { cleanup } from "@testing-library/react";
  afterEach(cleanup);                                   // isolate tests

  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }; // Recharts
  Element.prototype.scrollIntoView = () => {};           // Radix Select/Dialog
  Element.prototype.hasPointerCapture = () => false;     //  "
  Element.prototype.setPointerCapture = () => {};        //  "
  Element.prototype.releasePointerCapture = () => {};    //  "
  ```
  With these, charts render as empty (no crash) and a **Radix `Select` can be driven**: `click(getByRole("combobox"))` → `click(findByRole("option", { name }))`.
- Example — `overall-health-card.test.tsx`:
  ```tsx
  render(<OverallHealthCard score={88} grade="A" delta={3} redIssueCount={2}
           categoryBreakdown={[{ category: "security", count: 1, debt: 8 }]} />);
  expect(screen.getByText("A")).toBeInTheDocument();
  expect(screen.getByText(/\+3 since last scan/)).toBeInTheDocument();
  ```
- Write 1–3 tests per component **with logic**: health card (grade/delta/red count), refactor list (sort + filter + row click), file tree (`colorFor` used, collapse hides children, hover/select fire), scan control (idle→Scan, running→Stop), project list (renders + `onSelect`), connect-repo (submits URL), finding-detail (shows reason). Skip pure layout wrappers. Also unit-test the `utils` helpers.

**✅ Test / verify — run all four gates:**
```powershell
pnpm test:run           # component tests
pnpm exec tsc --noEmit  # types
pnpm exec eslint src    # lint
pnpm build              # ← the real gate: renders every route (catches empty pages, client/server + provider issues)
```
Then `pnpm dev` and eyeball the dashboard — it should look like the real product with fake numbers.

**💾 Commit:** commit per component, e.g. `git commit -m "feat(web): overall-health card + test"`.

> **Status:** ✅ Phase 7 complete & verified — 9 components + `dashboard-view`, fixtures, dashboard + projects screens, **8 test files / 20 tests passing**, `tsc`/`eslint`/`build` all clean.

---

## Phase 8 — The mock backend (MSW) ← *the "mock backend at the last" part*

**Goal:** replace the hardcoded imports from Phase 7 with data that arrives over the **network** from a fake API, so the app behaves exactly like it will with the real backend.
**Why MSW specifically:** MSW intercepts real `fetch()` calls at the **network layer**, so your components call `/api/...` and don't know or care that it's fake. Bonus: the **same handlers** feed your dev app, your component tests, and your E2E tests — one definition of "the API," everywhere. When the real backend is ready you flip one switch and delete this folder.

> **Important App-Router tip:** run your data-fetching components as **client components** (put `"use client"` at the top) and fetch inside a hook. The MSW browser worker only intercepts calls made in the browser, so client-side fetching is the simplest setup that "just works."

### 8.1 Turn fixtures into API responses (handlers)
- *Why:* these are the fake endpoints. Reuse the Phase 7 fixtures so the story stays identical.
- Create `src/lib/mocks/handlers.ts` — copy the handlers from **[frontend_prototype_plan.md §6.3](./frontend_prototype_plan.md)** (projects, branches, health, mocked GitHub auth, and a scan that reports increasing progress).
- ⚠️ **The §6.3 snippet predates the real `fixtures.ts` — adapt as you paste** (this is what actually shipped):
  - `mockProjects` → **`mockRepos`**; `mockBranches(repoId)` (a function) → **`mockBranches`** (a plain array); there is no `mockPrivateRepos` (auth returns `mockRepos`).
  - `mockHealthReport` is a **constant**, not a function — so the health handler *derives* the per-repo/per-branch report (score from `repo.latestHealth`, a `-6` shift for non-default branches, the trend re-based to end at the current score, `redIssueCount` counted from `findings`). Fixtures stay pure data.
  - Prefix every route with `*/` (e.g. `*/api/projects`) so the pattern matches both the browser's relative URL **and** Node's absolute URL in tests — kills a whole class of "passes in dev, fails in `test:run`" bugs.
  - The scan handler is an **in-memory state machine** (start → +17%/poll → done; stop → idle). Export a `resetMockBackend()` to clear it between tests (`server.resetHandlers()` can't see a module-level `Map`).
  - Two extra reads shipped because their fixtures already exist: `*/api/repos/:repoId/scans` (Scan-History) and `*/api/profiles`.

### 8.2 Two ways to run the handlers (browser + node)
- *Why:* the browser worker powers the dev app; the node server powers tests.
  ```ts
  // src/lib/mocks/browser.ts
  import { setupWorker } from "msw/browser";
  import { handlers } from "./handlers";
  export const worker = setupWorker(...handlers);
  ```
  ```ts
  // src/lib/mocks/server.ts
  import { setupServer } from "msw/node";
  import { handlers } from "./handlers";
  export const server = setupServer(...handlers);
  ```

### 8.3 Start the worker in the app (only when mocking is on)
- *Why:* you want mocks in the prototype but an easy off-switch for later.
- Create `src/components/msw-provider.tsx`:
  ```tsx
  "use client";
  import { useEffect, useState } from "react";
  export function MswProvider({ children }: { children: React.ReactNode }) {
    const on = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";
    const [ready, setReady] = useState(!on);
    useEffect(() => {
      if (!on) return;
      import("@/lib/mocks/browser").then(async ({ worker }) => {
        await worker.start({ onUnhandledRequest: "bypass" });
        setReady(true);
      });
    }, [on]);
    return ready ? <>{children}</> : null;   // wait until the fake API is intercepting
  }
  ```
- Wrap `{children}` with `<MswProvider>` in `src/app/layout.tsx`.
- Create `apps/web/.env.local` with: `NEXT_PUBLIC_API_MOCKING=enabled`
  - *Why an env flag:* Phase 12 turns mocking off by changing this one line — no code edits.

### 8.4 The API client + data hooks
- *Why:* thin functions that make the real network calls, plus hooks that give components `{ data, loading, error }`.
- Create `src/lib/api/client.ts` — copy from **[plan §6.2](./frontend_prototype_plan.md)** (`getProjects`, `getBranches`, `getHealthReport`, `startScan`, `stopScan`).
- Create hooks in `src/hooks/` (client components), e.g.:
  ```ts
  "use client";
  import { useEffect, useState } from "react";
  import { getHealthReport } from "@/lib/api/client";
  import type { HealthReport } from "@/lib/types";
  export function useHealthReport(repoId: string, branch: string) {
    const [data, setData] = useState<HealthReport>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error>();
    useEffect(() => {
      let alive = true; setLoading(true);
      getHealthReport(repoId, branch)
        .then(r => { if (alive) setData(r); })
        .catch(e => { if (alive) setError(e); })
        .finally(() => { if (alive) setLoading(false); });
      return () => { alive = false; };
    }, [repoId, branch]);
    return { data, loading, error };
  }
  ```

### 8.5 Swap static imports for hook data
- *Why:* this is the actual "connect to the (mock) backend" moment.
- In each page, replace `import { fixtureX }` usage with the matching hook (`useProjects()`, `useHealthReport()`, …) and pass the hook's `data` into the same components. **The components don't change** — only where their props come from.

### 8.6 Make tests use the same mock API
- *Why:* one definition of the API for dev *and* tests.
- Update `src/test/setup.ts`:
  ```ts
  import "@testing-library/jest-dom/vitest";
  import { afterAll, afterEach, beforeAll } from "vitest";
  import { server } from "@/lib/mocks/server";
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  ```

**✅ Test / verify:** `pnpm dev` — the app now shows the fixture data, but it's arriving via `fetch()` (open DevTools → Network → you'll see `/api/...` calls handled by the worker). Delete a component's hardcoded import to confirm the data truly comes from the mock. Then `pnpm test:run` — tests still pass, now over MSW.

**💾 Commit:** `git add -A` then `git commit -m "feat(web): MSW mock backend + data hooks"`

> ### Status: ✅ Phase 8 complete & verified
> The app now pulls **all** dashboard/projects data over (mock) `fetch()` — verified in a real browser (Playwright): `/api/projects`, `/api/repos/:id/branches`, and `/api/repos/:id/health?branch=` are all intercepted by the worker, 0 console/hydration errors. Gates green: `tsc` 0 · `eslint --max-warnings 0` 0 · `build` 8 routes · **23 tests / 10 files** (the +3 are `use-health-report.test.ts`, which fetch through the Node MSW server — no fixture import).
>
> **What shipped beyond the guide's sketch (all deliberate):**
> - **8.3 provider** — `MswProvider` has a safety net: if `worker.start()` throws, it logs and renders anyway instead of trapping the whole app behind a permanent blank screen.
> - **8.4 client** — added `getScanStatus`, `getScanHistory`, `getProfiles`; a `NEXT_PUBLIC_API_BASE_URL` seam (empty in dev, points at the real API in Phase 12); non-2xx responses **throw** so hooks can surface `error`.
> - **8.4 hooks** — the three hooks share one **`useQuery(key, fetcher)`** engine. It derives `loading` (settled-key ≠ current-key) instead of calling `setState` at the top of the effect, which is what keeps it clean under React 19's **`react-hooks/set-state-in-effect`** rule (the same rule that forced the `use-mobile` refactor in commit 38b9ce6). Free bonus: switching branch clears stale data instantly — no flash of the old numbers.
> - **8.5 pages** — [dashboard-view.tsx](../../apps/web/src/components/dashboard/dashboard-view.tsx) and [projects/page.tsx](../../apps/web/src/app/(app)/projects/page.tsx) now use the hooks, with minimal loading (`Skeleton`) + error states (full DoD polish is Phase 11). Branch defaults to the repo's default branch once `useBranches` resolves; the initial `?branch=` empty fetch is a harmless double-fetch (mock is instant, same data).
> - **8.6 tests** — `resetMockBackend()` runs in `afterEach` alongside `server.resetHandlers()`.
>
> **⚠️ Teammate step:** `apps/web/.env.local` (`NEXT_PUBLIC_API_MOCKING=enabled`) is **gitignored**. On a fresh clone the flag is missing → mocking is off → the app shows no data. Each teammate must create their own (a committed `.env.example` is the fix — Phase 11).
>
> **Not wired (correctly):** `ConnectRepo` submit — there is no create-repo endpoint in the v1 mock, so the form stays a stub until that endpoint exists.

---

## Phase 9 — Wire the interactions

**Goal:** make the moving parts move — scan, branch switch, tree→graph link, finding detail — so the dashboard *responds* to the user instead of just displaying fixed numbers.
**Why this phase:** the static screens are done and the data already arrives over the (mock) network (Phase 8). What's missing is *behaviour*: pressing a button, switching a branch, opening a panel. That behaviour is what makes the demo feel like a product rather than a slideshow.

> ### 9.0 — Read this first: half of Phase 9 already shipped in Phase 8.5
> When Phase 8 pointed the pages at the data hooks, it also wired three of the four interactions **as a side effect** — the dashboard had to hold state to consume the hooks at all. So don't rebuild them. Here's the honest starting line:
>
> | Interaction | Status coming into Phase 9 | What's left |
> |---|---|---|
> | **Branch dropdown re-scoping** | ✅ **Working** — [dashboard-view.tsx](../../apps/web/src/components/dashboard/dashboard-view.tsx) holds `pickedBranch`; changing the `Select` re-keys `useHealthReport`, which refetches (there's already a passing test, `use-health-report.test.ts` → *"refetches when the branch changes"*). | **Verify + a component-level guard** (9.5). |
> | **Finding detail slide-over** | ✅ **Working** — `openFinding` opens the `FindingDetailPanel` Sheet from a Refactor-list row **and** from a tree file click. | **Verify** (9.6). |
> | **Tree hover → Card B** | ⚠️ **Wire only** — `onHoverNode` is connected but the value is deliberately dropped (`const [, setHoveredNode]`); Card B still renders repo health. | **Keep the wire, document the v2 flip** (9.4). |
> | **Scan button state machine** | ❌ **Not built** — the top nav gets a hardcoded `scan={{ phase: "idle", progress: 0 }}`; there is no `useScan` hook, no polling, no toast. | **Build it** (9.1–9.3) — the real work of this phase. |
>
> **Everything the scan machine needs already exists** and is unused, waiting for this phase: `startScan` / `getScanStatus` / `stopScan` in [lib/api/client.ts](../../apps/web/src/lib/api/client.ts), the in-memory scan state machine + `resetMockBackend()` in [lib/mocks/handlers.ts](../../apps/web/src/lib/mocks/handlers.ts) (POST starts it, each poll adds +17%, POST-stop resets it), and the themed `Toaster` in [components/ui/sonner.tsx](../../apps/web/src/components/ui/sonner.tsx). Phase 9 connects these; it doesn't write new endpoints.

**Order of work:** do **9.1 → 9.2 → 9.3** together (they're the scan feature, and 9.3 can't be tested until 9.1 is mounted). **9.4 / 9.5 / 9.6** are short verify-and-harden passes on the already-wired interactions. **9.7** is an optional companion (sign-in) that Phase 10's E2E needs. **9.8** adds the tests. The phase closes with the four-gate check + a commit per interaction (the ✅/💾 boxes at the end).

---

### 9.1 — Mount the toast surface (do this first — the scan needs it)

- *Why:* the scan machine announces "Scan complete" / "Scan stopped" with a `sonner` toast, and later phases (finding actions in v1.1) reuse it. But a `toast()` call renders **nothing** unless a `<Toaster/>` is mounted somewhere in the tree — and right now it isn't mounted anywhere. Mount it once, globally.
- In [src/app/layout.tsx](../../apps/web/src/app/layout.tsx), render the `Toaster` inside `<body>` so every route (dashboard *and* login) can raise toasts:
  ```tsx
  import { Toaster } from "@/components/ui/sonner";
  // …
  <body className="min-h-full flex flex-col">
    <MswProvider>{children}</MswProvider>
    <Toaster richColors position="bottom-right" />
  </body>
  ```
- *Why it's safe in a Server Component:* `sonner.tsx` is already `"use client"`, so the root layout stays a server component and just composes it. Its `useTheme()` returns `"system"` when no `next-themes` provider is present — fine, no provider needed in v1.

**✅ Micro-check:** temporarily drop `onClick={() => toast("hello")}` on any button, click it, see the toast, then remove it.

---

### 9.2 — The `useScan` hook (start → poll → finish/stop) ← *the core of this phase*

- *Why a hook:* the Scan button is a **state machine over time** — `idle → running(%) → done`, with Stop as an escape hatch — and the progress only advances when you *poll*. That's stateful, async, timer-driven logic: exactly what a custom hook is for. Keeping it out of the component leaves `scan-control.tsx` a dumb presentational piece (already tested) and makes the machine unit-testable on its own.
- *Why polling:* the mock (and the real Celery worker later) can't "push" progress; the client asks *"how far along?"* on an interval until the answer is `done`. `getScanStatus` is that question; the mock's `advanceScan("tick")` moves it +17% each call.
- Create `src/hooks/use-scan.ts` (sibling of `use-branches` / `use-health-report`, same `"use client"` + double-quote/no-semicolon style):
  ```ts
  "use client"

  import { useCallback, useEffect, useRef, useState } from "react"
  import { toast } from "sonner"

  import { getScanStatus, startScan, stopScan } from "@/lib/api/client"
  import type { ScanStatus } from "@/lib/types"

  const POLL_MS = 600 // ~6 polls × 17% ≈ 4s from 0 → done; slow enough to watch, fast enough to demo
  const IDLE: ScanStatus = { scanId: "", phase: "idle", progress: 0 }

  /**
   * Drives the Scan button. `scan(branch)` POSTs to start, then polls until the
   * backend says `done`; `stop()` cancels. `onComplete` runs once on success —
   * the dashboard uses it to refetch the health report (9.3).
   */
  export function useScan(repoId: string, onComplete?: () => void) {
    const [status, setStatus] = useState<ScanStatus>(IDLE)
    const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

    const clearTimer = useCallback(() => {
      if (timer.current) clearInterval(timer.current)
      timer.current = undefined
    }, [])

    // Only job of the effect: stop polling if the user navigates away mid-scan.
    // No setState in the effect body → stays clear of react-hooks/set-state-in-effect.
    useEffect(() => () => clearTimer(), [clearTimer])

    const scan = useCallback(
      async (branch: string) => {
        clearTimer()
        const started = await startScan(repoId, branch) // phase: "running", progress: 0
        setStatus(started)
        timer.current = setInterval(async () => {
          const next = await getScanStatus(repoId, started.scanId)
          setStatus(next)
          if (next.phase === "done" || next.phase === "error") {
            clearTimer()
            if (next.phase === "done") {
              toast.success("Scan complete")
              onComplete?.()
            } else {
              toast.error(next.error ?? "Scan failed")
            }
          }
        }, POLL_MS)
      },
      [repoId, onComplete, clearTimer],
    )

    const stop = useCallback(async () => {
      clearTimer() // stop polling *first* so a late tick can't re-set "running"
      const stopped = await stopScan(repoId, status.scanId)
      setStatus(stopped) // phase: "idle", progress: 0
      toast("Scan stopped")
    }, [repoId, status.scanId, clearTimer])

    return { status, scan, stop }
  }
  ```
- **The three things to get right** (each is a real bug if you don't):
  1. **State is set in callbacks, never in the effect body.** The `useEffect` returns *only* a cleanup. This is the same React 19 `react-hooks/set-state-in-effect` rule the `useQuery` engine was written around (Phase 8 status) — respect it or `eslint --max-warnings 0` fails the gate.
  2. **Clear the interval before Stop resolves.** If a poll is in flight when the user hits Stop, its `setStatus(next)` could re-paint "running… 51%" *after* you reset to idle. Clearing the timer first kills that race.
  3. **Cleanup on unmount.** Navigating away from `/dashboard/[repoId]` mid-scan must stop the interval, or it keeps fetching against an unmounted tree.

---

### 9.3 — Wire the scan into the dashboard

- *Why here:* the top nav is presentational — it renders whatever `scan` prop it's handed. The **dashboard view** is the stateful owner (it already owns branch + finding state), so the hook lives there and feeds the nav.
- In [dashboard-view.tsx](../../apps/web/src/components/dashboard/dashboard-view.tsx), replace the hardcoded scan prop with the hook, and hand the nav real `onScan` / `onStop` callbacks:
  ```tsx
  // was: scan={{ phase: "idle", progress: 0 }}
  const { status: scanStatus, scan: runScan, stop: stopScan } = useScan(repoId)
  // …
  <DashboardTopNav
    /* …existing props… */
    scan={{
      phase: scanStatus.phase,
      progress: scanStatus.progress,
      onScan: () => runScan(activeBranch), // scans the branch currently in view
      onStop: stopScan,
    }}
  />
  ```
- `scan-control.tsx` needs **no change** — it already renders `idle → Scan` / `running → "Scanning… {progress}%" + Stop` from exactly this prop shape. (`phase: "done"` falls through to the idle-looking Scan button, which is the correct resting state after a finished scan.)
- **Optional — refetch the report when a scan finishes.** In the v1 *mock*, a scan doesn't mutate the stored report, so refetching shows the same numbers — but the real backend *will* write a fresh snapshot, so wire the seam now:
  - Hold a nonce in the view: `const [scanNonce, setScanNonce] = useState(0)`.
  - Pass `onComplete` to the hook: `useScan(repoId, () => setScanNonce((n) => n + 1))`.
  - Fold it into the health key so a bump forces a refetch. Make it a **defaulted, backward-compatible** third arg so nothing else breaks:
    ```ts
    // use-health-report.ts
    export function useHealthReport(repoId: string, branch: string, refresh = 0) {
      return useQuery(`health:${repoId}:${branch}:${refresh}`, () =>
        getHealthReport(repoId, branch),
      )
    }
    ```
  - Then call `useHealthReport(repoId, activeBranch, scanNonce)`. The existing tests pass `useHealthReport(id, branch)` with no third arg → `refresh` defaults to `0` → keys are unchanged in spirit, tests stay green. Mark it clearly as the "real-backend seam" so a reviewer knows it's intentional and currently a no-op against the mock.

---

### 9.4 — Tree hover → Card B: keep the wire, document the flip (no behaviour change)

- *Why almost nothing to do:* per the plan's interaction contract (§2.3), **v1 Card B always shows repo health**; the point is only that the *plumbing* exists so the v2 switch is a data swap, not a rewrite. The wire is already in place — `FileTree` fires `onHoverNode(node)` and the view holds the setter.
- **The one deliberate choice:** today the hovered value is *discarded* (`const [, setHoveredNode]`) so there's no unused-variable lint error and no accidental re-render churn. Keep it that way in v1. When v2 flips Card B to per-node health it becomes:
  ```tsx
  const [hoveredNode, setHoveredNode] = useState<TreeNode | null>(null)
  // …
  <HealthGraphCard history={hoveredNode?.history ?? report.history} />
  ```
  That's the "one-line change" the plan promises — **plus** a fixture/contract addition, because `TreeNode` carries no `history` yet (per-node `HealthPoint[]` is a v2 field per the roadmap). Note that in a `// v2:` comment above the setter so the next person sees both halves of the change.

---

### 9.5 — Branch re-scoping: verify + a component guard

- *Why still a subphase:* the behaviour works (9.0), but the *component* has a subtle failure mode worth locking down. When branches are still loading, `activeBranch` is `""`; the `Select` is then a controlled component with a value matching no `SelectItem`. That's fine (shows the placeholder), but confirm switching works end-to-end and that the picked branch — not the default — wins after a manual choice.
- **Nothing to build if it already passes the check.** The logic in [dashboard-view.tsx](../../apps/web/src/components/dashboard/dashboard-view.tsx) (`pickedBranch ?? default ?? first ?? ""`) is correct; this subphase is a *checkpoint*, not new code. If you want a regression net, add the top-nav interaction test in 9.8.

---

### 9.6 — Finding detail slide-over: verify both open paths

- *Why:* it's the triage flow and Phase 10's E2E asserts it. Confirm **both** entry points still open the same Sheet with the same finding:
  1. **Refactor-list row click** → `onSelect(finding)` → `openFinding`.
  2. **Tree file click** → `onSelectNode(node)` → looks up `findings.find(f => f.file === node.path)` → `openFinding` if matched.
- Confirm closing (overlay click / Esc) flips `detailOpen` back to `false` and that re-opening a *different* row swaps the content. No new code expected — this is a verify pass.

---

### 9.7 — (Optional companion) wire the mocked "Sign in with GitHub"

- *Why include it here:* it's a genuine interaction, its mock handler already exists (`POST /api/auth/github` in [handlers.ts](../../apps/web/src/lib/mocks/handlers.ts)), and **Phase 10's happy-path E2E starts by clicking this button** — today it does nothing, so that test can't pass. Wiring it now keeps the guide internally consistent. (Real OAuth is still a Phase 12 swap; this is the mock stand-in the plan §2.1 describes.)
- Make the login page a client component that POSTs the mock auth, then routes to Projects:
  ```tsx
  "use client"
  import { useRouter } from "next/navigation"
  import { Button } from "@/components/ui/button"
  import { signInWithGitHub } from "@/lib/api/client"

  export default function LoginPage() {
    const router = useRouter()
    const onSignIn = async () => {
      await signInWithGitHub() // mocked OAuth: sets the fake session, returns the repo list
      router.push("/projects")
    }
    // …render the existing card, but: <Button size="lg" className="w-full" onClick={onSignIn}>
  }
  ```
  Add the one client function next to the others in [client.ts](../../apps/web/src/lib/api/client.ts) so the network surface stays in one file:
  ```ts
  export function signInWithGitHub(): Promise<{ user: string; repos: Repo[] }> {
    return fetch(`${API_BASE}/api/auth/github`, { method: "POST" }).then(
      json<{ user: string; repos: Repo[] }>,
    )
  }
  ```
- *Scope honesty:* v1 doesn't guard routes or persist a session — clicking simply advances to `/projects`. That matches the plan (auth is mocked; the redirect to `/login` when signed-out is a Phase 12 concern). If you'd rather keep login untouched until Phase 12, **skip this subphase and instead have the Phase 10 E2E navigate straight to `/projects`** — just don't leave a dead button *and* an E2E that clicks it.

---

### 9.8 — Tests for the new behaviour

- *Why:* 9.4–9.6 are already covered or trivial, but the **scan machine is new and timing-dependent** — exactly the kind of logic that breaks silently. Add one focused hook test; the presentational `scan-control.test.tsx` (idle→Scan, running→Stop) already covers the view.
- `src/hooks/use-scan.test.ts` — drive the real MSW scan machine with **fake timers** so the polling interval is deterministic:
  ```ts
  import { act, renderHook } from "@testing-library/react"
  import { afterEach, beforeEach, expect, test, vi } from "vitest"
  import { useScan } from "./use-scan"

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test("start → polls until done, then calls onComplete once", async () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useScan("demo-repo", onComplete))

    await act(async () => { await result.current.scan("main") })
    expect(result.current.status.phase).toBe("running")

    // 6 polls × 17% crosses 100%; advance a couple extra to be safe.
    await act(async () => { await vi.advanceTimersByTimeAsync(600 * 8) })

    // Assert directly — do NOT waitFor while timers are faked (gotcha 3).
    expect(result.current.status.phase).toBe("done")
    expect(result.current.status.progress).toBe(100)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  test("stop cancels a running scan and returns to idle", async () => {
    const { result } = renderHook(() => useScan("demo-repo"))
    await act(async () => { await result.current.scan("main") })
    await act(async () => { await result.current.stop() })
    expect(result.current.status.phase).toBe("idle")
    expect(result.current.status.progress).toBe(0)
  })
  ```
- ⚠️ **Three gotchas:** (1) the MSW **Node server** and `resetMockBackend()` already run in `src/test/setup.ts` (Phase 8.6) — the scan Map is cleared between tests, so start each test from `idle` for free. (2) mixing fake timers with `await`ed fetches needs the **async** timer advance (`advanceTimersByTimeAsync`, not `advanceTimersByTime`) or the poll's promise never settles. (3) **don't `waitFor` while timers are faked** — `waitFor` polls on *real* timers, which never advance, so it hangs until it times out; after `advanceTimersByTimeAsync` the polling has already settled, so assert **directly** (this is why the sketch drops the `waitFor` import).

---

**✅ Test / verify — the whole phase, by hand then by gate:**
- `pnpm dev`, open a dashboard, and:
  - Click **Scan** → the button becomes **"Scanning… 17% / 34% / …"** with a live `progress` bar → at 100% a **"Scan complete"** toast fires and it returns to **Scan**.
  - Start a scan, click **Stop** mid-way → it snaps back to **Scan** at 0% and a **"Scan stopped"** toast fires; the percentage does **not** keep climbing (the race in 9.2 is handled).
  - Switch the **branch** dropdown → the health numbers, grade, and SHA change.
  - Click a **Refactor-list row** *and* a **file in the tree** → the detail Sheet slides in with that finding.
  - Hover tree nodes → nothing visible yet (correct — Card B stays repo-scoped in v1).
  - (If 9.7 done) `/login` → **Sign in with GitHub** → lands on `/projects`.
- Then run all four gates:
  ```powershell
  pnpm test:run              # component + hook tests (incl. use-scan)
  pnpm exec tsc --noEmit     # types
  pnpm exec eslint src --max-warnings 0   # lint (the set-state-in-effect rule bites here)
  pnpm build                 # renders every route
  ```

**💾 Commit:** commit per interaction so each is revertible on its own, e.g.
```powershell
git commit -m "feat(web): mount sonner Toaster"
git commit -m "feat(web): scan control state machine (start/progress/stop)"
git commit -m "test(web): useScan hook"
git commit -m "feat(web): wire mocked GitHub sign-in"   # if 9.7 done
```

> ### Status: ✅ Phase 9 complete & verified
> All four interactions now move on the (mock) network: the **scan state machine** (start → poll +17%/tick → done/stop, with `sonner` toasts), **branch re-scoping**, the **tree-hover → Card B** wire (a no-op in v1 by design), and the **finding-detail** slide-over — plus the companion **mocked GitHub sign-in**, so the whole journey (`/login → projects → dashboard → scan/branch/finding`) runs end-to-end with no backend. Gates green: `tsc` 0 · `eslint --max-warnings 0` 0 · `build` 8 routes · **25 tests / 11 files** (the +2 over Phase 8 are `use-scan.test.ts`).
>
> **What shipped beyond the sketch (all deliberate):**
> - **9.2 hook** — the timer ref is typed `useRef<ReturnType<typeof setInterval> | undefined>(undefined)` (the bare `<…>(undefined)` form doesn't type-check) and the cleanup is the explicit `useEffect(() => () => clearTimer(), [clearTimer])`.
> - **9.3 wiring** — clearer local names: `const { status: scanStatus, scan: runScan, stop: stopScan } = useScan(repoId)`, which avoids the `scan={{ …scan… }}` self-shadow.
> - **9.3 refetch nonce — NOT wired (correctly).** The mock report is deterministic, so a refetch shows identical numbers and only flashes the skeleton; the seam is left for the real backend, and `useScan`'s `onComplete` param waits unused for it.
> - **9.7 login** — shipped with a `pending` guard (button disables + "Signing in…") and a `try/catch` that raises an **error toast** via the 9.1 Toaster, rather than a bare click→push. `signInWithGitHub()` lives in `lib/api/client.ts`.
> - **9.8 test** — drops `waitFor` (it polls on real timers → hangs while faked) and asserts **directly** after `advanceTimersByTimeAsync(600 * 8)`.
>
> **Still mocked (by design):** sign-in is fake — no OAuth handshake, no session, no route guard; opening `/projects` while "signed out" still works. Real auth is Phase 12.

---

## Phase 10 — End-to-end tests (Playwright)

**Goal:** prove the real user journeys work in a real browser — all against the mock backend.
**Why this phase:** component tests check pieces; E2E checks the *whole flow* a user (and your evaluators) will actually do. This is where "test without a backend" fully pays off.

> **One focused phase — no subphases.** It's just Playwright specs in `e2e/`. Two caveats fixed here: (1) the *planning-era* sketch was written before the UI shipped, so its selectors are corrected to match what's real — projects are **"Select" buttons**, not links, and the finding assertion is **scoped to the panel** to avoid a strict-mode clash; (2) E2E only works if the dev server runs with **mocking on** — handled first.

### Prerequisite — guarantee the E2E has mock data

- *Why:* every spec drives the real app, which fetches `/api/…`. With no backend, those resolve only if **MSW is on** (`NEXT_PUBLIC_API_MOCKING=enabled`). That flag lives in `.env.local`, which is **gitignored** — present on your machine but **missing on CI / a fresh clone**, where the suite would then fail at sign-in.
- Harden `playwright.config.ts` so the server it starts always carries the flag:
  ```ts
  import { defineConfig } from "@playwright/test"

  export default defineConfig({
    testDir: "./e2e",
    use: { baseURL: "http://localhost:3000" },
    webServer: {
      command: "pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      env: { NEXT_PUBLIC_API_MOCKING: "enabled" }, // E2E always gets mock data
    },
  })
  ```
- ⚠️ **`reuseExistingServer: true` caveat:** if a `pnpm dev` is **already running**, Playwright reuses it and the `env` above is **not** applied — locally you still rely on your own `.env.local`. The override is what saves CI, where Playwright starts the server itself. (A committed `.env.example` is the complementary fix — Phase 11.)
- Browsers were installed in Phase 2.4 (`pnpm exec playwright install`); re-run it if `pnpm test:e2e` reports a missing browser.

### Journey 1 — the happy path (keep this one green forever)

- *Why:* your smoke alarm — sign-in → project → dashboard → finding is the core demo. If it breaks, something important broke.
- Create `e2e/dashboard.spec.ts`:
  ```ts
  import { test, expect } from "@playwright/test"

  test("sign in, open a project, view its dashboard, open a finding", async ({ page }) => {
    await page.goto("/login")
    await page.getByRole("button", { name: /sign in with github/i }).click()

    // Projects render as cards with a "Select" button (not links); scope to the repo.
    await page
      .getByRole("listitem")
      .filter({ hasText: "acme-payments" })
      .getByRole("button", { name: /select/i })
      .click()

    await expect(page).toHaveURL(/\/dashboard\/demo-repo/)
    await expect(page.getByText("Code Health")).toBeVisible()

    // Open the critical finding. Scope the assertion to the panel — the reason
    // text is ALSO in the list row, so an unscoped getByText matches 2 nodes and
    // trips Playwright's strict mode.
    await page.getByRole("row").filter({ hasText: "hardcoded" }).click()
    await expect(
      page.getByRole("dialog").getByText(/hardcoded stripe api key/i),
    ).toBeVisible()
  })
  ```

### Journey 2 — run and stop a scan

- *Why:* the headline interaction from Phase 9. Navigate straight to the dashboard (no route guard in v1), keeping this spec independent of login.
- Create `e2e/scan.spec.ts`:
  ```ts
  import { test, expect } from "@playwright/test"

  test("run and stop a scan", async ({ page }) => {
    await page.goto("/dashboard/demo-repo")
    await expect(page.getByText("Code Health")).toBeVisible()

    await page.getByRole("button", { name: /^scan$/i }).click()
    await expect(page.getByText(/scanning/i)).toBeVisible() // idle → running(%)

    await page.getByRole("button", { name: /stop/i }).click()
    await expect(page.getByRole("button", { name: /^scan$/i })).toBeVisible() // back to idle
  })
  ```
- ⚠️ **Timing:** the mock scan finishes on its own in ~4s (6 polls × 600ms). Playwright acts in milliseconds, so clicking **Stop** right after "Scanning…" appears is safely inside that window. The anchored `/^scan$/i` stops the Scan button being confused with the "Scanning…" label.

### Journey 3 — switch branch, numbers change

- *Why:* proves the re-scoping wire (Phase 9.5) end-to-end in the browser.
- Create `e2e/branch.spec.ts`:
  ```ts
  import { test, expect } from "@playwright/test"

  test("switching branch re-scopes the health score", async ({ page }) => {
    await page.goto("/dashboard/demo-repo")
    await expect(page.getByText("72/100")).toBeVisible() // main

    await page.getByRole("combobox", { name: /branch/i }).click()
    await page.getByRole("option", { name: "develop" }).click()

    await expect(page.getByText("66/100")).toBeVisible() // develop = main − 6
  })
  ```
- The dashboard briefly shows a skeleton while the report refetches for the new branch; `toBeVisible()` auto-waits, so no explicit wait is needed.

> *Plan correction:* the old "add more: …**accept a finding**" idea is **dropped** — v1 findings are read-only (accept/resolve is v1.1). The three journeys above are the v1 E2E set.

**✅ Test / verify:** `pnpm test:e2e` → all three specs pass (Playwright auto-starts the dev server). Use the **Playwright Test for VSCode** extension to watch them, or `pnpm exec playwright test --ui` for the time-travel debugger.

**💾 Commit:** `git add -A` then `git commit -m "test(web): Playwright E2E — happy path, scan, branch"`

> ### Status: ✅ Phase 10 complete & verified
> Three Playwright specs in `e2e/` — `dashboard.spec.ts` (happy path: sign in → Select `acme-payments` → dashboard → open the hardcoded-secret finding), `scan.spec.ts` (Scan → "Scanning…" → Stop → idle), and `branch.spec.ts` (main 72/100 → develop 66/100). `pnpm test:e2e` → **3 passed** (chromium, ~8s; Playwright auto-starts the dev server). All the corrected selectors held on the first run.
>
> **What shipped beyond the sketch (all deliberate):**
> - **Vitest exclude (the load-bearing one)** — `vitest.config.ts` now sets `exclude: [...configDefaults.exclude, "e2e/**"]`. Without it, Vitest's default `include` also matches `*.spec.ts`, so `pnpm test:run` would try to run the Playwright specs (which `import "@playwright/test"`) and crash. Verified: `test:run` stays **25 tests / 11 files**.
> - **Config style** — `vitest.config.ts` / `playwright.config.ts` were rewritten semicolon-free to satisfy the repo's `.prettierrc` (`semi: false`); the scaffolder had left them with semicolons.
> - **Scan-spec robustness** — matches `/scanning/i` (no trailing-ellipsis char to get wrong) and the anchored `/^scan$/i` so the idle Scan button is never confused with the "Scanning…" label.
> - Gates green alongside E2E: `tsc` 0 · `eslint src e2e --max-warnings 0` 0 · `prettier --check` clean **on the files this phase touched** · `build` 8 routes. *(Repo-wide, 44 older files from Phases 6–7 still use semicolons and fail `prettier --check src` — the one-shot sweep is **Phase 11.1a**.)*

---

## Phase 10.5 — CR-001 migration (contract · chips · sliders · in-place detail)

**Goal:** land the seven decisions in **[CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md)** in the prototype, so that Phase 11 polishes the *final* screens rather than screens that are about to change.
**Why this phase exists, and why here:** the decisions were taken on 30 Jul 2026, after Phase 10 shipped. Two of them (the `Source` enum, the profile weight vector) change the **contract**, and one (in-place finding detail) changes the **dashboard layout**. Doing this before Phase 11 is deliberate: polishing a slide-over you are about to delete is wasted work, and the contract change is 4 lines now versus a data migration later. Phases 0–10 are complete and are **not** revisited — everything below is additive or a contained replacement.

**Read first:** CR-001 in full. Every "why" below is one sentence from it.

### 10.5.1 — The contract (do this first; everything else follows from it)

In `src/lib/types/index.ts`:

```ts
// was: "rule" | "satd" | "security" | "ml-risk"
export type Source = "rule" | "satd"
```

*Why:* `security` duplicated `category` exactly (security patterns run inside the rule engine, so such a finding was always both), and `ml-risk` was unreachable — the risk model writes `FileScore.riskScore`, never a `Finding`. **SRS FR-8.2.**

```ts
export interface ScoreProfile {
  id: string
  name: string
  weights: {              // keyed by CATEGORY — matches the scoring formula
    security: number
    codeDesign: number
    requirement: number   // new
    documentation: number // new
    test: number          // new
  }                       // `satd` and `duplication` removed — wrong axis
  trust: number           // `s` ∈ 0–1, default 0.5. Replaces `wMl`
  isPreset: boolean
}
```

*Why:* the old vector mixed axes — `satd` is a *source*, `duplication` is a *rule* — and omitted three real categories, so a `documentation` SATD finding had no weight. That was invisible while profiles were presets; it becomes a slider the user drags with no effect. **SRS FR-20.**

### 10.5.2 — Fixtures and tests that reference the old enum

| File | Change |
|---|---|
| `src/lib/mocks/fixtures.ts` | the finding with `source: "security"` → `source: "rule"` (its `category` is already `"security"`, which is now the only thing that marks it) |
| `src/lib/mocks/fixtures.ts` | re-key the three `mockProfiles` to the **six** category weights + `trust` (values in CR-001 D-CR6, updated by D-CR12) |
| `src/components/dashboard/refactor-first-list.test.tsx` | two fixture rows use `source: "security"` |

`pnpm tsc` will find every remaining site for you — that is the contract doing its job.

### 10.5.3 — Chips on the finding row

- Row renders **category chip + severity chip**, and a **`SATD` chip only when `source === "satd"`**.
- Rule rows get **no** source chip — `rule` is the default, and a chip on every row carries no information.
- The severity chip renders the **stored** `finding.severity` through the existing colour token; the client makes no severity judgement of its own.

*Why not put "SATD" in the severity chip:* severity is an ordinal scale (`critical > high > medium > low`). "SATD" is not comparable to any of those, so it breaks sorting and leaves `base_points` undefined. **SRS FR-15.**

### 10.5.4 — Profiles page: presets + six sliders + Apply

- Three **preset buttons** (Balanced / Security-first / Delivery-speed) that **seed** the sliders, plus **Reset to preset**.
- **Six category sliders** clamped `0.1–3.0` — `security`, `code-design`, `defect`, `requirement`, `documentation`, `test` — and one **trust slider** `s` (`0–1`, default `0.5`) labelled at its ends — *"trust the rules" ←→ "trust the model"*. *(Six, not five: `defect` was added by CR-001 **D-CR12**.)*
- Applying re-scores from stored findings; **never** triggers a scan.

**Dragging sends nothing — an explicit Apply does the write.** The sliders are local `useState`; the page is *dirty* until Apply, which fires one mutation and then invalidates the health query:

```ts
// lib/api/client.ts — the one new endpoint (SRS FR-20, SAD §6.2)
export function setActiveProfile(p: ProfileInput): Promise<ScoreProfile> {
  return fetch(`${API_BASE}/api/profiles/active`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),            // the whole profile, not a delta
  }).then(json<ScoreProfile>)
}
```

```ts
// the page: write, then re-read
const apply = useMutation({
  mutationFn: setActiveProfile,
  onSuccess: (saved) => {
    setDraft(saved)                                       // trust the server's clamp
    qc.invalidateQueries({ queryKey: ["health"] })        // ← this is what re-scores the UI
  },
})
```

Three things to get right:

- **`PUT`, whole body, no delta.** Re-sending the same profile is a no-op, so a retry after a dropped response can't half-apply. The client fires a dependent read straight after — that read must not race a partially-written profile.
- **The health request does not change.** `GET /api/repos/:id/health?branch=…` carries **no** profile parameter; the backend resolves the active profile itself (the workspace's `SCORING_PROFILE` row with `is_active = true`). If you find yourself adding `?profile=` to a read, stop — that is the design the SAD §6.2 rejected.
- **Seed the draft from `setDraft(saved)`, not from your own state.** The server clamps; rendering your pre-clamp value would show the user a number that isn't stored.

Add the MSW handler alongside the existing `*/api/profiles` read:

```ts
http.put("*/api/profiles/active", async ({ request }) => {
  const body = await request.json()
  return HttpResponse.json(setMockActiveProfile(body))   // clamps + keeps it in the in-memory backend
}),
```

Keep it in the same in-memory state as the scan machine so `resetMockBackend()` clears it between tests.

*Why keep presets:* something must be the default for a new workspace, one click is what demonstrates *"same findings, different lens, no rescan"*, and six naked sliders is the SonarQube experience this product differentiates against (U-1, U-2).

*Why an explicit Apply rather than auto-save on drag:* one drag crosses dozens of values — auto-saving writes and re-derives for each — and there would be no way to abandon an experiment. The dirty→applied transition is also what makes "same findings, different lens" *visible* rather than merely true. Label the button **Apply**, not Save: "Save" reads as "and now go do the work", which is exactly what this does not do.

### 10.5.5 — In-place finding detail (the layout change)

Replace the slide-over with **detail mode** inside `DashboardView`:

| Region | Dashboard mode | Detail mode |
|---|---|---|
| Main | Overall Health card + trend chart | **Finding detail** (reuse the existing `FindingDetailPanel` component — only its container changes) |
| Right | File tree | File tree, **auto-expanded + highlighting the finding's file** |
| Bottom | list in full position | **Refactor-First list, condensed** — swap between findings without closing |

Also:

- Put the selected finding in the URL (`?finding=<fingerprint>`) so reload and the back button behave.
- The tree must **expand ancestors and scroll the file into view**, not just tint it.
- Keep it **view-only** — no Accept / Resolve / False-positive (those stay [v1.1]), and no snippet yet (build the region, fill it in v1.1).

*Why now rather than later:* the backend does not exist yet and the test suite is small, so this is the cheapest moment this change will ever have. `DashboardView` already owns `selectedFinding` / `detailOpen` and the panel is already a tested standalone component.

### 10.5.6 — Tests to update

- `refactor-first-list.test.tsx` — the two `source` fixtures, plus a new case asserting the SATD chip appears **only** for SATD rows.
- `finding-detail-panel.test.tsx` — still valid (the component is unchanged); add a container test for entering/leaving detail mode.
- `e2e/dashboard.spec.ts` — the detail assertion changes from "slide-over opens" to "health card is replaced by finding detail, and the tree highlights the file".
- New: a profiles E2E — pick a preset, drag a slider, press **Apply**, assert the list re-orders **and no scan is triggered** (route-assert that `**/api/repos/*/scan` is never hit, and that exactly one `PUT **/api/profiles/active` fired).
- New: a profiles unit test — dragging alone issues **no** request; Apply issues one; an out-of-range value returned by the server overwrites the local draft.

### Done when

- [ ] `pnpm tsc` clean — no reference to `"security"`/`"ml-risk"` as a `Source`, none to `wMl`
- [ ] A SATD row shows three chips; a rule row shows two
- [ ] Profiles page: preset click seeds six sliders; reset works; dragging fires no request; **Apply** fires one `PUT /api/profiles/active` and the dashboard re-scores instantly
- [ ] Selecting a finding swaps the region in place, highlights the file in the tree, and the list stays usable
- [ ] Reload with `?finding=…` restores detail mode
- [ ] All unit + E2E gates green

> ⚠️ **Backend note, not frontend work:** `k` must be recalibrated (CR-001 D-CR5) and the critical-security pin (FR-24) must be implemented server-side now that a user can drag the security weight to 0.1. Neither is in this phase — but neither should be forgotten.

---

## Phase 11 — Polish & Definition of Done

**Goal:** take the working v1.0 slice from *"it demos"* to *"it looks and feels like a product"* — **without adding a single feature**.

> **Scope note (30 Jul 2026):** Phase 11 now polishes **both** dashboard states — dashboard mode and the Phase 10.5 detail mode. When working through the checklists below, treat detail mode as a first-class view: it needs its own loading/empty/error handling, its own keyboard path (enter detail, move between findings, leave detail), and its own responsive behaviour at the 1280 px floor, where detail + tree + condensed list is the tightest layout in the product.
**Why this phase:** Phases 6–10 optimised for *movement* — get the screens up, get data flowing, get the interactions wired. That always leaves the same residue: placeholder copy, states nobody has hit yet, mouse-only interactions, and colours that carry meaning but can't actually be read. Every one of those is invisible to **you** (you know where to click) and glaring to an **evaluator** (they don't). Polish is where you buy that back, and it's the cheapest phase per unit of perceived quality: nothing here is hard, it's just never *urgent* — so it needs its own phase or it silently never happens.

**The Definition of Done for a view** (plan §13) is the yardstick for everything below:
1. Renders from **contract-shaped** data (not hardcoded JSX). ✅ *already true since Phase 8*
2. Handles **loading, empty, and error**. → **11.2**
3. **Component tests** for any logic. → **11.9**
4. **Responsive** to laptop width and **keyboard-navigable** with visible focus. → **11.6 / 11.7**
5. **Reviewed** by the other person. → **11.10**

---

### 11.0 — Read first: the fence, the gap, and the audit

#### The fence — what "polish" means here

| ✅ In scope (v1.0, already built) | ❌ Out of scope (say no on purpose) |
|---|---|
| Login · Projects · Dashboard (top nav, branch, scan, Card A, Card B, Refactor-First list, finding detail, heat-map tree) | New features, or any v1.1/v2 field (finding actions, per-node Card B, private repos) |
| **States** (loading / empty / error), **affordances** (can I tell it's clickable?), **legibility** (contrast, chart labels), **keyboard**, **responsive**, **copy** | Redesigns, a different component library, a "real" tree/virtualisation lib |
| Repo hygiene that affects a fresh clone or a screenshot | Animation for its own sake; anything that changes `@/lib/types` |

> **The test for "is this polish?"** If the change touches the **contract** (`src/lib/types`), it isn't polish — it's Phase 12+ work. If it changes what the user *can do*, it's a feature. If it changes how well they can *do what they already can*, it's polish.

#### The honest gap — two v1.0 features are still placeholder pages

The roadmap tags **Scan history** and **Scoring profiles** as **v1.0**, their mock endpoints already exist (`*/api/repos/:repoId/scans`, `*/api/profiles` in [handlers.ts](../../apps/web/src/lib/mocks/handlers.ts)), their fixtures exist (`mockScanHistory`, `mockProfiles`), and their API-client functions exist (`getScanHistory`, `getProfiles`) — but both pages are still a heading plus the word *"(Placeholder.)"*, reachable from the left rail. **A rail item that leads to the word "Placeholder" is worse than no rail item**, so this can't be ignored by a polish phase even though building them isn't polish.

Pick one, now, and write the choice here:

| Option | What it costs | When it's right |
|---|---|---|
| **A — Build them** (recommended) | ~2–3 h total: Scan History = a `Table` of `ScanSummary` + a "Load" button; Profiles = a radio/`Select` of `ScoreProfile` presets. Both are read-only over hooks you already know how to write (`useQuery` one-liners). | You want the v1.0 claim to be true, and the demo to survive a click on every rail item. |
| **B — Ship them as honest "Coming soon"** | ~15 min: a proper empty state (icon + one line + a disabled control), rail badge `soon`, same treatment as Team's `v2`. | The deadline is this week and the demo script never clicks them. |
| **C — Hide the rail items** | ~5 min, but the roadmap now over-claims v1.0. | Never, unless you also amend the roadmap. |

Everything from **11.1** onward assumes you've picked A or B. *(If A: build them first, then run them through 11.2–11.9 like every other view.)*

#### The audit — what's actually wrong today

Found by reading the shipped code, not by guessing. **★★★** = an evaluator will see it in the first 60 seconds · **★★** = noticeably unfinished · **★** = finish-line detail.

| # | Finding | Where | Fix in |
|---|---|---|---|
| A1 | Browser tab still reads **"Create Next App"** (title + description untouched) | [layout.tsx](../../apps/web/src/app/layout.tsx) ★★★ | 11.1 |
| A2 | **44 files fail `prettier --check`** — Phase 6/7 files use semicolons, `.prettierrc.json` says `semi: false` | `src/**` ★★ | 11.1 |
| A3 | No **`.env.example`** — a fresh clone has no `NEXT_PUBLIC_API_MOCKING`, so the app renders **no data at all** (known trap, flagged in Phase 8) | `apps/web/` ★★★ | 11.1 |
| A4 | Dashboard **loading skeleton doesn't match the layout** it replaces → content jumps on arrival | [dashboard-view.tsx](../../apps/web/src/components/dashboard/dashboard-view.tsx) ★★ | 11.2 |
| A5 | **Error states print raw HTTP** — an unknown repo shows *"Couldn't load this dashboard: 404 Not Found"*, and there's **no Retry** | dashboard-view · projects/page ★★★ | 11.2 |
| A6 | **No empty states** for: zero findings, zero branches, empty history, empty tree | dashboard components ★★ | 11.2 |
| A7 | **No `SidebarTrigger` anywhere** → below `md` the rail becomes a Sheet that **cannot be opened**, and there's no collapse affordance on desktop | [app-rail.tsx](../../apps/web/src/components/layout/app-rail.tsx) / [(app)/layout.tsx](<../../apps/web/src/app/(app)/layout.tsx>) ★★★ | 11.3 |
| A8 | Rail **hardcodes `/dashboard/demo-repo`** → "Dashboard" jumps to a *different* repo than the one you're viewing | app-rail.tsx ★★★ | 11.3 |
| A9 | **Account** footer button is a dead stub (looks pressable, does nothing) | app-rail.tsx ★★ | 11.3 |
| A10 | Top nav shows the **repo id** (`demo-repo`) while Projects showed **`acme/acme-payments`** — the app calls the same thing two names | [dashboard-topnav.tsx](../../apps/web/src/components/layout/dashboard-topnav.tsx) ★★★ | 11.4 |
| A11 | "Last analyzed **7/22/2026, 6:35:00 PM**" — an absolute machine timestamp where humans want *"2 hours ago"* | dashboard-topnav.tsx ★★ | 11.4 |
| A12 | **Refactor-First rows are mouse-only** — `<TableRow onClick>` with no `tabIndex`/key handler → the core triage flow is unreachable by keyboard | [refactor-first-list.tsx](../../apps/web/src/components/dashboard/refactor-first-list.tsx) ★★★ | 11.6 |
| A13 | The list **never says it's ranked** (no priority column, no count) — "Refactor **first**" is the product's whole thesis and the UI doesn't show the ordering | refactor-first-list.tsx ★★★ | 11.4 |
| A14 | Heat map is a **3px left border** — the "red→amber→green at a glance" feature is nearly invisible, has **no legend**, and shows **no score** | [file-tree.tsx](../../apps/web/src/components/dashboard/file-tree/file-tree.tsx) ★★★ | 11.4 |
| A15 | Clicking a tree file **with no finding does nothing, silently** | file-tree / dashboard-view ★★ | 11.4 |
| A16 | Pie slices are `--chart-1…5`, which in this theme are **five shades of grey** (`oklch(… 0 0)`, zero chroma) + one red — the category breakdown is unreadable, and it has **no legend** | [overall-health-card.tsx](../../apps/web/src/components/dashboard/overall-health-card.tsx) ★★★ | 11.5 |
| A17 | The **grade letter fails contrast**: `--health-good` on white = **2.30:1**, `--health-mid` = **2.13:1** (measured). The biggest number on the dashboard is unreadable for grades A/B/C | globals.css + overall-health-card ★★★ | 11.5 |
| A18 | **Severity badges fail contrast** in light mode: `high` **2.79:1**, `medium` **2.13:1** (need 4.5:1 for text) | globals.css + badges ★★★ | 11.5 |
| A19 | Severity/health tokens exist **only in `:root`** — `.dark` never redefines them, and **nothing ever adds the `.dark` class** (no `ThemeProvider`), so dark mode is dead code that would also be under-contrast if switched on | [globals.css](../../apps/web/src/app/globals.css) ★★ | 11.5 |
| A20 | **Delta is colourless** — `▲ +3` and `▼ -4` render in the same muted grey, so good and bad news look identical | overall-health-card.tsx ★★ | 11.4 |
| A21 | Card B: **area chart with a Recharts-default axis** and raw `2026-07-22` tick labels | [health-graph-card.tsx](../../apps/web/src/components/dashboard/health-graph-card.tsx) ★★ | 11.5 |
| A22 | Scan progress is **not announced** (no `aria-live`), and `queued` renders as *"Scanning… 0%"* | [scan-control.tsx](../../apps/web/src/components/layout/scan-control.tsx) ★ | 11.8 |
| A23 | **No per-route page titles** — every tab says the same thing | `src/app/**` ★ | 11.3 |
| A24 | **No responsive check has ever been run** below `lg`; the tree column has no max-height, the 4-column table squeezes | dashboard grid ★★ | 11.7 |

**How to work it:** top to bottom (11.1 unblocks the diffs, 11.2 is the biggest win), **one commit per sub-phase**, gates green before each commit. If you run out of time, everything ★★★ is the real floor — ★★/★ can slip to v1.1 without embarrassment.

---

### 11.1 — Repo hygiene first (≈30 min, and it makes every later diff readable)

- *Why first:* formatting 44 files **in the middle** of a polish PR turns a 12-line behaviour change into a 900-line diff nobody can review. Do it alone, first, as its own commit.

**a) Format the whole repo (A2).** One command, one commit, zero behaviour change:
```powershell
pnpm exec prettier --write src e2e *.ts *.mjs *.json
pnpm exec prettier --check src e2e   # must print "All matched files use Prettier code style!"
```
Then run `pnpm test:run` — formatting can't break tests, but prove it.

**b) Commit a `.env.example` (A3).** *Why:* `.env.local` is gitignored, so a teammate or examiner cloning the repo gets a silent, dataless app — the single most likely way your demo fails on someone else's machine.
```dotenv
# apps/web/.env.example — copy to .env.local (`cp .env.example .env.local`)
# Turns on the MSW mock backend. Phase 12 sets this to "disabled" and points at the real API.
NEXT_PUBLIC_API_MOCKING=enabled
# NEXT_PUBLIC_API_BASE_URL=          # empty in dev (same-origin); the real API URL at go-live
```
Add the two-line setup step to [apps/web/README.md](../../apps/web/README.md).

**c) Fix the metadata (A1).** *Why:* it's on every screenshot and every browser tab in your demo video.
```tsx
export const metadata: Metadata = {
  title: { default: "Code Sage AI", template: "%s · Code Sage AI" },
  description: "Find the technical debt worth fixing first.",
}
```
*(The `template` is what makes per-route titles in 11.3 read as "Dashboard · Code Sage AI".)*

**d) Add a one-command gate.** *Why:* you'll run it a dozen times this phase, and it becomes the PR checklist.
```json
"verify": "tsc --noEmit && eslint src e2e --max-warnings 0 && prettier --check src e2e && vitest run && next build"
```

**✅ Micro-check:** `pnpm verify` is green · a fresh `git clone` + `cp .env.example .env.local` + `pnpm i && pnpm dev` shows data.
**💾** `git commit -m "chore(web): format repo, .env.example, app metadata"`

---

### 11.2 — Loading, empty, error: the state trio (DoD #2) ← *the highest-value sub-phase*

- *Why this one matters most:* your app currently has exactly **one** path that looks designed — the happy one. Every other path is a grey box, a raw HTTP string, or nothing at all. Users hit those paths constantly (slow network, a repo with no findings, a typo'd URL), and an unhandled state is what makes a prototype *feel* like a prototype.

**The matrix — fill in every cell.** Current state as shipped:

| View | Loading | Empty | Error |
|---|---|---|---|
| Projects | ✅ 2 skeleton bars | ✅ copy exists in `ProjectList` | ⚠️ raw `error.message`, no retry |
| Dashboard | ⚠️ 3 blocks, wrong shape (A4) | ❌ none | ⚠️ raw `error.message`, no retry (A5) |
| Refactor-First list | n/a (parent) | ⚠️ "No findings for this filter." — same copy for *filtered-to-nothing* and *clean repo* | n/a |
| File tree | n/a (parent) | ❌ none | n/a |
| Card B (history) | n/a | ❌ none — an empty `history[]` renders an empty plot area | n/a |
| Branch `Select` | ⚠️ shows a blank trigger while branches load | ❌ none | ❌ silent |
| Scan History / Profiles | — | — | — *(depends on 11.0's A/B choice)* |

**a) Skeletons must be the *shape* of what's coming (A4).** *Why:* a skeleton's job is to reserve the layout so content doesn't jump when it lands. Three stacked bars replaced by a two-column grid is worse than no skeleton. Mirror the real grid:
```tsx
// dashboard-view.tsx — the loading branch
<div className="flex h-full flex-col">
  <Skeleton className="h-14 w-full rounded-none" />            {/* top nav */}
  <div className="grid flex-1 gap-4 p-4 lg:grid-cols-2">
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-40" /><Skeleton className="h-40" />   {/* Card A + Card B */}
      </div>
      <Skeleton className="h-64" />                             {/* the list */}
    </div>
    <Skeleton className="h-96" />                               {/* the tree */}
  </div>
</div>
```
Extract it as `dashboard-skeleton.tsx` so the shape lives next to the layout it mirrors and can't drift.

**b) Empty states say what to *do*, and distinguish "none" from "none matching".** *Why:* "No findings" after filtering is a dead end; "No findings" on a clean repo is a **win** and should look like one. Copy to use:

| Situation | Copy | Treatment |
|---|---|---|
| Repo has **zero findings** | **"Nothing to refactor first."** · "This snapshot found no debt above the profile's thresholds." | success tone — a check icon, not a sad grey box |
| **Filter** matches nothing | "No `<category>` findings in this scan." + a **Clear filter** button | keep the filter visible; give the way out |
| No branches yet | "No branches found for this repository." | disable the `Select`, don't render an empty popover |
| Empty `history[]` | "Trend appears after your second scan." | inside Card B, in place of the plot |
| Empty `tree[]` | "No files analysed in this snapshot." | inside the tree panel |
| No projects | ✅ already good — but upgrade from bare text to a bordered empty card with the **Connect** field focused |

**c) Errors: human copy + a Retry that actually refetches (A5).** *Why:* `404 Not Found` is a status line, not a message — and an error state with no way out forces a full page reload. Two edits:

*First*, teach `useQuery` to retry. Keep the React-19 rule intact (**state is only ever set in a callback, never in the effect body** — Phase 8's `set-state-in-effect` lesson): add an attempt counter and fold it into the settle token so a retry correctly re-enters `loading`:
```ts
// hooks/use-query.ts
const [attempt, setAttempt] = useState(0)
const token = `${key}#${attempt}`                 // the settle token, not just the key

useEffect(() => {
  let alive = true
  fetcher()
    .then((data) => { if (alive) setResult({ key: token, data }) })
    .catch((error: unknown) => { if (alive) setResult({ key: token, error: error instanceof Error ? error : new Error(String(error)) }) })
  return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [token])

const settled = result?.key === token
const refetch = useCallback(() => setAttempt((n) => n + 1), [])
return { data: settled ? result?.data : undefined, error: settled ? result?.error : undefined, loading: !settled, refetch }
```
⚠️ **Why the token, not the key:** retrying with the *same* key would leave `settled === true`, so the old error would stay on screen and `loading` would never flip. The attempt counter is what makes a retry a *new* request in the hook's eyes.

*Second*, one shared error component so every view fails the same way:
```tsx
// components/ui/error-state.tsx — title + human message + Retry
<ErrorState
  title="Couldn’t load this dashboard"
  message={humanError(error)}          // 404 → "We couldn’t find that repository."
  onRetry={refetch}
/>
```
Map the statuses you can actually produce (`404` → not found · `5xx` → "The analysis service isn't responding." · network → "You appear to be offline.") and keep `error.message` only in a `<details>` or a `console.error`, never as the headline.

**✅ Micro-check:** in DevTools set the network to *Offline* and reload `/projects` → error card + **Retry**; go back Online, click Retry → data. Visit `/dashboard/nope` → "We couldn't find that repository," not `404 Not Found`.
**💾** `git commit -m "polish(web): loading/empty/error states + retry"`

---

### 11.3 — The shell: make navigation trustworthy

**a) Mount a `SidebarTrigger` (A7) — this is a functional bug, not a nicety.** *Why:* `SidebarProvider` swaps the rail for a `Sheet` under `md`, and a Sheet only opens from a trigger. Today there is none anywhere in `src/`, so **on a narrow window the app has no navigation at all**. Put one in the top-left of each screen's header (dashboard top nav + a shared page header for Projects/History/Profiles):
```tsx
<SidebarTrigger className="-ml-1" />
<Separator orientation="vertical" className="mr-2 h-4" />
```
*(`Ctrl/⌘+B` already works from `SidebarProvider` — a keyboard shortcut nobody can discover is not an affordance.)*

**b) Point the rail at the repo you're actually looking at (A8).** *Why:* clicking "Dashboard" while viewing `web-store` currently teleports you to `demo-repo` — the app contradicting itself. Derive the id from the URL, fall back to the last one you opened:
```tsx
// app-rail.tsx — usePathname() is already there
const match = /^\/dashboard\/([^/]+)/.exec(pathname)
const repoId = match?.[1] ?? lastRepoId ?? null       // lastRepoId: localStorage, written by Projects → Select
```
Then: when `repoId` is `null`, render **Dashboard** and **Scan History** as *disabled* items with the tooltip *"Select a project first"* — an honest disabled state beats a link to a fake repo. (Persisting `lastRepoId` is ~6 lines: write it in the Projects `onSelect`, read it in a tiny `useLastRepo()` hook. Guard `localStorage` behind `typeof window !== "undefined"`.)

**c) Kill or wire the Account stub (A9).** *Why:* a control that looks pressable and does nothing teaches users not to trust the other controls. Cheapest honest version — `pnpm dlx shadcn@latest add dropdown-menu`, then a menu with the (mock) user name, a disabled "Settings (v1.1)", and a **Sign out** that clears `lastRepoId` and routes to `/login`. Sign-out is genuinely v1.0-appropriate: it's the mirror of the mocked sign-in you already shipped in 9.7.

**d) Per-route titles (A23).** *Why:* browser tabs, history, and bookmarks all read the title; with the 11.1 `template` each page needs one line. Server pages get `export const metadata = { title: "Projects" }`. The two **client** pages (`projects`, and any client dashboard shell) can't export metadata — either move the `"use client"` boundary down into a child component (preferred) or leave the default title for those routes and note it.

**✅ Micro-check:** resize to 700px wide → the trigger appears, opens the rail, links work · open `/dashboard/web-store` → the rail's Dashboard item stays on `web-store` · open `/projects` in a fresh profile → Dashboard/History are disabled with a tooltip.
**💾** `git commit -m "polish(web): sidebar trigger, context-aware rail, account menu"`

---

### 11.4 — The dashboard: the screen your demo lives on

- *Why the biggest section:* this is the screen in your slides, your report, and your viva. Everything here is small; together it's the difference between "student project" and "product".

**a) One name for the repo (A10).** *Why:* Projects says `acme/acme-payments`, the dashboard says `demo-repo`. Same object, two identities — it reads as a bug even when it isn't. Add a two-line hook and pass the real name:
```ts
// hooks/use-repo.ts — Phase 12 swaps this for GET /api/repos/:id
export function useRepo(repoId: string) {
  const { data, loading, error } = useProjects()
  return { data: data?.find((r) => r.id === repoId), loading, error }
}
```
Then `repoName={repo ? `${repo.owner}/${repo.name}` : repoId}`, with the repo's GitHub `url` as an external link icon beside it. Keep `repoId` as the fallback so an unknown id still renders.

**b) Time humans can read (A11).** *Why:* "3 hours ago" answers *is this fresh?* at a glance; the exact timestamp is the follow-up question, so it belongs in a tooltip.
```ts
// lib/utils.ts — pass an explicit locale so tests and SSR are deterministic
export function relativeTime(iso: string, now = Date.now()) {
  const mins = Math.round((new Date(iso).getTime() - now) / 60_000)
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  if (Math.abs(mins) < 60) return rtf.format(mins, "minute")
  const hours = Math.round(mins / 60)
  return Math.abs(hours) < 24 ? rtf.format(hours, "hour") : rtf.format(Math.round(hours / 24), "day")
}
```
Render `<time dateTime={scannedAt} title={new Date(scannedAt).toLocaleString()}>Last analyzed {relativeTime(scannedAt)}</time>`, and make the short SHA a link to the commit (`repo.url + "/commit/" + sha`) with a copy-on-click.
⚠️ Locale-dependent formatting is a classic hydration mismatch; this is safe **only because** the top nav renders after a client-side fetch. Keep it that way, or pin the locale as above.

**c) Make the top nav sticky** (`sticky top-0 z-10 bg-background/95 backdrop-blur`). *Why:* the branch selector, Scan button and freshness stamp are the controls people reach for *after* scrolling the findings list.

**d) Card A — the delta must have a direction (A20).** *Why:* +3 and −4 are opposite news rendered identically. Colour it with the health tokens (which 11.5 fixes for contrast) and swap the text glyphs for `TrendingUp`/`TrendingDown` icons:
```tsx
const up = delta >= 0
<p className="mt-1 flex items-center gap-1 text-sm" style={{ color: up ? healthColor(100) : healthColor(0) }}>
  {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
  {up ? `+${delta}` : delta} <span className="text-muted-foreground">vs. previous scan</span>
</p>
```
Also: give the score a hierarchy — the **grade** is the headline (already `text-4xl`), `72/100` is support, and the "2 red issues" description should be **clickable**, filtering the list to critical+high. That one interaction turns a static number into a triage entry point and costs ~5 lines (lift the list's `category` filter into `dashboard-view`, or add a `severityFilter` prop).

**e) The Refactor-First list must show that it's *ranked* (A13).** *Why:* "fix these first, in this order" is the entire product thesis, and the UI currently presents an unordered-looking table. Cheap, high-signal changes:
- Heading → **"Refactor first"** + a count badge (`6`), and a subtitle: *"Ranked by severity × risk — start at the top."*
- Add a leading **`#`** column (1, 2, 3…) — the rank is the point.
- Add `title={f.reason}` to the truncated Reason cell so the full text is reachable on hover (the tooltip is the relief for truncation).
- Show `f.source` (`rule` / `satd` / `security`) as a small muted chip — it's already in the contract and it's how you prove three detectors are live.
- Cap the list (`slice(0, 10)`) with a **"Show all N"** toggle. *Why:* an infinite table buries the ranking; ten is a to-do list.
- Keyboard access for rows is **11.6 (A12)** — do it there, it's an a11y fix, not a cosmetic one.

**f) The heat-map tree has to actually look like a heat map (A14).** *Why:* a 3px left border is the entire visual payload of a headline feature. Three changes, in order of value:
1. **Tint the row**, don't just edge it. Extend the helper to return a translucent step, keeping the 1-arg form byte-identical so the Phase 7 utils test stays green:
   ```ts
   export function healthColor(score: number, alpha?: number) {
     const v = score < 40 ? "--health-bad" : score < 70 ? "--health-mid" : "--health-good"
     return alpha === undefined ? `hsl(var(${v}))` : `hsl(var(${v}) / ${alpha})`
   }
   ```
   Then `style={{ background: healthColor(node.healthScore, 0.12), borderLeft: `3px solid ${colorFor(node)}` }}`.
2. **Show the number.** A right-aligned `tabular-nums` score (and the risk badge for files over the threshold) — *why:* colour alone is not an encoding a colour-blind reader can use, and it's also just faster to compare 41 vs 39 than two ambers.
3. **Add a legend** above the tree: `● <40 critical · ● 40–69 needs work · ● 70+ healthy`. *Why:* a heat map without a scale is decoration. Put the same three bands in a `Tooltip` on each row with `debtScore` / `riskScore`.

**g) Clicking a file with no finding must say so (A15).** *Why:* silence reads as "broken". Either `toast("No findings in this file — it's clean.")`, or open the panel in a "file summary" mode showing the node's `healthScore`/`debtScore` (better: it makes every tree row clickable-and-useful). Pick one; don't leave the silent branch.

**h) Finding panel — the last mile.** Add a **Copy path** button (`file:line` — the thing a developer actually wants to paste into their editor), the parent file's health context, and `SheetTitle`/`SheetDescription` that are real sentences. Verify focus returns to the triggering row on close (Radix does this automatically **only** if the trigger is a focusable element — which is exactly what A12 fixes).

**✅ Micro-check:** the dashboard reads top-to-bottom as *how bad · trending which way · fix this first · where it lives* — and a stranger can name the worst file in 10 seconds.
**💾** `git commit -m "polish(web): dashboard hierarchy, ranked list, heat-map legibility"`

---

### 11.5 — Colour that carries meaning (DoD: readable contrast)

- *Why its own sub-phase:* in this app colour **is data** — severity, grade, and the heat map all encode meaning in hue. Measured against the shipped tokens, three of those encodings are currently unreadable, and the fourth is grey. These are numbers, not opinions: check them, don't eyeball them.

**a) The measurements (A17, A18)** — current tokens as text on the white card (WCAG AA needs **4.5:1** for text, **3:1** for large text and graphic objects):

| Token | Hex | On white | Verdict |
|---|---|---|---|
| `--severity-critical` / `--health-bad` | `#dc2828` | **4.80** | ✅ |
| `--severity-high` | `#f97415` | **2.79** | ❌ badge text unreadable |
| `--severity-medium` / `--health-mid` | `#f59f0a` | **2.13** | ❌ fails even the 3:1 graphics floor |
| `--severity-low` | `#65758b` | **4.70** | ✅ |
| `--health-good` | `#21c45d` | **2.30** | ❌ — and this is the **grade letter for A and B**, the largest element on the dashboard |

**b) The fix: per-mode steps, same token names.** *Why this shape:* `severityColor()` / `healthColor()` build `hsl(var(--token))` strings, so if you keep the `H S% L%` triplet convention **no TypeScript changes at all** — only `globals.css`. Verified values (all ≥4.5:1 in their own mode):

```css
:root {                            /* light — darker steps so text passes */
  --severity-critical: 0 74% 42%;  /* 6.4:1 */
  --severity-high:     21 90% 35%; /* 6.1:1 */
  --severity-medium:   26 90% 33%; /* 6.0:1 */
  --severity-low:      215 19% 35%;/* 7.5:1 */
  --health-bad:  0 74% 42%;        /* 6.4:1 */
  --health-mid:  26 90% 33%;       /* 6.0:1 */
  --health-good: 142 72% 29%;      /* 5.1:1 */
}
.dark {                            /* dark — the current bright steps are right HERE */
  --severity-critical: 0 91% 71%;  /* 6.5:1 on #171717 */
  --severity-high:     27 96% 61%; /* 7.9:1 */
  --severity-medium:   43 96% 56%; /* 10.6:1 */
  --severity-low:      215 20% 65%;/* 7.0:1 */
  --health-bad:  0 91% 71%;
  --health-mid:  43 96% 56%;
  --health-good: 142 69% 58%;      /* 10.3:1 */
}
```
⚠️ **Residual to accept knowingly:** in light mode `high` and `medium` sit close in hue/lightness. That is tolerable **only because** every severity is always rendered with its **word** ("high", "medium") beside the colour — a status colour must never carry meaning alone. Don't drop the label to save space.

**c) Decide dark mode, don't leave it half-built (A19).** Today `.dark` exists but nothing ever applies the class, and `next-themes` is installed but has no provider — so it's dead code that a reviewer will read as unfinished.

| Option | Work | Verdict |
|---|---|---|
| **Wire it** — `ThemeProvider` in the root layout + a toggle in the rail footer + the `.dark` tokens above | ~45 min | **Recommended.** Evaluators toggle dark mode; `sonner` already calls `useTheme()`; the tokens are half-written. High perceived polish per minute. |
| **Park it** — delete the `.dark` block (or move it to a `// v1.1` comment) and ship light-only | ~10 min | Honest and defensible if time is gone. |

If you wire it: add `suppressHydrationWarning` to `<html>`, use `attribute="class" defaultTheme="system"`, and **re-check the tree tint and chart colours in both modes** — that's the whole point of doing it properly.

**d) Give the category pie real, distinguishable colours (A16).** *Why:* `--chart-1…5` in this theme are `oklch(… 0 0)` — **zero chroma, i.e. five greys** — and the `security` slice borrows `--severity-critical`, which makes a *status* colour impersonate a *series* colour (a category isn't "critical"; a finding is). Add proper categorical tokens. These five are validated colourblind-safe against both surfaces (worst adjacent CVD ΔE 9.1 light / 8.4 dark, normal-vision floor 19.6 / 19.3 — all checks pass):

```css
:root {
  --category-code-design:  #2a78d6;   /* blue    */
  --category-security:     #eb6834;   /* orange  */
  --category-test:         #1baf7a;   /* aqua    */
  --category-documentation:#eda100;   /* yellow  */
  --category-requirement:  #e87ba4;   /* magenta */
}
.dark {
  --category-code-design:  #3987e5;
  --category-security:     #d95926;
  --category-test:         #199e70;
  --category-documentation:#c98500;
  --category-requirement:  #d55181;
}
```
Rules that come with them: **the hue follows the category, never its rank** — filtering the list must not repaint the pie; and because three of the light steps sit under 3:1 on white, the slices need **visible labels** (see below), not colour alone.

**e) Fix the pie's form, not just its colours.** A 96px donut with five unlabelled slices is a decoration. Two acceptable v1.0 shapes:
- **Keep the donut, make it legible** (smallest diff): grow it, add a **legend with counts** beside it (`● security 1 · ● code-design 3 · …`) — the legend doubles as the direct labels *and* as the table-view twin for screen readers — put the **total** in the donut's centre, and give the `ChartContainer` an `aria-label` summarising the split.
- **Or switch to one horizontal stacked bar** (recommended if you have 20 minutes): part-to-whole with long category names reads better as a stacked bar than as a pie, labels fit, and it shrinks gracefully on a laptop. Use a 2px surface gap between segments rather than borders.

Either way: ≤6 segments (you have 5 ✅), no slice smaller than ~3% without folding into "Other", and **never** a second y-axis or a rainbow ramp anywhere in this app.

**f) Card B, the trend (A21).**
- **Format the ticks**: `2026-07-22` → `Jul 22`. Raw ISO on an axis is machine output.
- **Fix the baseline honestly**: a *filled area* implies a zero baseline, so keep `domain={[0, 100]}` if you keep the area. If the 68→75 movement then looks too flat to read, **switch the mark to a line** and zoom the domain — a line may start above zero, a filled area may not. Pick one; don't zoom an area.
- Add the **y-axis** (currently absent) or direct-label the last point with its score. A trend with no vertical reference isn't quantitative.
- One series needs **no legend** — the card title names it. Keep the tooltip (already there).
- Guard the empty case (11.2b).

**✅ Micro-check:** open the dashboard, screenshot it, and open the screenshot in a colour-blindness simulator (or Chrome DevTools → Rendering → *Emulate vision deficiencies* → deuteranopia). Every finding is still identifiable **by its label**, the pie's slices are still tellable apart, and the grade letter is comfortably readable.
**💾** `git commit -m "polish(web): accessible severity/health tokens + category palette + chart legibility"`

---

### 11.6 — Keyboard & screen readers (DoD #4, first half)

- *Why:* "keyboard-navigable with visible focus" is in your own DoD, it's a marking criterion in most module rubrics, and one of the gaps (**A12**) means the product's central flow — *click a finding, read why* — is impossible without a mouse.

**a) Fix the Refactor-First rows (A12) — the real bug.** *Why the pattern below:* shadcn's `Table` has no built-in row-activation pattern, and changing a `<tr>`'s ARIA role breaks table semantics. A focusable row with an explicit key handler is the pragmatic, widely-used compromise:
```tsx
<TableRow
  key={f.fingerprint}
  tabIndex={0}
  aria-selected={f.fingerprint === selectedFingerprint}
  onClick={() => onSelect?.(f)}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(f) }
  }}
  className="focus-visible:ring-ring cursor-pointer focus-visible:ring-2 focus-visible:outline-none"
>
```
*(The alternative — a real `<button>` filling the first cell — is more correct ARIA but splits the click target across the row. Note whichever you chose in a comment so the reviewer knows it was a decision.)*

**b) The tree (A14 follow-on).** Rows are already `<button>`s, so Tab works. Add the cheap 90%: `aria-expanded={isOpen}` on folders, an `aria-label` that includes the score (`"src/payments — health 38, needs work"`), and confirm the focus ring survives the new background tint (a custom `background` can visually swallow a ring — test it, don't assume). The full `role="tree"` + roving-tabindex + arrow-key pattern is real work; label it **v1.1** in a comment rather than half-doing it.

**c) Sweep the rest:**
- Every **icon-only** button gets an `aria-label` (sidebar trigger, copy-path, external link).
- The branch `Select` already has `aria-label="Branch"` ✅ — check the filter `Select` and the tabs too.
- `Sheet` gets a real `SheetTitle` (Radix warns if a dialog has no accessible name — check the console; the warning is easy to miss).
- Add a **skip link** (`Skip to content`) as the first focusable element in `(app)/layout.tsx` — one anchor, and it makes the rail skippable on every page.
- Confirm `:focus-visible` is visible on **tinted** surfaces (tree rows, selected table row, severity badges).

**d) Walk it.** Unplug the mouse. From `/login`: Tab to Sign in → Enter → Tab through the rail → into the top nav → change branch with arrows + Enter → Tab into the list → Enter on a row → the panel opens and **focus moves into it** → Esc closes and **focus returns to the row**. Every stop must be visible. Fix whatever you can't reach.

**✅ Micro-check:** the full journey above with the mouse unplugged, plus zero Radix a11y warnings in the console.
**💾** `git commit -m "polish(web): keyboard access + aria labels"`

---

### 11.7 — Responsive to laptop width (DoD #4, second half)

- *Why:* it will be demoed on a laptop, possibly mirrored to a projector at 1024×768, and marked from a screenshot. Nobody has ever resized this app.

**Test at five widths** (Chrome DevTools device toolbar) and fix what breaks:

| Width | What to check |
|---|---|
| **1440** | The dashboard doesn't sprawl — cap content (`max-w-[1600px] mx-auto`) so the two columns don't stretch to absurd line lengths |
| **1280** (the demo default) | Everything above the fold: top nav on one line, both cards side by side, ~8 findings visible without scrolling |
| **1024** | `lg:` breakpoint boundary — the tree drops below the list. Give the tree panel `max-h-[70vh] overflow-auto` so it can't push the page to infinity (A24), and drop the table's least useful column (Type — it's in the detail panel) |
| **768** | The rail is a Sheet → **11.3a's trigger is mandatory here**; the top nav wraps to two lines (it already has `flex-wrap` ✅); the 4-column table needs `overflow-x-auto` on its wrapper |
| **390** (phone) | Not a v1.0 target — but it must not *break*. Acceptable outcome: everything stacks, nothing overflows horizontally, no element is unreachable |

Lock it in with a viewport project in `playwright.config.ts` so a regression fails the build:
```ts
projects: [
  { name: "laptop", use: { viewport: { width: 1280, height: 800 } } },
  { name: "narrow", use: { viewport: { width: 900,  height: 800 } } },
]
```

**✅ Micro-check:** at every width above, `document.body.scrollWidth <= window.innerWidth` (no horizontal page scroll — wide tables scroll *inside their own container*).
**💾** `git commit -m "polish(web): responsive pass 1440→768"`

---

### 11.8 — Feedback & motion (the last 5%)

- *Why:* these are the details that make an interface feel *alive* rather than *correct*. Cheap, and all of them are already half-there.

- **Announce the scan (A22).** Wrap the progress text in `<div role="status" aria-live="polite">` so a screen reader hears "Scanning 34%". Render `queued` as an indeterminate state ("Queued…", no percentage) instead of "Scanning… 0%", and **disable the Scan button while running** so a double-click can't start a second scan.
- **Route transitions.** Add `src/app/(app)/loading.tsx` — Next shows it during navigation, which removes the dead pause between Projects and Dashboard.
- **Refetch without a flash.** Switching branch currently clears the data and re-shows the skeleton. *That was deliberate* (Phase 8 chose it to avoid showing stale numbers), but the smoother pattern is **hold the previous render at reduced opacity** (`aria-busy` + `opacity-60`) so nothing jumps. Either is defensible — pick one, write down why, and know the branch E2E stays green either way.
- **Respect `prefers-reduced-motion`.** One rule in `globals.css` disabling animations/transitions under the media query. *Why:* it's a WCAG requirement and it's four lines.
- **Toast discipline.** You already toast on scan complete/stopped/failed ✅. Do **not** add a toast for "scan started" — the button state already says that, and a toast for something already visible is noise. Toasts are for things that finish while the user's attention is elsewhere.

**💾** `git commit -m "polish(web): scan announcements, route loading, reduced motion"`

---

### 11.9 — Tests that lock the polish in (DoD #3)

- *Why:* every state you added in 11.2 is invisible on the happy path, so nothing stops a future edit from deleting it. A state with no test is a state you'll lose.

**Component tests (Vitest) — one per new behaviour:**
- `error-state` renders the message and calls `onRetry` on click.
- `use-query` — **retry refetches**: fail the first request via `server.use(...)`, assert the error, call `refetch()`, assert data. *(This is the highest-value new test in the phase: it covers the trickiest code you wrote.)*
- `refactor-first-list` — **Enter on a focused row fires `onSelect`** (the A12 regression net), the empty-filter state shows *Clear filter*, and the clean-repo empty state differs from the filtered one.
- `overall-health-card` — a negative delta renders the down icon and the bad-health colour.
- `file-tree` — a row exposes its score in the accessible name; the legend renders.
- `relativeTime` — a pure unit test with a frozen `now` (that's what the injectable second argument is for).

**E2E (Playwright) — the states you can only see by breaking the network.** This is the guide's original "point a hook at an empty/erroring response" check, made permanent:
```ts
test("dashboard shows a friendly error and recovers on retry", async ({ page }) => {
  await page.route("**/api/repos/*/health*", (r) => r.fulfill({ status: 500, body: "{}" }))
  await page.goto("/dashboard/demo-repo")
  await expect(page.getByText(/couldn’t load/i)).toBeVisible()

  await page.unroute("**/api/repos/*/health*")          // heal the network
  await page.getByRole("button", { name: /retry/i }).click()
  await expect(page.getByText("Code Health")).toBeVisible()
})

test("empty projects list invites you to connect one", async ({ page }) => {
  await page.route("**/api/projects", (r) => r.fulfill({ status: 200, body: "[]" }))
  await page.goto("/projects")
  await expect(page.getByText(/connect one to see its health/i)).toBeVisible()
})
```
Add one **keyboard-only** E2E (`page.keyboard.press("Tab"/"Enter")` through sign-in → project → finding) — it's the cheapest possible guard on A12 and it doubles as evidence for the accessibility section of your report.

⚠️ Keep the three Phase 10 journeys **green and unchanged**. If a polish edit breaks one of them, the polish changed behaviour — that's the signal, so investigate before you edit the selector.

**💾** `git commit -m "test(web): states, retry, keyboard journey"`

---

### 11.10 — Review & sign-off (DoD #5)

- *Why:* the last DoD item is the one that's actually skipped. Make it mechanical: paste this table into the PR and tick it per view — it's also the evidence trail for the "quality" section of your report.

| View | Loading | Empty | Error+Retry | Keyboard | 1280 & 900 | Contrast | Tests |
|---|---|---|---|---|---|---|---|
| Login | ☐ | n/a | ☐ | ☐ | ☐ | ☐ | ☐ |
| Projects | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Dashboard — top nav | ☐ | n/a | ☐ | ☐ | ☐ | ☐ | ☐ |
| Dashboard — Card A | ☐ | ☐ | n/a | ☐ | ☐ | ☐ | ☐ |
| Dashboard — Card B | ☐ | ☐ | n/a | ☐ | ☐ | ☐ | ☐ |
| Dashboard — list | ☐ | ☐ | n/a | ☐ | ☐ | ☐ | ☐ |
| Dashboard — tree | ☐ | ☐ | n/a | ☐ | ☐ | ☐ | ☐ |
| Finding panel | n/a | n/a | n/a | ☐ | ☐ | ☐ | ☐ |
| Scan History · Profiles | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

**Reviewer's job (your teammate):** don't read the diff first — **run it**. Do the demo script below on their own machine from a clean clone. Anything that surprises them is a finding, because the examiner will be a stranger too.

---

**✅ Test / verify — the whole phase**

*The gates:*
```powershell
pnpm verify        # tsc + eslint --max-warnings 0 + prettier --check + vitest run + next build
pnpm test:e2e      # all Playwright journeys, incl. the new state + keyboard specs
```

*The demo script (do it end to end, mouse-free once):*
1. Fresh clone → `cp .env.example .env.local` → `pnpm i` → `pnpm dev` → data appears.
2. `/login` → **Sign in with GitHub** → Projects (real names, health hints).
3. Select `acme-payments` → dashboard: the grade is readable at a glance, the delta is coloured, the pie is legible with a legend, the tree is visibly a heat map with a scale.
4. **Scan** → live % + announced progress → complete toast → **Stop** mid-scan on a second run.
5. Switch branch → numbers re-scope with no layout jump.
6. Click the top finding (and the same finding from the tree) → the panel explains *why*, and **Copy path** works.
7. Break it on purpose: DevTools → Offline → reload → friendly error → back Online → **Retry** → recovered.
8. Resize 1440 → 1280 → 1024 → 768: nothing overflows, the rail is reachable at every width.

**💾 Commits:** one per sub-phase (11.1 → 11.10), then open **one PR** titled `polish(web): v1.0 Definition of Done` linking the audit table — small commits, one review.

> **What this phase deliberately does NOT do:** add features, touch `@/lib/types`, swap any library, or "improve" the mock data. If you catch yourself editing `fixtures.ts` to make a screen look better, stop — either the component can't handle real data (a bug, fix the component) or you're building a feature (v1.1).

---

## Phase 12 — (Later) Swap mock → real backend

**Goal:** when the FastAPI backend ships an endpoint, use it instead of the mock — with **no component or test rewrites**.
**Why this is easy:** because you built against the contract, the real endpoint returns the same shapes your components already expect.

For each endpoint, when it's ready:
1. **Check the shape** — confirm the real response matches the contract type. If not, that's a *backend* fix (the type is the agreement).
2. **Point at the real API** — set the base URL via env var in `lib/api/client.ts`.
3. **Turn off the mock** — remove/disable that handler, or flip `NEXT_PUBLIC_API_MOCKING` off once all endpoints exist.
4. **Re-run the same E2E** — it now exercises the real backend. Green = migrated.

Two swaps already designed for: **real GitHub sign-in** (replace the mocked `/api/auth/github`) and **Card B contextual health** (flip Card B to read the hovered node's series — the tree already emits the hover event).

---

## Quick command reference

```powershell
pnpm dev            # run the app at localhost:3000 (Fast Refresh)
pnpm test           # component tests, watch mode
pnpm test:run       # component tests, once (CI-style)
pnpm test:e2e       # Playwright end-to-end tests
pnpm exec tsc --noEmit   # type-check the whole project
```

**Golden rules (from the plan):** charts = shadcn Chart only (never raw Recharts) · the tree library lives only inside `file-tree.tsx` · never hardcode a color (change a CSS variable) · never hardcode display data (it comes from a handler shaped like the contract) · one happy-path E2E stays green at all times.

---

*Build phases in order, commit after each, keep the smoke test green. When you're ready to actually run Phase 1, say so and we'll do it together.*
