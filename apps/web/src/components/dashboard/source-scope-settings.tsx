"use client"

import { LearnMore } from "@/components/support/learn-more"

import { useCallback, useEffect, useId, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  Settings2,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { getSourceScopeConfig, updateSourceScopeConfig } from "@/lib/api/client"
import { publishProjectSettingsChanged } from "@/hooks/use-projects"
import type { TreeNode } from "@/lib/types"
import { cn } from "@/lib/utils"

type PathNode = Pick<TreeNode, "path" | "name" | "type"> & {
  children?: PathNode[] | null
}

function pathTree(paths: string[]): PathNode[] {
  const roots: PathNode[] = []
  for (const path of paths) {
    let items = roots
    const parts = path.split("/")
    parts.forEach((name, index) => {
      const currentPath = parts.slice(0, index + 1).join("/")
      let node = items.find((item) => item.path === currentPath)
      if (!node) {
        node = {
          path: currentPath,
          name,
          type: index === parts.length - 1 ? "file" : "folder",
          children: [],
        }
        items.push(node)
      }
      items = node.children!
    })
  }
  return roots
}

function leafPaths(node: PathNode): string[] {
  if (node.type === "file") return [node.path]
  return (node.children ?? []).flatMap(leafPaths)
}

function patternFor(node: PathNode) {
  return node.type === "folder" ? `${node.path}/**` : node.path
}

function globMatches(path: string, pattern: string) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*")
  const expression = new RegExp(`^${escaped}$`)
  return expression.test(path) || expression.test(`/${path}`)
}

function matchesAny(path: string, patterns: string[]) {
  return patterns.some((pattern) => globMatches(path, pattern))
}

export function SourceScopeSettings({
  repoId,
  nodes = [],
  canEdit = false,
  initialOpen = false,
  onClose,
  onSaved,
  saveLabel = "Save configuration",
  onSkip,
}: Readonly<{
  repoId: string
  nodes?: TreeNode[]
  canEdit?: boolean
  initialOpen?: boolean
  onClose?: () => void
  onSaved?: () => void
  saveLabel?: string
  onSkip?: () => void
}>) {
  const [open, setOpen] = useState(initialOpen)
  const [paths, setPaths] = useState<PathNode[]>(nodes)
  const [search, setSearch] = useState("")
  const modeName = useId()
  const [mode, setMode] = useState<"skip" | "hide">("skip")
  const [testPatterns, setTestPatterns] = useState<string[]>([])
  const [productionOverrides, setProductionOverrides] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(initialOpen)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(() => {
    return getSourceScopeConfig(repoId, true)
      .then((value) => {
        setTestPatterns(value.test_path_patterns)
        setProductionOverrides(value.production_path_overrides)
        setMode(value.scan_excluded_directories ? "hide" : "skip")
        setLoaded(true)
        const tree = value.file_paths ? pathTree(value.file_paths) : null
        if (tree) {
          setPaths(tree)
          setExpanded(new Set())
        }
      })
      .catch(() =>
        setError(
          "Could not load directory settings. Close and reopen to retry.",
        ),
      )
      .finally(() => setBusy(false))
  }, [repoId])

  useEffect(() => {
    if (initialOpen) {
      void load()
    }
  }, [initialOpen, load])

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      setSearch("")
      setExpanded(new Set())
      setBusy(true)
      setLoaded(false)
      setError(undefined)
      void load()
    } else onClose?.()
  }

  function selected(path: string) {
    return (
      matchesAny(path, testPatterns) && !matchesAny(path, productionOverrides)
    )
  }

  function nodeState(node: PathNode) {
    const leaves = leafPaths(node)
    const count = leaves.filter(selected).length
    return {
      checked: leaves.length > 0 && count === leaves.length,
      partial: count > 0 && count < leaves.length,
    }
  }

  function toggle(node: PathNode) {
    const target = patternFor(node)
    const { checked } = nodeState(node)
    if (!canEdit) return
    if (checked) {
      if (testPatterns.includes(target)) {
        setTestPatterns((current) =>
          current.filter((pattern) => pattern !== target),
        )
      }
      if (!productionOverrides.includes(target)) {
        setProductionOverrides((current) => [...current, target])
      }
      return
    }
    setProductionOverrides((current) =>
      current.filter(
        (pattern) =>
          pattern !== target &&
          !(node.type === "folder" && pattern.startsWith(`${node.path}/`)),
      ),
    )
    if (!testPatterns.includes(target)) {
      setTestPatterns((current) => [...current, target])
    }
  }

  function toggleExpanded(path: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function save() {
    if (!canEdit || !loaded) return
    setBusy(true)
    setError(undefined)
    try {
      await updateSourceScopeConfig(repoId, {
        test_path_patterns: testPatterns,
        production_path_overrides: productionOverrides,
        scan_excluded_directories: mode !== "skip",
        hide_excluded_findings: mode === "hide",
      })
      publishProjectSettingsChanged(repoId)
      onSaved?.()
      changeOpen(false)
    } catch {
      setError("Could not save source classification.")
    } finally {
      setBusy(false)
    }
  }

  const selectedFileCount = paths
    .flatMap(leafPaths)
    .filter((path) => selected(path)).length

  const query = search.trim().toLowerCase()
  function matchesSearch(node: PathNode): boolean {
    return (
      node.path.toLowerCase().includes(query) ||
      (node.children ?? []).some(matchesSearch)
    )
  }
  const hasMatches = paths.some(matchesSearch)

  const renderNodes = (items: PathNode[], depth = 0) =>
    items.map((node) => {
      if (!matchesSearch(node)) return null
      const isFolder = node.type === "folder"
      const isOpen = Boolean(query) || expanded.has(node.path)
      const state = nodeState(node)
      return (
        <li key={node.path}>
          <div
            className="flex h-8 items-center gap-1 rounded-md pr-2 hover:bg-muted"
            style={{ paddingLeft: depth * 14 + 6 }}
          >
            {isFolder ? (
              <button
                type="button"
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.name}`}
                className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                disabled={Boolean(query)}
                onClick={() => toggleExpanded(node.path)}
              >
                {isOpen ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>
            ) : (
              <span className="w-5" />
            )}
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.checked}
                disabled={!canEdit || busy || !loaded}
                ref={(element) => {
                  if (element) element.indeterminate = state.partial
                }}
                onChange={() => toggle(node)}
                className="size-4 rounded border-border accent-primary"
              />
              {isFolder ? (
                <Folder className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <File className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{node.name}</span>
            </label>
          </div>
          {isFolder && isOpen && node.children ? (
            <ul>{renderNodes(node.children, depth + 1)}</ul>
          ) : null}
        </li>
      )
    })

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {!initialOpen ? (
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Directory exclusions">
            <Settings2 className="size-3.5" />
            Directory exclusions
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent className="flex h-[min(36rem,85dvh)] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Directory exclusions</DialogTitle>
          <DialogDescription>
            Selected files and directories are excluded from production scoring
            in future scans. Managers and Org Admins can change these
            selections.
          </DialogDescription>
          <LearnMore
            article="test-exclusions"
            about="test exclusions and path classification"
          />
        </DialogHeader>
        <div className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto md:grid-cols-[3fr_2fr]">
          <div className="min-w-0 space-y-3">
            <p className="text-sm text-muted-foreground">
              Detected test files and directories are ticked automatically. Your
              saved selections are also applied. Untick any file or directory
              you want to include as production code.
            </p>
            <Input
              type="search"
              aria-label="Search files and directories"
              placeholder="Search by file or directory path…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {!loaded && busy ? (
              <p
                role="status"
                className="rounded-md border p-4 text-sm text-muted-foreground"
              >
                Loading directories…
              </p>
            ) : !loaded ? null : hasMatches ? (
              <div
                className={cn(
                  "max-h-[22rem] overflow-y-auto rounded-md border p-2",
                  busy && "pointer-events-none opacity-60",
                )}
              >
                <ul className="space-y-0.5">{renderNodes(paths)}</ul>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                {paths.length > 0
                  ? "No files or directories match your search."
                  : "No Java files are available to select."}
              </div>
            )}
            {loaded ? (
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{selectedFileCount} files selected</span>
                {productionOverrides.length > 0 ? (
                  <span>{productionOverrides.length} production overrides</span>
                ) : null}
              </div>
            ) : null}
          </div>
          <fieldset
            disabled={!canEdit || busy || !loaded}
            className="min-w-0 space-y-3 self-start rounded-md border p-3 disabled:opacity-50"
          >
            <legend className="px-1 text-sm font-medium">
              How should CodeSage handle the selected directories?
            </legend>
            {(
              [
                [
                  "skip",
                  "Exclude from scans",
                  "Selected files and directories are not analysed. No findings are generated, so there is nothing to show later. Requires a new scan.",
                ],
                [
                  "hide",
                  "Hide from Refactor first by default",
                  "Selected files and directories are analysed. Use Show excluded findings to reveal their findings. Requires a new scan.",
                ],
              ] as const
            ).map(([value, label, description]) => (
              <label key={value} className="flex items-start gap-3 text-sm">
                <input
                  type="radio"
                  name={modeName}
                  value={value}
                  aria-label={label}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="text-xs text-muted-foreground">
                    {description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {canEdit ? (
          <DialogFooter>
            {onSkip ? (
              <Button variant="outline" onClick={onSkip} disabled={busy}>
                Scan with current settings
              </Button>
            ) : null}
            <Button onClick={save} disabled={busy || !loaded}>
              {busy ? "Saving…" : saveLabel}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
