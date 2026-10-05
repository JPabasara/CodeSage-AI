"use client"

import { useState } from "react"
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
import { getWorkspaceRules, updateWorkspaceRules } from "@/lib/api/client"
import type { WorkspaceRules } from "@/lib/types"

const CATEGORY_LABELS: Record<string, string> = {
  "code-design": "Code design",
  security: "Security",
  test: "Test",
  requirement: "Requirement",
  documentation: "Documentation",
}

function ruleLabel(id: string) {
  return id
    .replace(/^pmd:/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("-", " ")
}

export function WorkspaceRuleSettings({
  canEdit,
}: Readonly<{ canEdit: boolean }>) {
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState<WorkspaceRules>()
  const [disabled, setDisabled] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [search, setSearch] = useState("")

  function changeOpen(value: boolean) {
    setOpen(value)
    if (!value) return
    setBusy(true)
    setConfig(undefined)
    setError(undefined)
    setSaved(false)
    setSearch("")
    void getWorkspaceRules()
      .then((value) => {
        setConfig(value)
        setDisabled(value.disabled_rule_ids)
      })
      .catch(() =>
        setError("Could not load workspace rules. Close and reopen to retry."),
      )
      .finally(() => setBusy(false))
  }

  async function save() {
    if (!canEdit || !config) return
    setBusy(true)
    setError(undefined)
    setSaved(false)
    try {
      const value = await updateWorkspaceRules(disabled)
      setConfig(value)
      setDisabled(value.disabled_rule_ids)
      setSaved(true)
    } catch {
      setError("Could not save workspace rules. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  const changed =
    config &&
    [...disabled].sort().join("\n") !==
      [...config.disabled_rule_ids].sort().join("\n")

  const query = search.trim().toLowerCase()
  const visibleRules =
    config?.rules.filter((rule) =>
      [
        rule.rule_id,
        ruleLabel(rule.rule_id),
        rule.description,
        CATEGORY_LABELS[rule.category],
      ].some((value) => value.toLowerCase().includes(query)),
    ) ?? []

  return (
    <section
      className="space-y-2 rounded-lg border p-4"
      aria-label="Workspace rule selection"
    >
      <h2 className="text-sm font-semibold">Rule selection</h2>
      <p className="text-sm text-muted-foreground">
        Applies to all repositories in this workspace. Only Org Admins can
        change rules.
      </p>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            View workspace rules
          </Button>
        </DialogTrigger>
        <DialogContent className="flex h-[85dvh] max-h-[48rem] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Workspace rule selection</DialogTitle>
            <DialogDescription>
              Checked rules run in future scans across all repositories. Changes
              apply to future scans. Run a new scan to update findings and
              health scores, even without a new commit. Existing results remain
              unchanged. AI-based findings are unaffected.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="search"
            aria-label="Search rules"
            placeholder="Search by rule name, description, or category…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {busy && !config ? (
              <p role="status" className="text-sm">
                Loading rules…
              </p>
            ) : null}
            {config ? (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  {
                    config.rules.filter(
                      (rule) => !disabled.includes(rule.rule_id),
                    ).length
                  }{" "}
                  of {config.rules.length} rules selected
                </p>
                {visibleRules.length === 0 ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    No rules match your search.
                  </p>
                ) : null}
                {Object.entries(CATEGORY_LABELS).map(([category, label]) => {
                  const rules = visibleRules.filter(
                    (rule) => rule.category === category,
                  )
                  if (!rules.length) return null
                  return (
                    <fieldset
                      key={category}
                      disabled={!canEdit || busy}
                      className="space-y-2 rounded-md border p-3 disabled:opacity-60"
                    >
                      <legend className="px-1 text-sm font-medium">
                        {label}
                      </legend>
                      {rules.map((rule) => (
                        <label
                          key={rule.rule_id}
                          className="flex items-start gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            aria-label={ruleLabel(rule.rule_id)}
                            checked={!disabled.includes(rule.rule_id)}
                            className="mt-1 size-4 shrink-0 accent-primary"
                            onChange={(event) => {
                              const checked = event.target.checked
                              setSaved(false)
                              setDisabled((current) =>
                                checked
                                  ? current.filter((id) => id !== rule.rule_id)
                                  : [...current, rule.rule_id],
                              )
                            }}
                          />
                          <span>
                            <span className="block font-medium capitalize">
                              {ruleLabel(rule.rule_id)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {rule.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  )
                })}
              </div>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="text-sm">
              Saved. Run a new scan to apply these rules.
            </p>
          ) : null}
          {canEdit ? (
            <DialogFooter>
              <Button disabled={busy || !changed} onClick={save}>
                {busy && config ? "Saving…" : "Save rules"}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}
