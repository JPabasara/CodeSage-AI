"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  getWorkspaceRules,
  updateWorkspaceCommentRules,
  testCommentPattern,
  ApiRequestError,
} from "@/lib/api/client"
import type { CommentRule, CommentPattern } from "@/lib/types"

const CATEGORIES = [
  "code-design",
  "security",
  "documentation",
  "requirement",
  "test",
] as const
const SEVERITIES = ["critical", "high", "medium", "low"] as const
const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
type Draft = Omit<CommentRule, "id">
const blank = (): Draft => ({
  name: "",
  match_type: "keyword",
  pattern: "",
  case_sensitive: false,
  category: "code-design",
  severity: "medium",
  enabled: true,
})
const message = (error: unknown, fallback: string) =>
  error instanceof ApiRequestError ? error.detail : fallback

export function WorkspaceCommentRules({
  canEdit,
}: Readonly<{ canEdit: boolean }>) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState("rules")
  const [rules, setRules] = useState<CommentRule[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [search, setSearch] = useState("")
  const [draft, setDraft] = useState<Draft>(blank)
  const [editingId, setEditingId] = useState<string>()
  const [sample, setSample] = useState("")
  const [testResult, setTestResult] = useState<string>()
  const [testing, setTesting] = useState(false)
  const [draftError, setDraftError] = useState<string>()

  function changeOpen(value: boolean) {
    setOpen(value)
    if (!value) return
    setTab("rules")
    setLoaded(false)
    setBusy(true)
    setDirty(false)
    setSaved(false)
    setError(undefined)
    setSearch("")
    resetDraft()
    void getWorkspaceRules()
      .then((config) => {
        setRules(config.comment_rules ?? [])
        setLoaded(true)
      })
      .catch(() =>
        setError("Could not load comment rules. Close and reopen to retry."),
      )
      .finally(() => setBusy(false))
  }
  function resetDraft() {
    setDraft(blank())
    setEditingId(undefined)
    setSample("")
    setTestResult(undefined)
    setDraftError(undefined)
  }
  function changeDraft(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setTestResult(undefined)
    setDraftError(undefined)
  }
  function changed(next: CommentRule[]) {
    setRules(next)
    setDirty(true)
    setSaved(false)
  }
  async function addRule(event: React.FormEvent) {
    event.preventDefault()
    if (!canEdit || !loaded) return
    setTesting(true)
    setDraftError(undefined)
    try {
      // Validate with the same engine used by scans; browser regex syntax may differ.
      await testCommentPattern(
        {
          match_type: draft.match_type,
          pattern: draft.pattern,
          case_sensitive: draft.case_sensitive,
        },
        "",
      )
      const next = {
        ...draft,
        name: draft.name.trim(),
        id: editingId ?? crypto.randomUUID(),
      }
      changed(
        editingId
          ? rules.map((rule) => (rule.id === editingId ? next : rule))
          : [...rules, next],
      )
      resetDraft()
      setTab("rules")
    } catch (error) {
      setDraftError(
        message(error, "Could not validate this pattern. Please try again."),
      )
    } finally {
      setTesting(false)
    }
  }
  async function test() {
    setTesting(true)
    setTestResult(undefined)
    setDraftError(undefined)
    try {
      const result = await testCommentPattern(draft as CommentPattern, sample)
      setTestResult(
        result.matched
          ? "Pattern matches this sample."
          : "Pattern does not match this sample.",
      )
    } catch (error) {
      setDraftError(
        message(error, "Could not test this pattern. Please try again."),
      )
    } finally {
      setTesting(false)
    }
  }
  async function save() {
    if (!canEdit || !loaded) return
    setBusy(true)
    setError(undefined)
    setSaved(false)
    try {
      const config = await updateWorkspaceCommentRules(rules)
      setRules(config.comment_rules ?? [])
      setDirty(false)
      setSaved(true)
    } catch (error) {
      setError(
        message(error, "Could not save comment rules. Please try again."),
      )
    } finally {
      setBusy(false)
    }
  }
  function inspect(rule: CommentRule) {
    setTab("editor")
    setDraft({
      name: rule.name,
      match_type: rule.match_type,
      pattern: rule.pattern,
      case_sensitive: rule.case_sensitive,
      category: rule.category,
      severity: rule.severity,
      enabled: rule.enabled,
    })
    setEditingId(rule.id)
    setSample("")
    setTestResult(undefined)
    setDraftError(undefined)
  }
  const query = search.trim().toLowerCase()
  const visible = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) =>
      [rule.name, rule.pattern, rule.category, rule.severity].some((text) =>
        text.toLowerCase().includes(query),
      ),
    )

  return (
    <section
      className="space-y-2 rounded-lg border p-4"
      aria-label="Workspace comment rules"
    >
      <h2 className="text-sm font-semibold">Comment rules</h2>
      <p className="text-sm text-muted-foreground">
        Track your team’s explicit comment markers before ML predictions. Only
        Org Admins can change rules.
      </p>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            View comment rules
          </Button>
        </DialogTrigger>
        <DialogContent className="flex h-[85dvh] max-h-[48rem] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Workspace comment rules</DialogTitle>
            <DialogDescription>
              The first enabled matching rule sets the category and severity.
              Unmatched comments still go to ML. Changes apply to future scans
              across this workspace; you can rescan without a new commit.
              Existing results stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
            <TabsList aria-label="Comment rules">
              <TabsTrigger value="rules" disabled={busy || testing}>
                Added rules{loaded ? ` (${rules.length})` : ""}
              </TabsTrigger>
              <TabsTrigger
                value="editor"
                disabled={
                  !loaded || busy || testing || (!canEdit && !editingId)
                }
              >
                {editingId
                  ? canEdit
                    ? "Edit rule"
                    : "Rule details"
                  : "Add rule"}
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="rules"
              className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
            >
              <Input
                type="search"
                aria-label="Search comment rules"
                placeholder="Search comment rules…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="space-y-4">
                {!loaded && busy ? (
                  <p role="status">Loading comment rules…</p>
                ) : null}
                {loaded && !visible.length ? (
                  <p className="text-sm text-muted-foreground">
                    {rules.length
                      ? "No comment rules match your search."
                      : "No comment rules yet. Unmatched comments use ML."}
                  </p>
                ) : null}
                {visible.map(({ rule, index }) => (
                  <div
                    key={rule.id}
                    className="space-y-2 rounded-md border p-3"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <strong>
                        {index + 1}. {rule.name}
                      </strong>
                      <span className="text-xs text-muted-foreground">
                        {rule.category} · {rule.severity}
                      </span>
                    </div>
                    <code className="block break-all text-xs">
                      {rule.pattern}
                    </code>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || testing}
                        onClick={() => inspect(rule)}
                        aria-label={`${canEdit ? "Edit" : "Inspect"} ${rule.name}`}
                      >
                        {canEdit ? "Edit" : "Inspect"}
                      </Button>
                      {canEdit ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || testing}
                            onClick={() => {
                              changed(
                                rules.filter((item) => item.id !== rule.id),
                              )
                              if (editingId === rule.id) resetDraft()
                            }}
                            aria-label={`Remove ${rule.name}`}
                          >
                            Remove
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
            <TabsContent
              value="editor"
              className="min-h-0 flex-1 overflow-y-auto pr-1"
            >
              {loaded && (canEdit || editingId) ? (
                <form
                  className="space-y-3 rounded-md border p-3"
                  onSubmit={addRule}
                >
                  <h3 className="text-sm font-semibold">
                    {editingId ? "Comment rule details" : "Add comment rule"}
                  </h3>
                  <fieldset
                    disabled={!canEdit || busy || testing}
                    className="space-y-3"
                  >
                    <label className="grid gap-1">
                      Rule name
                      <Input
                        aria-label="Comment rule name"
                        required
                        maxLength={100}
                        value={draft.name}
                        onChange={(event) =>
                          changeDraft({ name: event.target.value })
                        }
                      />
                    </label>
                    <label className="grid gap-1">
                      Match type
                      <select
                        aria-label="Comment match type"
                        className={SELECT_CLASS}
                        value={draft.match_type}
                        onChange={(event) =>
                          changeDraft({
                            match_type: event.target
                              .value as Draft["match_type"],
                          })
                        }
                      >
                        <option value="keyword">Keyword</option>
                        <option value="regex">Regex (advanced)</option>
                      </select>
                    </label>
                    <label className="grid gap-1">
                      {draft.match_type === "keyword"
                        ? "Keyword or phrase"
                        : "Regex pattern"}
                      <Input
                        aria-label="Comment pattern"
                        required
                        maxLength={500}
                        placeholder={
                          draft.match_type === "keyword"
                            ? "SECURITY-TODO"
                            : "\\bSECURITY-TODO\\b"
                        }
                        value={draft.pattern}
                        onChange={(event) =>
                          changeDraft({ pattern: event.target.value })
                        }
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft.case_sensitive}
                        onChange={(event) =>
                          changeDraft({ case_sensitive: event.target.checked })
                        }
                      />
                      Case sensitive
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="grid gap-1">
                        Category
                        <select
                          aria-label="Comment category"
                          className={SELECT_CLASS}
                          value={draft.category}
                          onChange={(event) =>
                            changeDraft({
                              category: event.target.value as Draft["category"],
                            })
                          }
                        >
                          {CATEGORIES.map((category) => (
                            <option key={category}>{category}</option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1">
                        Severity
                        <select
                          aria-label="Comment severity"
                          className={SELECT_CLASS}
                          value={draft.severity}
                          onChange={(event) =>
                            changeDraft({
                              severity: event.target.value as Draft["severity"],
                            })
                          }
                        >
                          {SEVERITIES.map((severity) => (
                            <option key={severity}>{severity}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </fieldset>
                  <label className="grid gap-1">
                    Sample comment
                    <Textarea
                      aria-label="Sample comment"
                      maxLength={20000}
                      value={sample}
                      onChange={(event) => {
                        setSample(event.target.value)
                        setTestResult(undefined)
                      }}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={test}
                      disabled={busy || testing || !draft.pattern.trim()}
                    >
                      Test pattern
                    </Button>
                    {canEdit ? (
                      <Button
                        type="submit"
                        size="sm"
                        disabled={
                          busy ||
                          testing ||
                          !draft.name.trim() ||
                          !draft.pattern.trim() ||
                          (!editingId && rules.length >= 50)
                        }
                      >
                        {editingId ? "Update rule" : "Add rule"}
                      </Button>
                    ) : null}
                    {editingId ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          resetDraft()
                          setTab("rules")
                        }}
                      >
                        Cancel editing
                      </Button>
                    ) : null}
                  </div>
                  {testResult ? (
                    <p role="status" className="text-sm">
                      {testResult}
                    </p>
                  ) : null}
                  {draftError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {draftError}
                    </p>
                  ) : null}
                </form>
              ) : null}
            </TabsContent>
          </Tabs>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="text-sm">
              Saved. Run a new scan to apply these comment rules.
            </p>
          ) : null}
          {canEdit ? (
            <DialogFooter>
              <Button
                onClick={save}
                disabled={busy || testing || !loaded || !dirty}
              >
                Save comment rules
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}
