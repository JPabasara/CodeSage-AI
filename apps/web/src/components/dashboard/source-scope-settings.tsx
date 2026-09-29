"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, File, Folder, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { getSourceScopeConfig, updateSourceScopeConfig } from "@/lib/api/client"
import type { TreeNode } from "@/lib/types"
import { cn } from "@/lib/utils"

function folderPaths(nodes: TreeNode[], result = new Set<string>()) {
  for (const node of nodes) {
    if (node.type === "folder") {
      result.add(node.path)
      folderPaths(node.children ?? [], result)
    }
  }
  return result
}

function leafPaths(node: TreeNode): string[] {
  if (node.type === "file") return [node.path]
  return (node.children ?? []).flatMap(leafPaths)
}

function patternFor(node: TreeNode) {
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
  nodes,
}: Readonly<{ repoId: string; nodes: TreeNode[] }>) {
  const [open, setOpen] = useState(false)
  const [testPatterns, setTestPatterns] = useState<string[]>([])
  const [productionOverrides, setProductionOverrides] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => folderPaths(nodes))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) return
    setBusy(true)
    setError(undefined)
    setExpanded(folderPaths(nodes))
    try {
      const value = await getSourceScopeConfig(repoId)
      setTestPatterns(value.test_path_patterns)
      setProductionOverrides(value.production_path_overrides)
    } catch {
      setError("Could not load saved path rules.")
    } finally {
      setBusy(false)
    }
  }

  function selected(path: string) {
    return matchesAny(path, testPatterns) && !matchesAny(path, productionOverrides)
  }

  function nodeState(node: TreeNode) {
    const leaves = leafPaths(node)
    const count = leaves.filter(selected).length
    return {
      checked: leaves.length > 0 && count === leaves.length,
      partial: count > 0 && count < leaves.length,
    }
  }

  function toggle(node: TreeNode) {
    const target = patternFor(node)
    const { checked } = nodeState(node)
    if (checked) {
      if (testPatterns.includes(target)) {
        setTestPatterns((current) => current.filter((pattern) => pattern !== target))
      } else if (!productionOverrides.includes(target)) {
        setProductionOverrides((current) => [...current, target])
      }
      return
    }
    setProductionOverrides((current) => current.filter((pattern) => pattern !== target))
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
    setBusy(true)
    setError(undefined)
    try {
      await updateSourceScopeConfig(repoId, {
        test_path_patterns: testPatterns,
        production_path_overrides: productionOverrides,
      })
      setOpen(false)
    } catch {
      setError("Could not save source classification.")
    } finally {
      setBusy(false)
    }
  }

  const selectedFileCount = nodes
    .flatMap(leafPaths)
    .filter((path) => selected(path)).length

  const renderNodes = (items: TreeNode[], depth = 0) =>
    items.map((node) => {
      const isFolder = node.type === "folder"
      const isOpen = expanded.has(node.path)
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
                onClick={() => toggleExpanded(node.path)}
              >
                {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
            ) : <span className="w-5" />}
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.checked}
                ref={(element) => { if (element) element.indeterminate = state.partial }}
                onChange={() => toggle(node)}
                className="size-4 rounded border-border accent-primary"
              />
              {isFolder ? <Folder className="size-4 shrink-0 text-muted-foreground" /> : <File className="size-4 shrink-0 text-muted-foreground" />}
              <span className="truncate">{node.name}</span>
            </label>
          </div>
          {isFolder && isOpen && node.children ? <ul>{renderNodes(node.children, depth + 1)}</ul> : null}
        </li>
      )
    })

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Configure test paths">
          <Settings2 className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Test-code paths</DialogTitle>
          <DialogDescription>
            Checked files and folders are treated as test code in future scans.
            Uncheck any incorrect match to save a production override.
          </DialogDescription>
        </DialogHeader>
        {nodes.length > 0 ? (
          <div className={cn("max-h-[50vh] overflow-y-auto rounded-md border p-2", busy && "pointer-events-none opacity-60")}>
            <ul className="space-y-0.5">{renderNodes(nodes)}</ul>
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Run a scan before selecting test files and folders.
          </div>
        )}
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{selectedFileCount} files selected</span>
          {productionOverrides.length > 0 ? <span>{productionOverrides.length} production overrides</span> : null}
        </div>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button onClick={save} disabled={busy || nodes.length === 0}>
            {busy ? "Saving…" : "Save configuration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
