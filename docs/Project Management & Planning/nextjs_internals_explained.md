# Next.js Internals — What You Actually Need Before Phase 3

A plain-language explanation of **the code that is already sitting in `apps/web`**.
Every example below is copied from *your* files, not from a tutorial.

Read this once, slowly. After it, nothing in Phase 3–12 should feel like magic.

- Architecture decisions → [frontend_prototype_plan.md](./frontend_prototype_plan.md)
- Step-by-step commands → [frontend_build_stepbystep.md](./frontend_build_stepbystep.md)
- **This file** → *why the scaffold looks like this, and what each piece does*

> **Looking for "does Next.js replace the backend?"** — that's **§12**, at the end.
> It explains what `apps/api`, `apps/ml` and `apps/web` each are, why we always go
> through the FastAPI API instead of reading the database from Next.js, and why the
> "skipping the API is faster" argument doesn't apply to this project. Every
> abbreviation used there is defined in **§12.0**.

---

## 1. The one-paragraph mental model

Next.js is a **React framework**. React alone can only draw components in a browser.
Next.js adds four things on top:

1. **Routing from folders** — a folder becomes a URL. No router config file.
2. **Server rendering** — your components run on the *server* first, producing HTML, so the user sees content immediately instead of a blank page.
3. **A build system** — it bundles TypeScript, CSS and images without you configuring anything.
4. **A dev server** — `pnpm dev` gives you instant refresh when you save.

> **The single sentence to remember:**
> In the App Router, **the folder structure *is* the routing config**, and **components run on the server unless you say otherwise**.

---

## 2. Your folder tree, annotated

This is your real tree today (ignoring `node_modules` and `.next`):

```
CodeSage-AI/
├─ apps/
│  ├─ api/                     ← empty (backend, later)
│  ├─ ml/                      ← empty (ML service, later)
│  └─ web/                     ← THE FRONTEND. Everything below is here.
│     │
│     ├─ package.json          ← dependency list + the `pnpm dev/build` commands
│     ├─ pnpm-lock.yaml        ← exact versions (never edit by hand)
│     ├─ pnpm-workspace.yaml   ← pnpm settings for this folder
│     │
│     ├─ tsconfig.json         ← TypeScript rules + the `@/*` import shortcut
│     ├─ next.config.ts        ← Next.js settings (currently empty — normal)
│     ├─ postcss.config.mjs    ← plugs Tailwind into the CSS pipeline
│     ├─ eslint.config.mjs     ← lint rules (Phase 3 touches this)
│     ├─ components.json       ← settings the `shadcn add` CLI reads
│     ├─ next-env.d.ts         ← auto-generated types. DO NOT EDIT.
│     │
│     ├─ public/               ← files served as-is at the URL root
│     │  ├─ next.svg           ←   → http://localhost:3000/next.svg
│     │  ├─ vercel.svg
│     │  ├─ file.svg  globe.svg  window.svg
│     │
│     ├─ src/
│     │  ├─ app/               ← ROUTING LIVES HERE. Folders = URLs.
│     │  │  ├─ layout.tsx      ←   the shell wrapped around every page
│     │  │  ├─ page.tsx        ←   the page at "/"
│     │  │  ├─ globals.css     ←   Tailwind import + all theme colors
│     │  │  └─ favicon.ico     ←   browser tab icon (auto-detected)
│     │  │
│     │  ├─ components/        ← reusable UI. NOT routes.
│     │  │  └─ ui/
│     │  │     └─ button.tsx   ←   the only shadcn component so far
│     │  │
│     │  └─ lib/               ← plain helper functions, no UI
│     │     └─ utils.ts        ←   exports `cn()` — used by every component
│     │
│     └─ .next/                ← BUILD OUTPUT. Generated. Never edit, never commit.
│
└─ docs/                       ← this file lives here
```

### The three rules that explain the whole tree

| Rule | Meaning |
|---|---|
| Anything inside `src/app/` **is a route** | `app/scan/page.tsx` → `/scan` |
| Anything inside `src/components/` **is not a route** | it's a Lego brick a page imports |
| Anything inside `public/` **is a raw file** | `public/logo.png` → `/logo.png` |

That's it. When you wonder "where do I put this file?", ask: *is it a URL, a brick, or a raw asset?*

---

## 3. Every file, explained

### `package.json` — the project's ID card

Two parts matter.

**Scripts** — the commands you can run:
```json
"scripts": {
  "dev":   "next dev",     // dev server + live refresh  → you use this 99% of the time
  "build": "next build",   // production build
  "start": "next start",   // run the production build
  "lint":  "eslint"        // check code quality
}
```
`pnpm dev` literally means "run the `dev` script from package.json".

**Dependencies** — what's installed and why:

| Package | Why it's here |
|---|---|
| `next`, `react`, `react-dom` | the framework itself |
| `tailwindcss`, `@tailwindcss/postcss` | the styling system |
| `clsx` + `tailwind-merge` | power the `cn()` helper (see §7) |
| `class-variance-authority` | lets one component have variants (`variant="outline"`) |
| `radix-ui` | unstyled accessible primitives that shadcn builds on |
| `shadcn` | the CLI that copies component source into your repo |
| `@hugeicons/react` | your icon set |
| `tw-animate-css` | animation utility classes |

> `dependencies` ship to the browser. `devDependencies` (TypeScript, ESLint, types) are build-time only.

---

### `tsconfig.json` — the one line you'll use daily

Most of it you can ignore. **This part you will use every single day:**

```json
"paths": { "@/*": ["./src/*"] }
```

It means `@/` = `src/`. So instead of fragile relative paths:

```ts
import { cn } from "../../../lib/utils";   // ❌ breaks when you move the file
import { cn } from "@/lib/utils";          // ✅ always works
```

Also worth knowing: `"strict": true` — TypeScript will refuse to let you use a value that might be `undefined` without checking it. It feels annoying at first; it prevents real bugs.

---

### `next.config.ts` — empty, and that's correct

```ts
const nextConfig: NextConfig = { /* config options here */ };
```

You only add things here for special needs (external image domains, redirects, etc.). An empty config means "all defaults" — which is right for now.

---

### `postcss.config.mjs` — how CSS gets processed

```js
const config = { plugins: { "@tailwindcss/postcss": {} } };
```

PostCSS is a CSS pipeline. This says: *"run every CSS file through Tailwind."*
That's the step that turns `class="flex gap-4"` in your JSX into real CSS rules.

> **Tailwind v4 note:** there is **no `tailwind.config.js`** in your project. Tailwind v4 moved configuration *into the CSS file* (`globals.css`, the `@theme` block). That's why `components.json` has `"config": ""` — an empty string, on purpose. If you follow an old tutorial that tells you to edit `tailwind.config.js`, that tutorial is for v3.

---

### `components.json` — instructions for the shadcn CLI

You never import this. Only `pnpm dlx shadcn@latest add <name>` reads it:

```json
{
  "style": "radix-mira",              // visual style you chose in Phase 1
  "rsc": true,                        // generate Server Components by default
  "tailwind": { "css": "src/app/globals.css", "baseColor": "neutral" },
  "iconLibrary": "hugeicons",         // ← your project uses hugeicons, NOT lucide
  "aliases": { "ui": "@/components/ui", "utils": "@/lib/utils" }
}
```

So when you run `shadcn add card`, the CLI knows: write it to `src/components/ui/card.tsx`, make it import `cn` from `@/lib/utils`, and use hugeicons.

> ⚠️ Because `iconLibrary` is `hugeicons`, ignore the `pnpm add lucide-react` line in Phase 2.2 of the build guide — your components import from `@hugeicons/react` instead. Two icon libraries would just be dead weight.

---

### `next-env.d.ts` — do not touch

```ts
/// <reference types="next" />
// NOTE: This file should not be edited
```
Auto-generated type hints so TypeScript understands Next.js imports. Next regenerates it. Leave it alone.

---

### `src/app/globals.css` — the design system

Three sections:

**1. Imports**
```css
@import "tailwindcss";        /* all Tailwind utilities */
@import "tw-animate-css";     /* animation utilities   */
@import "shadcn/tailwind.css";
```

**2. `@theme inline` — names → variables**
```css
@theme inline {
  --color-background: var(--background);
  --color-primary:    var(--primary);
  --radius-md:        calc(var(--radius) * 0.8);
}
```
This is what makes `bg-background`, `text-primary`, `rounded-md` exist as classes.
**Pattern:** declaring `--color-primary` creates `bg-primary`, `text-primary`, `border-primary`, etc.

**3. `:root` — the actual colors**
```css
:root {
  --background: oklch(1 0 0);        /* white */
  --foreground: oklch(0.145 0 0);    /* near-black */
  --primary:    oklch(0.205 0 0);
}
```

`oklch(lightness chroma hue)` — a modern color format. `oklch(1 0 0)` = white, `oklch(0 0 0)` = black. Its advantage: changing lightness doesn't shift the perceived color, so light/dark variants look consistent.

Further down there's a `.dark { ... }` block that overrides these. **That's the entire dark mode mechanism:** add class `dark` to `<html>`, and every variable swaps — no component changes needed.

> This is the file Phase 4 (Theming) edits. You change colors *here*, once, and every component follows.

---

### `src/app/layout.tsx` — the shell around everything

This is the **root layout**. It's mandatory, and it renders on every single page.

```tsx
export const metadata: Metadata = {
  title: "Create Next App",              // ← TODO: change to "Code Sage AI"
  description: "Generated by create next app",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("h-full", "antialiased", geistSans.variable, ...)}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

Four things happening:

1. **It renders `<html>` and `<body>` yourself.** No `index.html` exists in Next.js — this *is* it.
2. **`children` is the page.** When you visit `/`, Next puts `page.tsx`'s output into `{children}`. Navigate to `/scan`, and only `{children}` changes — the layout is **not** re-rendered. That's why nav bars keep their state between pages.
3. **`metadata`** — Next reads this export and writes the `<title>` / `<meta>` tags. (Rename these two strings; it's a 10-second fix that stops "Create Next App" showing in your demo.)
4. **Fonts:**
   ```tsx
   const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
   ```
   `next/font` downloads the font **at build time** and self-hosts it — no Google request at runtime (faster + private). It gives back `inter.variable`, a class that sets the CSS variable `--font-sans`. Attach it to `<html>`, and `globals.css`'s `--font-sans: var(--font-sans)` connects it to the `font-sans` utility class.

**The chain:** `next/font` → CSS variable on `<html>` → `@theme` mapping → `font-sans` class works everywhere.

---

### `src/app/page.tsx` — the page at `/`

```tsx
export default function Home() {
  return <div className="flex flex-col ...">...</div>;
}
```

Rules for every `page.tsx`:
- It **must** have a `export default` function.
- Whatever it returns becomes `{children}` inside the layout.
- The function name (`Home`) is for you, not Next — only `default` matters.

It uses `next/image`:
```tsx
<Image src="/next.svg" alt="Next.js logo" width={100} height={20} priority />
```
`<Image>` instead of `<img>` gives automatic optimization, correct sizing, and lazy loading. `width`/`height` are **required** (they reserve space so the page doesn't jump while loading). `priority` = load this immediately, don't lazy-load.

Note `src="/next.svg"` — that leading `/` means `public/`.

---

### `src/lib/utils.ts` — the small file used by everything

```ts
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Tiny, but you'll use it in nearly every component. It does two jobs:

**Job 1 — `clsx`: conditional classes.**
```tsx
cn("p-4", isActive && "bg-blue-500", isError ? "text-red-500" : "text-gray-500")
// isActive=true, isError=false → "p-4 bg-blue-500 text-gray-500"
```
`false`, `undefined` and `null` are dropped silently.

**Job 2 — `tailwind-merge`: resolve conflicts, last one wins.**
```tsx
clsx("p-4", "p-8")    // → "p-4 p-8"   ❌ CSS picks unpredictably
cn("p-4", "p-8")      // → "p-8"       ✅ later wins, as you'd expect
```

This is what makes component overrides work:
```tsx
<Button className="w-full" />   // your class beats the built-in default
```
Without `cn`, passing a `className` to override a component would fight with its internal classes.

---

### `src/components/ui/button.tsx` — the shadcn pattern

Worth understanding because **every** shadcn component follows this shape.

```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md ...",   // 1. base classes
  {
    variants: {                                              // 2. the options
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline: "border-border hover:bg-input/50",
        ghost:   "hover:bg-muted hover:text-foreground",
        // ...
      },
      size: { default: "h-7 px-2", sm: "h-6 px-2", lg: "h-8 px-2.5", icon: "size-7", ... },
    },
    defaultVariants: { variant: "default", size: "default" },  // 3. fallbacks
  }
);
```

`cva` (class-variance-authority) = "a lookup table from props to CSS classes".
`buttonVariants({ variant: "outline", size: "sm" })` returns base + outline + sm classes joined.

Then the component:

```tsx
function Button({ className, variant = "default", size = "default", asChild = false, ...props }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
```

Three ideas here:

- **`...props`** — collects every other prop (`onClick`, `disabled`, `type`, `aria-label`) and forwards them with `{...props}`. This is why `<Button onClick={...}>` works even though `onClick` is never named.
- **`asChild`** — swaps the rendered element for its child. Use it to make a link *look* like a button while staying a real `<a>` (correct for accessibility and right-click → open in new tab):
  ```tsx
  <Button asChild><Link href="/scan">Scan</Link></Button>
  ```
- **`export { Button, buttonVariants }`** — named exports, not default. So you import with braces: `import { Button } from "@/components/ui/button"`.

Notice the classes use **theme names** (`bg-primary`, `border-border`), never raw colors like `bg-blue-500`. That's why retheming in Phase 4 restyles the whole app at once.

---

### `.next/` — ignore it

Build output: compiled JS, caches, manifests. Generated by `pnpm dev` / `pnpm build`.
Never edit it, never commit it (already in `.gitignore`).
**If something behaves impossibly weirdly, deleting `.next/` and restarting fixes it surprisingly often.**

---

## 4. How a page actually renders

You type `http://localhost:3000/` and press Enter:

```
1. Next matches the URL "/" to  src/app/page.tsx
2. It finds the layouts above it →  src/app/layout.tsx
3. On the SERVER it runs:  RootLayout({ children: <Home /> })
4. React turns that into HTML text
5. Browser receives real HTML → user sees content immediately
6. JavaScript loads afterward and makes interactive parts work ("hydration")
```

Nested example, once you have more pages:

```
app/layout.tsx                 → wraps everything
  app/scan/layout.tsx          → wraps everything under /scan
    app/scan/[id]/page.tsx     → the actual page at /scan/123
```

Layouts nest like Russian dolls, outermost first.

---

## 5. Server vs Client Components — the most important concept

**Every component in `src/app/` is a Server Component by default.** It runs on the server, produces HTML, and its JavaScript is never sent to the browser.

That means, by default, **these do not work**:
- `useState`, `useEffect`, or any React hook
- `onClick`, `onChange`, or any event handler
- `window`, `document`, `localStorage`

To opt a file into the browser, put this as the **very first line of the file**:

```tsx
"use client";

import { useState } from "react";

export function ScanButton() {
  const [loading, setLoading] = useState(false);
  return <Button onClick={() => setLoading(true)}>Scan</Button>;
}
```

### How to decide

| Use a **Server** Component when | Use a **Client** Component (`"use client"`) when |
|---|---|
| Just displaying data | You need `useState` / `useEffect` |
| Fetching from a database or API | You need `onClick` / form handling |
| Reading secrets or env keys | You use a browser-only library (charts, animations) |
| **Default — start here** | Only when you actually need it |

### The pattern that keeps things fast

Don't mark a whole page `"use client"` because one button needs state. Instead, keep the page a Server Component and extract the interactive bit:

```tsx
// app/scan/page.tsx  — Server Component (no "use client")
import { ScanButton } from "@/components/scan-button";   // ← this one is a client component

export default function ScanPage() {
  return (
    <div>
      <h1>Scan a repository</h1>       {/* stays on the server */}
      <ScanButton />                    {/* only this ships JS */}
    </div>
  );
}
```

> `"use client"` is contagious downward: everything a client component imports also becomes client-side. So push it **as far down the tree as you can**.

**Rule of thumb for CodeSage:** page shells, headers, static panels → Server. Buttons, forms, the graph view, tabs, anything with `useState` → Client.

> **Next question, answered in §12:** *"If my component runs on the server, can it just read the database itself?"* Technically yes — and that's why people call Next.js "full-stack". But **Code Sage AI deliberately does not do that.** §12 explains the options, which one this project picked, and why.

---

## 6. Routing = folders

Once you start Phase 6, this is the whole routing system:

| File you create | URL it produces |
|---|---|
| `app/page.tsx` | `/` |
| `app/scan/page.tsx` | `/scan` |
| `app/scan/[id]/page.tsx` | `/scan/anything` (dynamic) |
| `app/(dashboard)/settings/page.tsx` | `/settings` — `(parens)` group files without adding to the URL |

Special filenames Next recognizes inside any route folder:

| File | Purpose |
|---|---|
| `page.tsx` | the page itself — **required** for the folder to be a URL |
| `layout.tsx` | persistent shell around this folder and everything under it |
| `loading.tsx` | shown automatically while the page loads |
| `error.tsx` | shown automatically if the page throws (must be `"use client"`) |
| `not-found.tsx` | the 404 page |
| `route.ts` | an API endpoint instead of a page |

A dynamic page receives its URL segment as a prop:
```tsx
export default async function ScanDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;      // Next 15+: params is a Promise, must await
  return <h1>Scan {id}</h1>;
}
```

Navigate with `<Link>`, never `<a>`, for internal links — `<a>` triggers a full page reload and loses all state:
```tsx
import Link from "next/link";
<Link href="/scan">Scan</Link>
```

---

## 7. The styling chain, end to end

Trace one class, `bg-primary`, all the way through:

```
globals.css  :root { --primary: oklch(0.205 0 0); }        the raw color
     ↓
globals.css  @theme { --color-primary: var(--primary); }    registers the name
     ↓
Tailwind generates the utility class                        .bg-primary { background: var(--primary) }
     ↓
button.tsx   cva base: "bg-primary text-primary-foreground" component uses the name
     ↓
cn() merges it with any className you pass                  your override wins
     ↓
<button class="... bg-primary ...">                         final HTML
```

**Why this matters:** to restyle the entire app, you change **one line** in `:root`. Nothing else. That's the payoff for never writing `bg-blue-500` directly.

Also: `--primary-foreground` is the text color that goes *on top of* `--primary`. shadcn pairs them everywhere — `bg-X text-X-foreground` — so contrast is always correct.

---

## 8. JavaScript / TypeScript you actually need

Only the parts this project uses. Examples are from your files.

### 8.1 `import` / `export`

```ts
// DEFAULT export — one per file, imported without braces, name is yours to choose
export default function Home() { }
import Home from "./page";

// NAMED exports — many per file, imported with braces, name must match exactly
export function cn(...) { }
export { Button, buttonVariants };
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
```

**Pages and layouts must use `export default`.** Regular components conventionally use named exports. If you get *"The default export is not a React Component"*, you wrote `export function Page` instead of `export default function Page`.

### 8.2 Destructuring — how props arrive

```tsx
function Button({ className, variant, size, ...props }) { }
```
means "take the props object, pull out these three by name, and put everything else into `props`".

Same for arrays and objects:
```ts
const [loading, setLoading] = useState(false);   // array destructuring
const { id, name } = user;                       // object destructuring
```

### 8.3 Spread `...` — two meanings, opposite directions

```tsx
function Button({ className, ...props }) {   // COLLECT the rest into `props`
  return <button {...props} />;               // SPREAD them back out
}
```
Also handy for copying:
```ts
const updated = { ...finding, status: "resolved" };   // copy + override one field
const all = [...oldFindings, newFinding];              // copy + append
```

### 8.4 Arrow functions

```ts
function add(a, b) { return a + b; }     // classic
const add = (a, b) => a + b;             // arrow, implicit return
const log = () => { console.log("hi"); } // arrow with a body
```
You'll write them constantly as event handlers: `onClick={() => setOpen(true)}`.

⚠️ `onClick={setOpen(true)}` calls it *immediately during render* — an infinite loop. It must be `onClick={() => setOpen(true)}`.

### 8.5 Template literals

```ts
const msg = `Found ${count} issues in ${file}`;   // backticks, not quotes
```

### 8.6 `.map()` — rendering lists

The single most-used pattern in React:

```tsx
{findings.map((finding) => (
  <FindingCard key={finding.id} finding={finding} />
))}
```

**`key` is required** and must be **stable and unique** — use a real id, not the array index (index breaks when the list is sorted or filtered).

Also useful: `.filter()` to narrow, `.find()` for one item:
```ts
const critical = findings.filter((f) => f.severity === "critical");
const target   = findings.find((f) => f.id === selectedId);
```

### 8.7 Conditional rendering

```tsx
{isLoading && <Spinner />}                        // render only if true
{error ? <ErrorBox /> : <Results />}              // either / or
{findings.length === 0 && <EmptyState />}
```

⚠️ Common trap: `{count && <List />}` renders a literal **`0`** when count is 0. Use `{count > 0 && <List />}`.

### 8.8 Optional chaining `?.` and nullish coalescing `??`

```ts
const name = user?.profile?.name;        // undefined instead of a crash
const count = findings?.length ?? 0;     // 0 if null/undefined
```
`??` differs from `||`: `0 ?? 5` → `0`, but `0 || 5` → `5`. Use `??` when `0` or `""` are valid values.

### 8.9 `async` / `await`

```tsx
export default async function ScanPage() {         // Server Components can be async!
  const res = await fetch("http://localhost:8000/api/scans");
  const data = await res.json();
  return <ScanList scans={data} />;
}
```
`await` pauses until the promise resolves. Wrap in `try/catch` for failures. This is how Phase 12 swaps the mock backend for the real one.

### 8.10 JSX rules

```tsx
return (
  <div className="p-4">          {/* className, NOT class */}
    <label htmlFor="url">URL</label>   {/* htmlFor, NOT for */}
    <input onChange={handleChange} />  {/* camelCase events */}
    <br />                             {/* self-close every empty tag */}
    {/* this is a JSX comment */}
    <p>{userName}</p>                  {/* {} escapes into JavaScript */}
  </div>
);
```
- **One root element.** Need siblings? Wrap in a fragment: `<>...</>`.
- **Components must start with a capital letter.** `<button>` = HTML tag; `<Button>` = your component.

### 8.11 TypeScript — the parts you'll meet

```ts
// Annotate values
const count: number = 5;
const items: string[] = ["a", "b"];

// Describe object shapes (this is your Phase 5 "contract")
type Finding = {
  id: string;
  severity: "low" | "medium" | "high" | "critical";   // union: only these 4 strings
  file: string;
  line?: number;                                       // ? = optional
};

// Typed props
function FindingCard({ finding }: { finding: Finding }) { }
```

Three you'll see in shadcn components:
```ts
Readonly<{ children: React.ReactNode }>       // can't be modified
React.ComponentProps<"button">                // every valid <button> prop, for free
VariantProps<typeof buttonVariants>           // the variant/size options, derived automatically
```

`React.ReactNode` = "anything renderable": JSX, a string, a number, an array of those, or nothing.

> Phase 5 is exactly this: writing `type Finding`, `type Scan`, etc. once, so every component and the mock API agree on the same shape. Do it carefully — it's what makes "static data → MSW → real API" three easy swaps instead of three rewrites.

---

## 9. Things that confuse people early

| Question | Answer |
|---|---|
| Where's `index.html`? | Doesn't exist. `layout.tsx` renders `<html>` and `<body>`. |
| Where's the router config? | Doesn't exist. Folders in `src/app/` *are* the routes. |
| Where's `tailwind.config.js`? | Not in Tailwind v4. Config lives in `globals.css` (`@theme`). |
| Can I edit `.next/`? | No — regenerated on every build. Delete it if things get strange. |
| Can I edit `pnpm-lock.yaml`? | No. It's how you and your teammate get identical versions. Commit it. |
| Do I commit `node_modules/`? | Never. `pnpm install` recreates it from the lockfile. |
| `useState` gives an error? | Add `"use client";` as the first line of that file. |
| Style change not showing? | Hard-refresh (Ctrl+Shift+R). If it persists, delete `.next/` and restart. |
| Import can't be found? | Use `@/` (= `src/`), and check the file's actual casing — Windows is forgiving, deployment servers are not. |

---

## 10. Quick self-check before Phase 3

You're ready if you can answer these without scrolling up:

1. Which file do I create to make the URL `/scan` exist?
2. What one line do I add to use `useState` in a component?
3. What does `cn("p-4", "p-8")` return, and why not both?
4. Where do I change the app's primary color?
5. Why does `<Button className="w-full">` override the built-in width?
6. What's the difference between `import Button from` and `import { Button } from`?

<details>
<summary>Answers</summary>

1. `src/app/scan/page.tsx` with a `export default` function.
2. `"use client";` as the very first line of the file.
3. `"p-8"` — `tailwind-merge` drops the conflicting earlier class so the last one wins predictably.
4. `src/app/globals.css`, the `--primary` variable in `:root` (and its `.dark` counterpart).
5. Because `Button` runs its classes through `cn()`, which merges yours last.
6. Default export vs named export — `button.tsx` uses `export { Button }`, so it needs braces.
</details>

---

## 11. Two things to fix before you start Phase 3

Small, and cheap to do now:

**a) Phase 2 isn't fully done.** `src/components/ui/` contains only `button.tsx`. Phase 3's smoke test and Phases 6–7 assume the rest exist. Run:
```powershell
pnpm dlx shadcn@latest add card badge table tabs dialog sheet select skeleton sonner tooltip separator input progress sidebar navigation-menu chart
```
Skip `pnpm add lucide-react` from Phase 2.2 — your `components.json` is set to **hugeicons**, which is already installed.

**b) The test libraries aren't installed yet.** Phase 3 configures Vitest, and none of these are in `package.json` yet:
```powershell
pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test msw
pnpm exec playwright install
pnpm exec msw init public --save
```

**Optional 30-second win:** change `title` and `description` in [layout.tsx](../../apps/web/src/app/layout.tsx#L18-L21) from *"Create Next App"* to your real project name, so demos and browser tabs don't say the wrong thing.

---

## 12. Where does the data actually come from?

Once §5 clicks, a bigger question arrives:

> *"People say Next.js is **full-stack**. My component already runs on the server. So can it just read the database directly? Do we even need a separate backend? And I heard that's much faster than calling an API."*

Every part of that is worth taking seriously, because **every part of it is true in general and wrong for this project**. This section explains the options, states what Code Sage AI decided, and gives the reasoning so you can defend it in a viva or a code review.

### 12.0 Words you'll meet in this section

Defined once here, and again inline the first time each appears — so you can skim this table or skip it and read straight through.

**General web terms**

| Term | Stands for | Plain meaning |
|---|---|---|
| **API** | Application Programming Interface | A defined way for one program to ask another program for something. Here it means a set of web addresses (`/api/projects`) a program can call. |
| **REST** | Representational State Transfer | The common style for web APIs: `GET` to read, `POST` to create, addresses that name *things* (`/api/repos/5/branches`). Our API is a REST API. |
| **SPA** | Single-Page Application | A website that loads one mostly-empty HTML page, then builds every screen in the browser with JavaScript. Classic Create-React-App. Next.js is *not* an SPA — it sends real HTML from the server first (§4). |
| **CRUD** | Create, Read, Update, Delete | The four basic database operations. "A CRUD app" = an app whose backend mostly just saves and loads records, with little real computation. |
| **SQL** | Structured Query Language | The language you write database queries in (`SELECT * FROM scans WHERE ...`). |
| **ORM** | Object-Relational Mapper | A library that lets you use database rows as normal objects instead of writing SQL by hand. |
| **JSON** | JavaScript Object Notation | The text format APIs send data in — `{ "healthScore": 72 }`. Every response from our API is JSON. |
| **HTTP / HTTPS** | HyperText Transfer Protocol (Secure) | The protocol for web requests. HTTPS is the encrypted version — required by our SRS. |
| **CORS** | Cross-Origin Resource Sharing | The browser rule that blocks a page on one domain from calling an API on another domain unless that API explicitly allows it. Becomes relevant the moment the frontend and backend live on different addresses. |
| **BFF** | Backend For Frontend | A thin server layer that sits between the browser and the real backend, usually to hold secrets the browser shouldn't see. See §12.9. |
| **OAuth** | Open Authorization | The "Sign in with GitHub" flow — you log in at GitHub, and GitHub hands our app a token instead of your password. |
| **RLS** | Row-Level Security | A PostgreSQL feature where the *database itself* refuses to return rows belonging to another tenant. Our multi-tenancy safety net. |
| **E2E** | End-to-End | A test that drives a real browser through a real user journey, top to bottom (Playwright, Phase 11). |
| **Monorepo** | — | One Git repository holding several separate applications side by side. Ours holds three: `apps/web`, `apps/api`, `apps/ml`. |

**The Code Sage AI stack**

| Tool | What it is |
|---|---|
| **FastAPI** | A Python framework for building web APIs. This is our backend. |
| **Celery** | A Python job queue. Long work (a repo scan) is handed to a Celery **worker** so the API can answer immediately instead of freezing for two minutes. |
| **Redis** | A fast in-memory store. Celery uses it as the "inbox" where the API drops jobs and workers pick them up. |
| **PostgreSQL** | Our SQL database ("Postgres"). |
| **Lizard** | A Python tool that measures code complexity per function (how tangled the code is). |
| **PyDriller** | A Python tool that reads a repository's Git history (who changed what, how often). |
| **scikit-learn** | The Python machine-learning library our models are trained with. |
| **SATD** | Self-Admitted Technical Debt — debt the developers *admitted in a comment* (`// TODO: this is a hack`). One of our two ML models finds these. |
| **MSW** | Mock Service Worker — a library that fakes the backend by intercepting network calls in the browser. It's why the app runs today with no backend at all. |

**Two documents referenced below**

| Short name | File | Contains |
|---|---|---|
| **SRS** | [Software Requirements Specification](../Deliverables/Software_Requirements_Specification.md) | *What* the system must do. Requirements are numbered — `DC-1` is a design constraint, `S-2` a security requirement. |
| **SAD** | [Software Architecture Document](../Deliverables/Software_Architecture_Document.md) | *How* it's built. `G1`–`G8` are architectural goals. |

Those codes (`DC-1`, `S-2`, `G5`) are the project's way of pointing at one specific rule, the way a law has a clause number. When you see one below, it means *"this isn't my opinion, it's written down there."*

---

### 12.1 Your repository is three applications, not one

From the repo root you see `api`, `ml`, and `web`. Here is what each one actually is **today**:

| Folder | What's on disk right now | What it will become |
|---|---|---|
| [apps/web/](../../apps/web/) | **Real. Essentially all your code.** | The Next.js frontend — the whole user interface |
| [apps/api/](../../apps/api/) | **Completely empty (zero files).** Git cannot track an empty folder, so it exists only on your machine. | The FastAPI backend + Celery workers |
| [apps/ml/](../../apps/ml/) | Empty scaffolding — `data/`, `models/`, `notebooks/`, `src/`, held open by `.gitkeep` files | The SATD classifier and the risk model |

This is a **monorepo** (one Git repository, several separate applications). The critical point:

> These three are **different programs in different languages** that will run as **separate processes**. `apps/web` is Node.js/TypeScript. `apps/api` and `apps/ml` are Python. They are not three folders of one Next.js app — they talk to each other over the network.

---

### 12.2 The four server-side tools Next.js gives you

What you heard is correct. Next.js really does offer all four of these:

| Mechanism | Where the code runs | What it's for | Can it query a database directly? |
|---|---|---|---|
| **Server Component** *(the default, §5)* | Next's Node server, while rendering | Fetch data and produce HTML | **Yes** |
| **Server Action** — a function whose file or body starts with `"use server"` | Next's Node server, triggered by a form or button click in the browser | Save/update data without writing an endpoint | **Yes** |
| **Route Handler** — a file named `route.ts` | Next's Node server, as a real HTTP endpoint | Build your own API *inside* Next | **Yes** |
| **Client Component** — `"use client"` | The browser | `useState`, `onClick`, charts | **No** (and never should) |

And yes — the headline feature is real. A Server Component can do this:

```tsx
// This is legal Next.js. No API, no fetch, no JSON.
import { db } from "@/lib/db";

export default async function ProjectsPage() {
  const repos = await db.query("SELECT * FROM repos");   // ← straight to Postgres
  return <ProjectList repos={repos} />;
}
```

No route handler. No `fetch`. No JSON conversion. That is the "Next.js is full-stack" pitch, and for a lot of products it's genuinely the right architecture.

---

### 12.3 What Code Sage AI decided: **always the API, never direct database access**

This is not ambiguous or undecided in our documents. It's stated three separate times:

| Where | What it says |
|---|---|
| **SRS `DC-1`** (design constraint) | The stack is fixed: **Next.js** frontend, **FastAPI + Celery + Redis** backend, **PostgreSQL** database. |
| **SRS**, external interfaces | *"the frontend calls the FastAPI **REST API** (`/api/...`)"* |
| **SAD §8.2**, layer rules | *"**presentation never talks to the DB directly**; the contract is the only cross-layer shape agreement."* |

("Presentation" is the architecture word for the frontend. "The contract" is [src/lib/types/index.ts](../../apps/web/src/lib/types/index.ts) — the TypeScript types both sides must agree on, Phase 5.)

**And the code already obeys this.** Two facts you can verify yourself in thirty seconds:

- [src/lib/api/client.ts](../../apps/web/src/lib/api/client.ts) contains nothing but `fetch()` calls to `/api/...` addresses.
- Search `apps/web/src` for `route.ts` → **no results.** Search for `"use server"` → **no results.**

Not one route handler. Not one server action. That's deliberate, not an oversight.

```
What actually happens in our app:

  browser ──HTTPS──► FastAPI ──► PostgreSQL
                        │
                        └──► Redis ──► Celery worker ──► ML models

  Next's server renders HTML. It never touches the database.
```

---

### 12.4 Why — and the reason is a good one, not bureaucracy

**Because the backend work cannot be written in JavaScript.**

Look at what one scan actually involves:

1. `git clone` the branch
2. Run **Lizard** — complexity metrics per function
3. Run **PyDriller** — churn and authorship from Git history
4. Run **scikit-learn** models — the SATD classifier and the risk model

Those are Python libraries with no serious JavaScript equivalent. So **`apps/api` and `apps/ml` must exist in Python no matter what you decide about Next.js.** The backend isn't optional; the only question is whether Next *also* talks to the database.

Given the Python backend has to exist anyway, letting Next connect to Postgres too would buy you three problems:

| Problem | What goes wrong in practice |
|---|---|
| **Two definitions of every table** | Python models *and* a TypeScript ORM describing the same tables. One day someone renames a column on one side only, and the dashboard breaks in a way that's very hard to trace. |
| **Two places enforcing tenant isolation** | SAD `G1` requires **RLS** (Row-Level Security — Postgres refusing to return another workspace's rows). Every service that connects must set it up correctly on every connection. Two services = two chances to leak one customer's data to another. |
| **Scoring logic written twice** | SAD `G4` says scoring is a pure function over stored findings. Implement it in Python *and* TypeScript and eventually the number on the dashboard disagrees with the number the worker computed. Nobody will know which is right. |

> **The honest summary:** the "put everything in Next.js" architecture is *excellent* — when your backend is **CRUD** (Create/Read/Update/Delete: mostly saving and loading records) in TypeScript. Ours is a Python analysis pipeline. Different problem, different answer. This is not Next.js being worse; it's the wrong tool for *this* backend.

---

### 12.5 "But skipping the API is extremely fast" — what's true, and what isn't

The speed claim is **real, but small, and it isn't where our time goes.**

Here's the difference being described:

```
Direct database access from a Server Component:
    browser ──► Next server ──► Postgres

Our architecture:
    browser ──► FastAPI ──► Postgres
```

You save **one HTTP hop** — one network request, plus converting the data to JSON and back. When the two services sit in the same network, that's typically **a few milliseconds**. Real, and worth caring about on a page that does six database reads one after another.

Now compare against what Code Sage AI actually spends time on:

| Operation | Realistic time |
|---|---|
| A scan (clone + Lizard + PyDriller + ML) | **seconds to minutes**, on a Celery worker |
| A dashboard read | one query over an already-computed snapshot — SAD §10 calls these *"cheap reads"* |

Shaving a few milliseconds off a read that follows a 90-second scan is **noise**. The architecture is already fast where it matters, and it's fast for a *structural* reason, not a networking one:

> Scans are computed **once** and stored as an **immutable snapshot** (a saved result that never changes). Switching scoring profiles or drilling into a file re-reads that snapshot instead of re-scanning. That design decision (SAD `G4`) saves *minutes*. The API hop costs milliseconds.

And here's the part most tutorials skip:

> **Direct database access wouldn't remove FastAPI from the system.** The scan pipeline still needs it. You wouldn't be *eliminating* a layer — you'd be *adding a second program that talks to the database*. That's more architecture, not less.

---

### 12.6 "The frontend must be entirely built inside Next.js" — untangling this

Two different claims get blurred together here. Separate them and the confusion disappears.

**Claim A — true, and you already satisfy it.**
To use Server Components or Server Actions, your frontend must **be** a Next.js app running on a Node server. You cannot use them from a static export, and you cannot use them from a separate **SPA** (Single-Page Application — e.g. a Vite + React app that only runs in the browser) that merely calls Next as an API.

✅ **You already do this.** Your entire user interface lives in `apps/web`. There is no second React app anywhere. Box ticked.

**Claim B — an opinion, and not this project's.**
*"Put the backend inside Next.js too — don't split frontend and backend at all."* This is a legitimate and popular choice for products written entirely in JavaScript. It is ruled out for us by SRS `DC-1` and, more fundamentally, by Python (§12.4).

> **"Entirely inside Next.js" refers to the *frontend*, not the *whole system*.** Our split is: `apps/web` = 100% of the frontend, `apps/api` = 100% of the backend. That is a clean, conventional separation — not a compromise.

---

### 12.7 Next's server side is *not* sitting idle in your app

"We call a REST API" makes it sound like Next has been reduced to a plain SPA. It hasn't. Server-side Next is doing real work right now:

- **Every `page.tsx` is a Server Component by default.** Only two pages opt out: [projects/page.tsx](<../../apps/web/src/app/(app)/projects/page.tsx>) and [login/page.tsx](<../../apps/web/src/app/(auth)/login/page.tsx>).
- **The dashboard uses the exact split from §5.** [dashboard/[repoId]/page.tsx](<../../apps/web/src/app/(app)/dashboard/[repoId]/page.tsx>) is a **Server** Component that `await`s `params` and renders [dashboard-view.tsx](../../apps/web/src/components/dashboard/dashboard-view.tsx), which is `"use client"` and holds all the state. Server page → client view.
- **Server-rendered HTML** (§4), **`next/font`** self-hosting, **`metadata`** tags, nested layouts, route groups — all server machinery you're already using.

So the boundary is: **Next's server renders the page. FastAPI provides the data.**

---

### 12.8 Why *every* fetch in your app is client-side today

Worth understanding, because it looks like an inconsistency and isn't.

Right now **all** data fetching happens in the browser — [use-query.ts](../../apps/web/src/hooks/use-query.ts) and every hook built on it start with `"use client"`. Not one Server Component fetches anything.

**The reason is MSW, not the architecture.**

**MSW** (Mock Service Worker) fakes the backend using a **service worker** — a small script the *browser* installs, which intercepts outgoing network calls and answers them itself. That's the whole trick that lets the app run today with `apps/api` completely empty.

But a service worker lives in the browser. So:

- A **Client** Component's `fetch` → goes through the service worker → **MSW answers it** ✅
- A **Server** Component's `fetch` → runs in Node, on the server → **never sees the service worker** → escapes to the real network → fails, because there is no backend ❌

The comment in [msw-provider.tsx](../../apps/web/src/components/msw-provider.tsx#L5-L11) says exactly this. Hence: while we're mock-first (SAD `G5` — *"prototype = product"*), reads live in client hooks.

> **This is not wasted work.** At go-live (Phase 12) the hooks don't change at all — you flip `NEXT_PUBLIC_API_MOCKING` to `disabled`, set `NEXT_PUBLIC_API_BASE_URL`, and the same `fetch` calls now reach the real FastAPI. Zero component rewrites. That's the entire point of building against the contract.

*(Could some reads move into Server Components later, for a faster first paint? Yes, in principle — but it would need the auth token available server-side and it breaks the MSW test setup. It's a possible future optimization, not part of the plan.)*

---

### 12.9 The one genuinely open decision

[frontend_prototype_plan.md](./frontend_prototype_plan.md) leaves real GitHub sign-in as: *"Auth.js in Next.js **or** the FastAPI backend."* That decision is still open, and it's the one place a Next.js route handler could legitimately appear.

If the team picks **Auth.js** (a Next.js authentication library), you will get your first real route handler: `app/api/auth/[...nextauth]/route.ts`. **That does not violate anything** — it handles sign-in and sessions, not domain data. The rule is "no domain data from Next", not "no server code in Next".

There's also a tension worth noticing *before* you implement it, rather than discovering it later:

- **SAD Figure 6** (deployment) draws the browser calling FastAPI **directly** — `Browser ──HTTPS REST──► Backend host`.
- **SRS `S-2`** says secrets and tokens are *"stored securely, **never exposed to the client**."*

If the browser calls FastAPI directly, the GitHub token has to be handled somewhere in or near the browser, plus you'll need **CORS** (Cross-Origin Resource Sharing — the browser rule that blocks calls to a different domain unless that domain allows them) configured on FastAPI.

The standard fix is a **BFF** (Backend For Frontend): a *thin* Next.js route handler that keeps the session in an **httpOnly cookie** (a cookie JavaScript cannot read, so a script injected into your page can't steal it), attaches the token server-side, and forwards the call to FastAPI. The browser then never holds a token.

> ✍️ **TEAM TODO:** decide Auth.js-in-Next vs. auth-in-FastAPI, and whether a BFF proxy is needed to satisfy `S-2`. Then make SAD Figure 6 match the decision. Deciding this deliberately is much cheaper than discovering it during Phase 12.

---

### 12.10 The rule to carry forward

> **Next.js server side = rendering and (maybe) authentication.
> FastAPI = all domain data.
> PostgreSQL has exactly one client, and it is Python.**

In practice, when you're building any screen:

| You need to… | Do this | Not this |
|---|---|---|
| Show data from the database | Hook → [client.ts](../../apps/web/src/lib/api/client.ts) → FastAPI | ~~Query Postgres in a Server Component~~ |
| Save or change data | Same — `POST`/`PATCH` to FastAPI | ~~A Server Action writing to the DB~~ |
| Start a scan | `POST /api/repos/{id}/scan` → FastAPI enqueues a Celery job | ~~Run analysis in Next~~ |
| Render a fast static shell | Server Component — the default; just don't add `"use client"` | ~~Mark the page `"use client"`~~ |
| Handle a click or local state | `"use client"`, pushed as far down the tree as you can (§5) | ~~`"use client"` on the whole page~~ |
| Handle the OAuth callback | The one place a `route.ts` may legitimately appear (§12.9) | — |
| Query PostgreSQL from Next | **Never.** | — |

---

### 12.11 Self-check for this section

1. Why can't the scan pipeline be written in TypeScript inside Next.js?
2. `apps/api` is empty. Why doesn't that stop the frontend from running today?
3. Direct database access from a Server Component saves one network hop. Why doesn't that matter here?
4. What does "the frontend should be entirely built inside Next.js" actually mean — and do we already satisfy it?
5. Why is every data hook in the app `"use client"` right now?
6. Name the one situation where adding a `route.ts` to `apps/web` would be correct.

<details>
<summary>Answers</summary>

1. It depends on Lizard, PyDriller and scikit-learn — Python libraries with no real JavaScript equivalent. The Python backend has to exist regardless.
2. **MSW** intercepts the app's `fetch` calls in the browser and answers them with fixture data, so the app never reaches a real network. Controlled by `NEXT_PUBLIC_API_MOCKING` in `.env.local`.
3. Because that hop costs a few milliseconds, while a scan costs seconds to minutes. And it wouldn't remove FastAPI — the scan pipeline still needs it — so you'd be adding a second database client, not removing a layer.
4. It means the *user interface* must be a real Next.js app (not a static export or a separate browser-only SPA) in order to use Server Components. Yes — all of our UI is in `apps/web`. It does **not** mean the backend belongs in Next.js.
5. Because MSW's service worker only intercepts requests made **in the browser**. A Server Component's `fetch` runs in Node and would bypass the mock entirely.
6. Authentication — e.g. `app/api/auth/[...nextauth]/route.ts` if the team chooses Auth.js, and/or a thin BFF proxy that keeps the GitHub token off the client (SRS `S-2`).
</details>

---

*Not committed — this is a personal reference note. Delete or keep as you prefer.*
