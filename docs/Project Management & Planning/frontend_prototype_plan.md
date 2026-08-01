# Frontend Prototype Plan — Code Sage AI Dashboard

**v1.1** — adds the locked product flow + dashboard layout, switches all charts to shadcn Chart, and un-locks the file-tree library. Read §1 and §2 first; everything else serves them.

---

## Contents

1. [The one principle that governs everything](#1-the-one-principle)
2. [Design decisions — product flow & dashboard layout](#2-design-decisions)  ← *the spec you dictated, captured*
3. [Locked stack and why each piece is here](#3-locked-stack)
4. [Step-by-step setup — install Next.js + shadcn, with the *why*](#4-setup)
5. [Folder structure (with the reasoning)](#5-folder-structure)
6. [The contract layer + mock layer — how we run with no backend](#6-contract-and-mocks)
7. [Component architecture — mapping the views onto one dashboard](#7-component-architecture)
8. [Step-by-step development plan (build order)](#8-dev-plan)
9. [How the two of us split the work](#9-splitting-the-work)
10. [VS Code tooling + live/interactive theming](#10-tooling-and-theming)
11. [Design quality — not looking like a template](#11-design-quality)
12. [Testing strategy — component tests + Playwright on mocks](#12-testing)
13. [Definition of Done + the extend-to-final path](#13-dod-and-extend)
14. [First-week checklist](#14-checklist)

---

## 1. The one principle

**The prototype is not a throwaway. It is the first version of the real product, built against fake data.**

Everything below follows from this. We do *not* build a disposable mockup and then rebuild it "properly" later — we have no time for that, and the dev plan already commits to it (stage P3: *"Next.js pages on mock JSON matching the OpenAPI contract → becomes the actual product"*). So from day one we write real components, with the real component library, real routing, real layout, and the **real data shapes** — the only thing that is fake is where the data comes from.

```
Prototype today                    Final product later
─────────────────                  ───────────────────
Real Next.js pages          →      same pages
Real shadcn components      →      same components
Real TypeScript types       →      same types (the contract)
Real Playwright tests       →      same tests
Data from MSW mocks         →      data from FastAPI backend   ← only this line changes
```

When the backend team ships an endpoint, we flip that repo from "mocked" to "live" and the UI does not care. That is the whole strategy. Hold onto it — every folder and every testing decision in this doc exists to protect it.

---

## 2. Design decisions

> **Why this section exists:** this is the product flow and layout dictated for v1, written down so it is not lost and so every component below has an address. Treat it as the source of truth for *what screens exist and how they're arranged*. The stack (§3) and folders (§5) implement exactly this.

### 2.1 The user flow

1. **Sign in.** A login screen appears. The prominent action is **"Sign in with GitHub."**
   → *Prototype: this is **mocked*** — clicking it fakes a signed-in GitHub user and unlocks a fake list of that user's private repos. No OAuth app, no secrets, no backend. (Swap to real GitHub OAuth later; see §13.)
2. **Land on Projects.** After sign-in the user is on the **Projects** destination (left nav rail).
3. **Add a project**, two ways:
   - paste a **public repo URL**, or
   - pick from the **signed-in account's private repos** (mocked list).
4. **Projects list vertically** in the Projects panel. Each row is a connected repo (name, owner, visibility, a small health hint).
5. **Open the Dashboard.** The left rail's second destination is **Dashboard** — the analysis screen for the **active** project.

### 2.2 The app shell (left rail) + the dashboard layout

Primary navigation is a **left vertical rail** with two destinations: **Projects** and **Dashboard**. The rail is persistent; the content area swaps.

The **Dashboard** content is arranged as: a **top horizontal nav bar**, and below it a **main area split into two halves**.

```
┌────┬───────────────────────────────────────────────────────────┐
│    │  TOP NAV:  [ branch ▼ ]  [ Scan ]        Last checked · SHA │
│ P  ├───────────────────────────────┬───────────────────────────┤
│    │  LEFT HALF                    │  RIGHT HALF                │
│ ── │  ┌────────────┐ ┌───────────┐ │                           │
│    │  │  Overall   │ │  Health   │ │   Interactive file tree   │
│ D  │  │  Health    │ │  Graph    │ │   (health HEAT MAP)       │
│    │  │  (card A)  │ │ (card B)  │ │                           │
│    │  └────────────┘ └───────────┘ │   red → amber → green     │
│    │                               │   by health/debt          │
│    │  ┌───────────────────────────┐│                           │
│    │  │  Refactor-First list      ││   hover a node ──┐        │
│    │  │  (sorted, severity badges)││                  │ later  │
│    │  └───────────────────────────┘│                  ▼        │
│    │                               │   drives card B scope     │
└────┴───────────────────────────────┴───────────────────────────┘
 rail            main content area (excludes rail + top nav)
```

**Top nav bar** (`dashboard-topnav`):
- **Left:** the active project's **branch** as a **dropdown** (default branch pre-selected; switching branch re-scopes the whole dashboard).
- **Center/left:** a **Scan** button that is a small state machine:
  - `idle` → **"Scan"**.
  - `running` → **"Scanning… 47%"** with a progress indicator **and a Stop control**.
  - `done` / `error` → returns to idle with the result reflected.
- **Right ("rightmost horizontal panel"):** **Last checked** time + **last commit SHA** (short) for the selected branch.

**Main area — two halves:**
- **Right half:** the **interactive file tree**, rendered as a **health heat map** (each file/folder tinted red→amber→green by its health/debt score).
- **Left half:**
  - **Top:** two cards side by side —
    - **Card A — Overall Health:** the repo's score / grade / delta-since-last-scan.
    - **Card B — Health Graph:** a shadcn chart. **v1 shows overall *repo* health.** **Planned evolution:** hovering a file/folder in the heat-map tree re-scopes this card to **that node's** health (per-file / per-folder). See 2.3.
  - **Bottom:** the **Refactor-First list** — the prioritized findings, sorted, each row carrying a **category chip**, a **severity chip**, `file:line`, the one-line reason, and — for SATD rows only — a **`SATD` source chip**.

> **Revised 30 Jul 2026 ([CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md) D-CR7) — finding detail renders *in place*, not as a slide-over.** Selecting a finding puts the dashboard into **detail mode**: the Card A + Card B region is replaced by the finding detail, the file tree on the right **auto-expands and highlights** that finding's file, and the Refactor-First list condenses to a strip so the user can move between findings. Closing restores the cards. *Why:* triage means reading many findings in sequence, and an overlay covers the tree, costs a close-and-reopen per finding, and is too narrow to render a code snippet without wrapping. Build order is unchanged — the same `finding-detail-panel` component is reused; only its container moves.

### 2.3 Interaction contracts (design these now, even if v1 is simpler)

These are the wires between components. Getting the boundaries right now means the "planned evolution" bits are a data swap, not a rewrite.

| Contract | Producer | Consumer | v1 behavior | Later |
|---|---|---|---|---|
| **Active project** | Projects list / connect | whole Dashboard | selected repo id in the route (`/dashboard/[repoId]`) | unchanged |
| **Active branch** | branch dropdown | scan + all cards + tree | changing branch refetches the health report for that branch | unchanged |
| **Scan status** | Scan button → `useScan` | top nav + (subtle) whole dashboard | mock drives `idle → running(%) → done`; Stop cancels | live scan stream from backend |
| **Hovered/selected tree node** | `file-tree` (`onHoverNode`, `onSelectNode`) | **Card B** (health graph) + finding detail | node is captured in dashboard state; **Card B still shows repo health** | **Card B re-scopes to the hovered node** (per-file/folder health) |
| **Selected finding** | refactor list row / tree file | **detail mode** — the Card A/B region, the file tree, and the list all react | region swaps to the finding detail; tree expands + highlights the file; list condenses; fingerprint goes in the URL | snippet ([v1.1]) and actions ([v1.1]) fill the same region |

**Key implication:** the Dashboard page owns a small piece of state — `{ hoveredNode, selectedNode }` — that the file tree writes and Card B reads. In v1 Card B ignores it and renders repo health; the plumbing exists so flipping to contextual health is a one-line change in Card B plus a fixture that carries per-node series. (No global store needed yet — lift state in the page or a tiny React context.)

### 2.4 Deliberately deferred / open

- **File-tree library is NOT chosen.** Only the *component boundary* is fixed (`file-tree.tsx` props). How we render the tree — virtualized list, nested rows, indentation guides — is a P3 decision. See §3 and §7.4. Do not let this block anything else; build against the boundary with a trivial recursive placeholder first.
- **Card B chart type.** v1: a simple repo-health view (trend/area or gauge — decide at build). The *card slot and its data hook* are fixed; the visual is cheap to change because it's a shadcn Chart.
- **Category breakdown, workspace rollup metrics, real scan streaming, real OAuth** — represented/mocked now, realized later (§7, §13). Core comes first; the UI can *show* additional features before their pipelines exist.

---

## 3. Locked stack

Decided. Do not re-litigate mid-sprint (that is risk R7 — scope drift — at the code level). The two rows marked **↔** are the changes from v1.0.

| Concern | Choice | Why it's the right call here |
|---|---|---|
| Framework | **Next.js (App Router)** | Committed stack. App Router + Server Components is the current standard; the CLI, routing, and shadcn are built to work together. |
| Components | **shadcn/ui** | Not an npm dependency — it copies component source into the repo, so you *own* and can restyle every component. This is exactly what lets the prototype become the product without fighting a library. |
| Styling | **Tailwind CSS v4** (comes with shadcn) | Utility-first; shadcn themes are just CSS variables in `globals.css` — change one variable, the whole app re-themes live. |
| **Charts ↔** | **shadcn Chart** (`shadcn add chart`) | *Changed from "Recharts."* shadcn Chart **is a thin, themed wrapper over Recharts** — same rendering engine, but it reads your CSS theme variables and gives you `ChartContainer`/`ChartTooltip`/`ChartLegend`. Using it (not raw Recharts) keeps every graph consistent with the rest of the UI and re-themes for free. **One charting approach, no deviations.** |
| **File tree ↔** | **Boundary fixed, library deferred** | *Changed from "react-arborist."* We commit to a `FileTree` component with a fixed prop contract (§7.4) and a **heat-map** look; we do **not** commit to the library yet. Candidates: **react-arborist** (virtualized — best for huge repos), **react-complex-tree**, the community **shadcn tree-view**, or a **custom recursive tree**. Pick at P3 against real fixture sizes. Because the boundary is fixed, swapping later touches one folder. |
| Mock backend | **MSW (Mock Service Worker) v2** | Intercepts network calls at the network layer; app code is unaware it's mocked; the *same* handlers serve dev + component tests + E2E. This is how we work with no backend. |
| Auth (prototype) | **Mocked GitHub sign-in** | A fake "Sign in with GitHub" that sets a fake session and unlocks a fixture private-repo list. No OAuth app/secrets until we go live. |
| Component tests | **Vitest + React Testing Library** | Fast, works with MSW's Node interceptor. |
| E2E tests | **Playwright** | Committed choice. Runs the real app in a real browser against MSW mocks. |
| Icons | **lucide-react** | The icon set every shadcn example uses. **Set `"iconLibrary": "lucide"` in `components.json`** — newer shadcn CLI versions may default to Hugeicons, which generates components importing the wrong set. One icon library only, no mixing. |

---

## 4. Setup

Do this **together, in one sitting, on one machine, then push** so both of you start from an identical baseline. This is the single most important hour — a shared foundation prevents "works on my machine." Each step says *why* so nothing is cargo-culted.

> **Where it lives:** the dev plan commits to a monorepo (`apps/web`, `apps/api`, `apps/ml`) — this repo already has those folders. The frontend is **`apps/web`** (currently just these docs). Run the scaffold **inside `apps/web`**.

### Step 0 — prerequisites (why: one toolchain for both of us)
- **Node.js LTS** (v20+) and **pnpm** (`npm i -g pnpm`). We standardize on **pnpm** so there is one lockfile and no npm/yarn drift.

### Step 1 — scaffold Next.js + shadcn in one command (why: they're built to be wired together)
The shadcn CLI can create the whole Next.js project pre-wired with Tailwind v4, the theme variables, dark mode, and the `@/*` import alias — so you skip a dozen manual config steps.

```bash
cd apps/web
pnpm dlx shadcn@latest init
# choose: Next.js · TypeScript · App Router · src/ directory · base color: Neutral
```

You now have `components.json`, Tailwind configured, `globals.css` holding the theme variables, and dark mode already wired.

### Step 2 — add the shadcn components you'll use now (why: pull only what you need, own the source)
These map directly onto the layout in §2. `chart` is the one graph primitive; `sidebar` is the left rail. `sheet` was the finding-detail slide-over until [CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md) moved the detail **in place** (§2.2); it stays in the set for the mobile drawer and any future overlay, but the finding detail no longer uses it.

```bash
pnpm dlx shadcn@latest add \
  sidebar navigation-menu \
  card badge button \
  table tabs \
  dialog sheet \
  select \
  chart \
  skeleton sonner tooltip separator input progress
```
> `chart` installs and configures **shadcn Chart** (and pulls in Recharts as its engine). This is our *only* charting path.

### Step 3 — add the non-shadcn runtime + test libraries (why: charts engine comes via shadcn; tree lib is deferred)
```bash
pnpm add lucide-react
pnpm add -D msw vitest @testing-library/react @testing-library/jest-dom \
  @playwright/test jsdom
pnpm dlx playwright install       # download browser binaries (why: Playwright drives real browsers)
npx msw init public/ --save       # generates public/mockServiceWorker.js (why: MSW needs it in the browser)
```
> **Note — no tree library yet.** We intentionally do **not** install react-arborist (or any tree lib) here. Build against the `FileTree` boundary (§7.4) with a simple recursive placeholder; install your chosen library at P3:
> `pnpm add react-arborist`  *(or the alternative you pick — one line, one folder affected).*

### Step 4 — commit the baseline and both pull it (why: diverge on features, never on setup)
```bash
git add -A && git commit -m "chore(web): scaffold Next.js + shadcn baseline"
```

### Step 5 — agree three conventions in writing (put them at the top of `apps/web/README.MD`)
- **Package manager: pnpm** (one lockfile; don't mix npm/yarn).
- **Formatting: Prettier + ESLint on save** (`"editor.formatOnSave": true` — see §10).
- **Branching:** short-lived feature branches, one PR = one view/feature, reviewed by the other person (risk R1 mitigation — shared ownership).

---

## 5. Folder structure

This is the `apps/web/src` layout, updated for the **left rail**, the **Projects/Dashboard** split, and the **deferred file-tree library**. The reasoning matters more than the tree — read the notes.

```
apps/web/
├── src/
│   ├── app/                              # App Router — routing = folders
│   │   ├── (auth)/
│   │   │   └── login/page.tsx            # mocked "Sign in with GitHub"
│   │   ├── (app)/                        # the shell: LEFT rail (Projects · Dashboard)
│   │   │   ├── layout.tsx                # persistent left rail + content slot
│   │   │   ├── projects/page.tsx         # connect repo (public URL / private) + vertical list
│   │   │   └── dashboard/
│   │   │       └── [repoId]/page.tsx     # THE single consolidated dashboard screen (§2.2)
│   │   ├── layout.tsx                    # root layout (fonts, providers, MSW bootstrap)
│   │   └── globals.css                   # Tailwind + shadcn theme vars + chart + heat-map tokens
│   │
│   ├── components/
│   │   ├── ui/                           # shadcn primitives (generated — don't hand-edit lightly)
│   │   ├── layout/
│   │   │   ├── app-rail.tsx              # LEFT rail: Projects · Dashboard
│   │   │   ├── dashboard-topnav.tsx      # branch dropdown + scan control + last-checked/SHA
│   │   │   └── scan-control.tsx          # idle / running(%) + Stop / done
│   │   ├── projects/
│   │   │   ├── connect-repo.tsx          # public-URL input + private-repo picker (mocked)
│   │   │   └── project-list.tsx          # vertical list of connected projects
│   │   └── dashboard/                    # OUR feature components
│   │       ├── overall-health-card.tsx   # Card A  (V1)
│   │       ├── health-graph-card.tsx     # Card B  (shadcn Chart) — repo scope now, node scope later
│   │       ├── refactor-first-list.tsx   # V3
│   │       ├── finding-detail-panel.tsx  # V4  (in-place detail region — CR-001)
│   │       ├── category-breakdown.tsx    # V5  (shadcn Chart) — added later
│   │       └── file-tree/                # ★ boundary fixed, LIBRARY DEFERRED (§7.4)
│   │           ├── file-tree.tsx         #   public component — props ARE the contract
│   │           └── README.md             #   candidate libraries + decision criteria
│   │
│   ├── lib/
│   │   ├── types/index.ts                # ★ THE CONTRACT (Repo, Branch, ScanStatus, TreeNode, Finding, …)
│   │   ├── api/client.ts                 # thin fetch() client — MSW intercepts these
│   │   ├── mocks/
│   │   │   ├── handlers.ts               #   MSW request handlers (incl. fake GitHub auth + repos)
│   │   │   ├── fixtures.ts               #   realistic sample data shaped like the contract
│   │   │   ├── browser.ts                #   setupWorker(...) for the dev server
│   │   │   └── server.ts                 #   setupServer(...) for tests
│   │   └── utils.ts                      # cn() + gradeColor() + healthColor() (heat-map mapping)
│   │
│   ├── hooks/                            # useProjects, useHealthReport, useBranches, useScan
│   └── test/                            # vitest.setup.ts wires the MSW server
│
├── e2e/                                 # Playwright specs (login.spec.ts, dashboard.spec.ts)
├── public/                              # includes mockServiceWorker.js (from `msw init`)
├── components.json                      # shadcn config
├── playwright.config.ts
├── vitest.config.ts
└── package.json
```

**Why this shape:**

- **`app/` = routing, `components/` = building blocks.** Pages in `app/` are thin: they fetch data (via a hook) and arrange feature components. Feature components hold the actual UI. This split is what makes components reusable and testable.
- **`components/ui/` vs feature folders.** `ui/` is shadcn primitives (Button, Card, Badge, Chart). `layout/`, `projects/`, `dashboard/` compose those primitives into *your* views. Never mix them — restyle later by touching `ui/` once and everything inherits.
- **`file-tree/` is its own folder for a reason.** The whole point of §2.4's deferral is that the tree library lives *only* inside `file-tree.tsx`. The rest of the app imports `<FileTree … />` and knows nothing about react-arborist (or whatever we pick). Its `README.md` records the candidates and the decision.
- **`lib/types/` is sacred.** Single source of truth for what data looks like. The backend member should agree these shapes with you *now* (this is the OpenAPI contract in TypeScript form). Both the mocks and the real API must satisfy these types.
- **`lib/mocks/` is deletable.** When the backend is live, this folder's job ends. Nothing in `components/` imports from `mocks/` directly — components get data through hooks/`lib/api`, which hit the network, which MSW happens to intercept. That indirection is the entire trick.

---

## 6. Contract and mocks

This section is the answer to *"how do I build the whole thing before the backend exists."* Three small pieces.

### 6.1 The contract — types that mirror your data model

Extended from v1.0 to cover the flow in §2 (projects, branches, scan status, tree nodes). Put this in `lib/types/index.ts`:

> ⚠️ **Canonical version:** the contract now lives in **`apps/web/src/lib/types/index.ts`** (created in Phase 5) and is the finalized v1 shape. It **extends** the baseline below with: a `Source` type; finding-detail fields (`priority`, `ruleId`, `metricValue`, `threshold`, `snippet`); `ScanSummary` (Scan-History tab); `CategoryBreakdownItem` (Health-card pie); `ScoreProfile` (profiles); extra `HealthReport` fields (`scanId`, `commitSha`, `profile`, `redIssueCount`, `categoryBreakdown`); a `Repo.workspaceId` multi-tenant seam; and v2 `Role`/`Member`/`Workspace`. Treat the **code file** as the source of truth and keep this section in sync via PR.
>
> **CR-001 (30 Jul 2026) changes two of those shapes** — applied in **Phase 10.5**, see [the build guide](./frontend_build_stepbystep.md) and [CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md): `Source` drops to `"rule" | "satd"`, and `ScoreProfile` becomes five **category**-keyed weights (`security`, `codeDesign`, `requirement`, `documentation`, `test`) plus a `trust` scalar `s`, replacing `wMl`. The old vector mixed axes — `satd` is a *source* and `duplication` is a *rule* — and omitted three real categories, which was invisible while profiles were presets and becomes a dead slider once the user can drag them.

```typescript
export type Severity = "critical" | "high" | "medium" | "low";
export type Category =
  | "code-design" | "requirement" | "defect"        // ML-1 (SATD)
  | "documentation" | "test"                       // ML-1 (SATD)
  | "security";                                    // rule engine only
// Six values, frozen against satd-dataset-code_comments.csv (SRS FR-9.3, CR-001 D-CR12).
export type FindingStatus = "open" | "acknowledged" | "accepted" | "resolved" | "false-positive";
export type Grade = "A" | "B" | "C" | "D" | "E";

export interface Finding {
  fingerprint: string;
  source: "rule" | "satd";     // CR-001: the only two producers of findings.
                               // Security patterns live in the rule engine, so a
                               // security finding is source "rule" + category "security".
                               // The risk model writes FileScore.riskScore, never a Finding.
  category: Category;
  severity: Severity;
  file: string;
  line: number;
  symbol: string;
  reason: string;              // the one-line human explanation — your anti-noise differentiator
  status: FindingStatus;
}

export interface FileScore { file: string; debtScore: number; riskScore: number; }

// ── the connected repo + how the user added it ─────────────────────────────
export interface Repo {
  id: string;
  name: string;
  owner: string;
  visibility: "public" | "private";
  url: string;
  source: "public-url" | "github";   // how it was connected
  defaultBranch: string;
  connectedAt: string;
  latestHealth?: { score: number; grade: Grade; delta: number };  // for the Projects list hint
}

export interface Branch {
  name: string;
  isDefault: boolean;
  lastCommitSha: string;       // full; UI shows short (first 7)
  lastCommitAt: string;
}

// ── scan lifecycle: drives the Scan button in the top nav ──────────────────
export type ScanPhase = "idle" | "queued" | "running" | "done" | "error";
export interface ScanStatus {
  scanId: string;
  phase: ScanPhase;
  progress: number;            // 0–100 (meaningful when phase === "running")
  startedAt?: string;
  finishedAt?: string;
}

// ── file-tree node: powers the heat map AND (later) Card B's per-node scope ─
export interface TreeNode {
  path: string;                // "src/lib/api/client.ts"
  name: string;                // "client.ts"
  type: "file" | "folder";
  healthScore: number;         // 0–100 → drives heat-map color
  grade: Grade;
  debtScore: number;
  riskScore: number;
  children?: TreeNode[];       // folders only
}

export interface HealthPoint { t: string; score: number; }  // one point on Card B's graph

export interface HealthReport {
  repoId: string;
  branch: string;
  healthScore: number;         // 0–100
  grade: Grade;
  delta: number;               // change vs previous scan
  history: HealthPoint[];      // Card B (repo scope)
  tree: TreeNode[];            // the heat-map file tree
  fileScores: FileScore[];
  findings: Finding[];         // the Refactor-First list
  scannedAt: string;
  lastCommitSha: string;
}
```

Because these types are shared, a typo in a mock or a shape the backend doesn't honor becomes a **compile error**, not a bug you find at demo time.

### 6.2 The API client — thin functions that make real network calls

> **Shipped code note (Phase 8):** the real [`lib/api/client.ts`](../../apps/web/src/lib/api/client.ts) keeps these signatures but adds `getScanStatus`, `getScanHistory`, `getProfiles` and a `NEXT_PUBLIC_API_BASE_URL` seam. The data hooks share one `useQuery` engine (`src/hooks/`) — see **[frontend_build_stepbystep.md](./frontend_build_stepbystep.md) → Phase 8 Status** for the full list of deviations and why.

`lib/api/client.ts` (the endpoints mirror the flow):

```typescript
import type { HealthReport, Repo, Branch, ScanStatus } from "@/lib/types";

export async function getProjects(): Promise<Repo[]> {
  return json(await fetch("/api/projects"));
}
export async function getBranches(repoId: string): Promise<Branch[]> {
  return json(await fetch(`/api/repos/${repoId}/branches`));
}
export async function getHealthReport(repoId: string, branch: string): Promise<HealthReport> {
  return json(await fetch(`/api/repos/${repoId}/health?branch=${encodeURIComponent(branch)}`));
}
export async function startScan(repoId: string, branch: string): Promise<ScanStatus> {
  return json(await fetch(`/api/repos/${repoId}/scan`, { method: "POST", body: JSON.stringify({ branch }) }));
}
export async function stopScan(repoId: string, scanId: string): Promise<ScanStatus> {
  return json(await fetch(`/api/repos/${repoId}/scan/${scanId}/stop`, { method: "POST" }));
}

async function json(res: Response) { if (!res.ok) throw new Error(res.statusText); return res.json(); }
```

Note: this code is **final**. It does not know or care that there's no backend. It just calls `/api/...`.

### 6.3 The mock layer — MSW answers those calls with fixtures

> **Shipped code note (Phase 8):** the snippet below is the original sketch; the real [`lib/mocks/handlers.ts`](../../apps/web/src/lib/mocks/handlers.ts) uses the actual fixture names (`mockRepos`, `mockBranches` **array**, `mockHealthReport` **constant**), prefixes routes with `*/`, derives the health report per repo/branch, and adds an in-memory scan state machine + `resetMockBackend()`. See **[frontend_build_stepbystep.md](./frontend_build_stepbystep.md) → Phase 8.1** for the paste-time adaptations.

`lib/mocks/handlers.ts` — including the **mocked GitHub sign-in** and a **scan that progresses**:

```typescript
import { http, HttpResponse } from "msw";
import { mockProjects, mockPrivateRepos, mockHealthReport, mockBranches, advanceScan } from "./fixtures";

export const handlers = [
  // mocked auth: pretend GitHub OAuth succeeded, return the user's private repos
  http.post("/api/auth/github", () => HttpResponse.json({ user: "sage-dev", repos: mockPrivateRepos })),

  http.get("/api/projects", () => HttpResponse.json(mockProjects)),
  http.get("/api/repos/:repoId/branches", ({ params }) => HttpResponse.json(mockBranches(params.repoId as string))),
  http.get("/api/repos/:repoId/health", ({ params, request }) => {
    const branch = new URL(request.url).searchParams.get("branch") ?? "main";
    return HttpResponse.json(mockHealthReport(params.repoId as string, branch));
  }),

  // scan lifecycle: POST starts it; polling returns increasing progress until done
  http.post("/api/repos/:repoId/scan", ({ params }) => HttpResponse.json(advanceScan(params.repoId as string, "start"))),
  http.get("/api/repos/:repoId/scan/:scanId", ({ params }) => HttpResponse.json(advanceScan(params.repoId as string, "tick"))),
  http.post("/api/repos/:repoId/scan/:scanId/stop", ({ params }) => HttpResponse.json(advanceScan(params.repoId as string, "stop"))),
];
```

`fixtures.ts` holds realistic sample data — a repo with a handful of findings including one hardcoded-secret (critical) and one hacky TODO (medium), a `tree` whose nodes have varied `healthScore` so the heat map has **red, amber, and green** files to render, and a private-repo list for the connect flow. Use the **golden-repo** findings from the dev plan's testing section as the fixture; then your mock data and your real integration test tell the same story.

**Turn MSW on in dev** by starting the worker in a client provider that only runs when `NEXT_PUBLIC_API_MOCKING=enabled`. Flip the flag off the day the backend is ready — zero code changes.

**The payoff:** you can build, click through, and test the entire flow — login, connect a repo, list projects, switch branch, run (and stop) a scan, read the health cards, browse the heat-map tree, open a finding — with no backend running at all. And every one of those mock handlers is reused verbatim by your tests (§12).

---

## 7. Component architecture

Every view is a **presentational component** (receives data via props, renders UI, holds no fetching logic). Pages fetch and pass data down. This is what makes them (a) testable in isolation with fake props and (b) trivially reusable.

### 7.1 The pattern (unchanged and load-bearing)

```typescript
// components/dashboard/overall-health-card.tsx  — PRESENTATIONAL, no data fetching
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gradeColor } from "@/lib/utils";

export function OverallHealthCard({ score, grade, delta }:
  { score: number; grade: string; delta: number }) {
  return (
    <Card>
      <CardHeader><CardTitle>Code Health</CardTitle></CardHeader>
      <CardContent>
        <span className={gradeColor(grade)}>{grade}</span>
        <span>{score}/100</span>
        <span>{delta >= 0 ? `▲ +${delta}` : `▼ ${delta}`} since last scan</span>
      </CardContent>
    </Card>
  );
}
```

The dashboard page wires data and owns the tree↔card state (§2.3):

```typescript
// app/(app)/dashboard/[repoId]/page.tsx  (sketch)
// - fetch report via useHealthReport(repoId, branch)
// - hold { hoveredNode } state
// - <DashboardTopNav branch… scan… lastCommitSha… />
// - LEFT half:  <OverallHealthCard/> <HealthGraphCard scope={hoveredNode ?? "repo"} history={…}/>
//               <RefactorFirstList findings={…} onSelect={openDetail}/>
// - RIGHT half: <FileTree nodes={report.tree} onHoverNode={setHoveredNode} colorFor={healthColor}/>
// - <FindingDetailPanel .../>  (Sheet)
```

### 7.2 Charts are shadcn Chart — one approach

Card B and the (later) category breakdown both use **shadcn Chart**. You compose Recharts primitives *inside* `ChartContainer`, and colors come from the theme via a `chartConfig`, so charts match the app and re-theme automatically:

```typescript
// components/dashboard/health-graph-card.tsx  (sketch)
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, XAxis } from "recharts";  // primitives only; container does the theming
// data = repo history now; later = hovered node's history (same shape, different source)
```

> Do **not** import Recharts directly for a bare `<LineChart>` — always go through `ChartContainer`. That's the "no deviations" rule.

### 7.3 Scan control is a small state machine

`scan-control.tsx` renders from a `ScanStatus`: `idle → running(progress + Stop) → done/error`. Use shadcn `progress` for the bar and `sonner` for a "Scan complete / Scan stopped" toast. The page's `useScan` hook starts the scan (POST) and polls the tick endpoint; MSW's `advanceScan` makes progress climb.

### 7.4 The file tree — fixed boundary, deferred library

This is the un-locked piece. **Commit to this prop contract now; choose the library at P3.**

```typescript
// components/dashboard/file-tree/file-tree.tsx  — PUBLIC boundary (stable)
import type { TreeNode } from "@/lib/types";

export interface FileTreeProps {
  nodes: TreeNode[];
  colorFor: (node: TreeNode) => string;      // heat-map tint from healthScore (red→amber→green)
  onHoverNode?: (node: TreeNode | null) => void;   // drives Card B later (§2.3)
  onSelectNode?: (node: TreeNode) => void;         // opens finding detail / focuses file
  selectedPath?: string;
}

export function FileTree(props: FileTreeProps) {
  // v1: trivial recursive render of props.nodes (good enough to build everything around).
  // P3: swap the internals for the chosen library — THIS FILE is the only thing that changes.
  return /* … */;
}
```

**Choose the library at P3 against real fixtures, on these criteria:**
- **Virtualization** — do real target repos have thousands of files? If yes → **react-arborist** (virtualized). If trees stay small → a **custom recursive tree** or the **shadcn community tree-view** is lighter and fully ours to style.
- **Heat-map coloring** — how easily can we tint each row by `colorFor(node)`? (Custom/shadcn = trivial; libraries = via row renderers.)
- **Hover/select + keyboard a11y** — must cleanly emit `onHoverNode`/`onSelectNode` and be keyboard-navigable.

Record the decision in `file-tree/README.md`. Nothing outside this folder learns the answer.

### 7.5 View → component → build order

Aligns with the dev plan increments; "Core" = build in the prototype now, "Later" = represent/mock now, realize later.

| View | Component | Library | Priority |
|---|---|---|---|
| Login (mocked GitHub) | `login/page` | shadcn Button/Card | **Core** |
| Connect repo (URL / private) | `connect-repo` | shadcn Input/Tabs/Dialog | **Core** |
| Projects list (vertical) | `project-list` | shadcn Card list | **Core** |
| Top nav (branch + scan + SHA) | `dashboard-topnav`, `scan-control` | shadcn Select/Button/Progress | **Core** |
| V1 Overall Health (Card A) | `overall-health-card` | shadcn Card/Badge | **Core** |
| V6→Card B Health Graph | `health-graph-card` | **shadcn Chart** | **Core** (repo scope) → node scope Later |
| V3 Refactor-First list | `refactor-first-list` | shadcn Table | **Core** |
| V2 Heat-map file tree | `file-tree` | **deferred** (§7.4) | **Core** |
| V4 Finding detail | `finding-detail-panel` | shadcn Sheet/Dialog | **Core** (actions come Later) |
| V5 Category breakdown | `category-breakdown` | **shadcn Chart** | Later |
| V8 Workspace rollup | (Projects list metrics) | shadcn Card grid | Later |

---

## 8. Dev plan

Your "convert the plan to step-by-step" ask. This is the **build order** — do the steps in sequence. It maps onto the dev plan's prototyping track (P0–P4) and increments; the calendar in that plan is unchanged, this is the *coding* sequence within it.

### Phase A — foundation, built together (do NOT split yet)
1. **§4 setup** — scaffold, add components/libs, commit, both pull.
2. **Contract types** (`lib/types`) — §6.1. Agree these with the backend member. *Freeze before splitting.*
3. **Mock layer** (`lib/mocks`) — handlers + fixtures + golden repo, incl. mocked GitHub auth and a progressing scan (§6.3).
4. **App shell** — root layout, **left rail** (`app-rail`), theme variables + heat-map/chart tokens in `globals.css`. Get `/login → /projects` navigating.
5. **One page end-to-end on mocks** — `/projects` lists `getProjects()`; click through to `/dashboard/[repoId]` rendering `getHealthReport()`.
6. **One green Playwright smoke test** — login → projects → dashboard visible. Keep it green forever.

> If you split before the shell exists you'll both edit the same layout files and conflict constantly. One foundation, built once, together.

### Phase B — split by view (parallel, low-conflict — see §9)
Build these against mocks; each is DoD-complete (§13) before moving on. Rough order (core first):

7. **Login (mocked GitHub)** + **Connect-repo** (public URL + private-repo picker) + **Projects list**.
8. **Dashboard top nav** — branch dropdown (`getBranches`) + **scan control** (`useScan`: start/poll/stop, progress) + last-checked/SHA panel.
9. **Card A — Overall Health** (+ component tests for grade/delta rendering).
10. **Card B — Health Graph** with shadcn Chart, **repo scope** (reads `report.history`).
11. **Refactor-First list** (sorting, severity badges) → clicking a row opens **Finding detail** (Sheet).
12. **Heat-map file tree** against the `FileTree` boundary — first the recursive placeholder, then **choose + install the library** (§7.4) and swap internals. Wire `onHoverNode` into the dashboard's state (even though Card B still shows repo health).

### Phase C — additional features (represent now, realize as pipelines land)
13. **Card B contextual scope** — on `hoveredNode`, re-scope Card B to that file/folder's health (fixture already carries per-node series; flip Card B to read it).
14. **Category breakdown** (V5, shadcn Chart) and **workspace rollup** metrics on the Projects list (V8).
15. **Finding actions** (Accept debt / Resolve) — optimistic UI on mocks.

### Phase D — progressive realization (P4)
16. Swap mock handlers for real API endpoints **one view at a time** as the backend ships them; flip `NEXT_PUBLIC_API_MOCKING` off per route, then globally. Re-run the same E2E — it now exercises the real backend. **No component rewrites.** (§13)

**Timebox discipline (from the dev plan):** paper/Figma passes get **two fidelity passes maximum** — Figma is a requirements instrument, not a painting. Real styling effort starts at the coded shell, where it's never wasted.

---

## 9. Splitting the work

Two people, one frontend. The trap is merge conflicts and duplicated foundation work. Avoid it by **pairing on the foundation (Phase A), then splitting cleanly by view.**

Suggested division by *type of work* so each of you goes deep on a skill:

| | **Janidu** — data-viz + tree | **Nathasha** — interaction + forms |
|---|---|---|
| Owns | Card A (Overall Health), **Card B (shadcn Chart)**, **heat-map file tree** (incl. the library decision), Category breakdown | Login (mocked GitHub), **Connect-repo** wizard, **Projects list**, **Refactor-First list**, **Finding detail** (+ actions), **scan control** |
| Also | Dashboard page assembly + the tree↔Card-B wiring (§2.3) | Top-nav assembly (branch dropdown + last-checked/SHA) |
| Skill you build | shadcn Chart, tree rendering, heat-map color mapping, data-shaping | shadcn forms, dialogs/sheets, table interactions, scan state machine |

Both contribute to **Requirements Engineering** — the point of the prototype. Every decision you make building a view ("the finding detail needs a snippet + a reason + an Accept button") *is* a dashboard-output requirement for the SRS. Keep a running `dashboard-outputs.md` as you build; it fills your SRS section for free.

**Rule to avoid conflicts:** each of you only edits files inside your own view components + your own pages. **Shared files** — `globals.css`, `app-rail.tsx`, `lib/types`, and the `FileTree` prop contract — change only via a PR the other reviews. If a shared type needs to change, say so in chat first.

---

## 10. Tooling and theming

*Can I watch UI/color changes interactively in VS Code?* Yes — three layers.

### 10.1 The always-on loop: Fast Refresh + browser
Next.js **Fast Refresh** is built in. Run `pnpm dev`, open `localhost:3000`, and every save updates the browser in ~200ms **without losing component state**. Put editor and browser side by side — this *is* your live preview; no plugin needed for the basic loop.

### 10.2 Essential VS Code extensions (agree the list so both machines match)

| Extension | What it does for you |
|---|---|
| **Tailwind CSS IntelliSense** (official) | Autocompletes Tailwind classes and **shows a color swatch inline** as you type `bg-`, `text-`. Hover any class to see resolved CSS. The big one. |
| **Color Highlight** | Renders a live color chip next to any hex/hsl value in CSS — so a heat-map or `--primary` value shows its actual color right there. |
| **Prettier** + **ESLint** | Format-on-save + catch mistakes. Set `"editor.formatOnSave": true`. |
| **ES7+ React snippets** | `rafce` scaffolds a component in one keystroke. |
| **Auto Rename Tag** + **Error Lens** | Rename JSX tags in pairs; show errors inline. |
| **Playwright Test for VSCode** (official) | Run/debug E2E from the gutter; record new tests by clicking through the app. |

### 10.3 Interactive theme design (the "watch colors change" tool)
shadcn themes are **CSS variables** in `globals.css` (`--primary`, `--background`, `--destructive`, plus your severity + heat-map tokens). Change one and every component — **including shadcn Charts, since they read those variables** — re-themes on save. To *design* the palette interactively:

- **TweakCN** (`tweakcn.com`) — visual editor over real shadcn components; drag color/radius/typography and watch everything change, then **export the CSS variables** into `globals.css`. Exactly the interactive experience you asked about.
- **Browser DevTools** — live-edit a CSS variable on the running app before committing it.

**Recommended workflow:** design the palette once in TweakCN → paste into `globals.css` → thereafter tweak individual values in-editor with Color Highlight + Fast Refresh. You almost never hardcode a color; you change a variable and the app (and charts, and heat map) follow.

---

## 11. Design quality

Because the prototype becomes the product, invest a little so it doesn't look auto-generated. A generic dashboard undercuts the "clean, low-noise, actionable" story that is your whole pitch against SonarQube.

**Define a tiny token system up front** (in `globals.css`, documented in one paragraph):
- **Palette:** 4–6 named values — background, surface/card, foreground/text, one brand accent, plus your **semantic severity colors** (critical/high/medium/low → red/orange/amber/slate). These do real work: they drive the finding badges *and* the **heat-map file-tree coloring** (`healthColor()`), so choose them for clarity, not decoration.
- **Type:** a display face for headings and a clean body/UI face; a deliberate scale. Don't leave everything at shadcn's default.
- **One signature element:** the thing a viewer remembers. For this product, make it the **heat-map file tree** (the single visual that says "here's what your codebase's health looks like at a glance") together with the **Overall Health card**.

**Avoid the generic-AI-dashboard tells:** the default cream-plus-terracotta look, or near-black-plus-one-acid-color — both read as "generated." Pick a calm, legible, data-first developer palette deliberately.

**Copy is design material.** Name things by what the user does: the button is "Accept debt," and its toast says "Debt accepted." An empty state ("No repositories yet — connect one to see its health") is a prompt to act. Consistency here makes the tool feel trustworthy to a non-technical business owner (one of your two personas).

Keep the quality floor without fuss: responsive down to laptop width, visible keyboard focus, readable contrast on the severity/heat-map colors.

---

## 12. Testing

Test the frontend alongside development from the start — **proportionately**: nothing during paper/Figma, then tests grow with components. Three layers, all against the **same MSW mocks**, so no backend is ever required.

### 12.1 Component tests — Vitest + React Testing Library
Test each presentational component with fake props. Fast, isolated, run on every save.

```typescript
// overall-health-card.test.tsx
import { render, screen } from "@testing-library/react";
import { OverallHealthCard } from "@/components/dashboard/overall-health-card";

test("shows grade A for a healthy repo", () => {
  render(<OverallHealthCard score={88} grade="A" delta={3} />);
  expect(screen.getByText("A")).toBeInTheDocument();
  expect(screen.getByText(/\+3 since last scan/)).toBeInTheDocument();
});
```

Write these for components with logic: health card (grade/delta), refactor list (sorting/severity), file tree (`healthColor` mapping), scan control (idle/running/stop). Skip trivial layout wrappers.

### 12.2 Wire MSW into the test runner
In `test/vitest.setup.ts`, start the MSW **Node server** before tests and reset between them. Any component/hook that fetches gets the mock response — the *same handlers* from `lib/mocks/handlers.ts` you use in dev. One source of truth across dev and tests.

### 12.3 E2E — Playwright against the mocked app
Run the Next.js dev server with mocking enabled; Playwright drives a real browser through real journeys — no FastAPI, no database.

```typescript
// e2e/dashboard.spec.ts
import { test, expect } from "@playwright/test";

test("user connects a repo and views its dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /sign in with github/i }).click();
  await page.getByRole("link", { name: /demo-repo/i }).click();     // from the projects list
  await expect(page.getByText("Code Health")).toBeVisible();
  await page.getByRole("row").filter({ hasText: "hardcoded" }).click();
  await expect(page.getByText(/hardcoded Stripe API key/)).toBeVisible();  // detail panel opens
});
```

Two ways to feed Playwright its data — pick per test:
- **Reuse MSW** (preferred): the running dev app already serves mocks, so E2E exercises the exact same fake API as dev.
- **`page.route()`** for a test that needs a *different* response (error state, empty repo, a stuck scan). Good for deterministic loading/empty/error states.

Start with **one happy-path E2E early** (login → projects → dashboard) and keep it green. Then add: run+stop a scan, open a finding, switch a branch, accept a TODO. These map to the dev plan's journey "login → connect → scan → triage → accept."

### 12.4 What to test when
| When | Add |
|---|---|
| Each component built (Phase B) | 1–3 component tests for its logic |
| End of Phase A | 1 Playwright happy-path (login → projects → dashboard) |
| Scan control done | E2E: start scan → progress shows → Stop returns to idle |
| Finding actions (Phase C) | E2E: accept a finding → it leaves the list |

Don't chase 100% coverage on a prototype. Cover the **logic and the critical journeys** — that's what protects you during the swap-to-real phase.

---

## 13. DoD and extend

### Definition of Done for a prototype view
A view is "done" when:
1. It renders from **contract-shaped mock data** (not hardcoded JSX values).
2. It handles **loading, empty, and error** states (use shadcn `Skeleton` for loading).
3. It has component tests for any logic.
4. It's responsive to laptop width and keyboard-navigable.
5. The other person has reviewed the PR.

### How the prototype becomes the final GUI (the P4 swap)
When the backend ships an endpoint, for that one view:
1. Confirm the real endpoint returns data matching the **contract type** (if not, that's a backend fix — the type is the agreement).
2. Turn off mocking for that route (or globally once all endpoints exist): remove/disable the MSW handler.
3. Point the API client at the real base URL via env var.
4. **The component and its tests do not change.** Re-run the E2E — it now exercises the real backend.

**Two specific "later" swaps already designed for:**
- **Real GitHub sign-in.** Replace the mocked `/api/auth/github` with real OAuth (Auth.js in Next.js *or* the FastAPI backend). The login screen and the private-repo picker keep their props; only the data source changes.
- **Card B contextual health.** The tree already emits `onHoverNode`; flip Card B from "always repo history" to "hovered node's history." Backend adds per-node series; the fixture already models it, so the UI is proven before the pipeline exists.

That is the entire migration. No rewrite, because the prototype was the product all along.

---

## 14. Checklist

**This week (both of you, together — Phase A):**
- [ ] Run §4 setup once, commit, both pull.
- [ ] Agree the `lib/types` contract *with the backend member* (Repo, Branch, ScanStatus, TreeNode, Finding, HealthReport).
- [ ] Build the MSW mock layer + golden-repo fixture (incl. mocked GitHub auth + a progressing scan + a varied-health tree).
- [ ] Build the app shell: root layout, **left rail** (Projects · Dashboard), theme + heat-map/chart tokens in `globals.css`.
- [ ] Design the palette in TweakCN → paste into `globals.css`.
- [ ] Get `/login → /projects → /dashboard/[repoId]` rendering mock data end-to-end + one Playwright smoke test green.

**Then split (§9 — Phase B):**
- [ ] Janidu: Overall Health card, Health Graph card (shadcn Chart), **heat-map file tree** (+ library decision, recorded in `file-tree/README.md`), category breakdown; dashboard page assembly + tree↔Card-B wiring.
- [ ] Nathasha: login (mocked GitHub), connect-repo wizard, projects list, refactor-first list, finding detail + actions, scan control.
- [ ] Each view: mock-data-driven, loading/empty/error states, component tests, PR-reviewed.
- [ ] Keep `dashboard-outputs.md` updated as you build — it's your SRS section.

**Guardrails:**
- Only edit files in your own view/page folders; shared files (`globals.css`, `app-rail.tsx`, `lib/types`, `FileTree` props) change via reviewed PR.
- **Charts:** only shadcn Chart (`ChartContainer`) — never import Recharts directly.
- **File tree:** the library lives only inside `file-tree.tsx`; the boundary props don't change to suit a library.
- Never hardcode a color — change a CSS variable.
- Never hardcode display data — it comes from a mock handler shaped like the contract.
- One happy-path E2E stays green at all times.

---

*End of v1.1. Bring this to the next team session. Freeze the `lib/types` contract with the backend member first — everything else depends on it.*
