"use client"

import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { applyProfile } from "@/lib/api/client"
import { useActiveProfile, useProfiles } from "@/hooks/use-profiles"
import {
  TRUST_MAX,
  TRUST_MIN,
  WEIGHT_MAX,
  WEIGHT_MIN,
  type CategoryWeights,
  type ScoreProfile,
} from "@/lib/types"

// The five categories, in the order they are shown. Keyed off CategoryWeights so
// adding a sixth category to the contract breaks this list at compile time rather
// than silently rendering four sliders.
const WEIGHT_ROWS: {
  key: keyof CategoryWeights
  label: string
  hint: string
}[] = [
  {
    key: "security",
    label: "Security",
    hint: "Secrets, SQL concatenation, eval",
  },
  {
    key: "code_design",
    label: "Code design",
    hint: "Complexity, long files, duplication",
  },
  {
    key: "requirement",
    label: "Requirement",
    hint: "Self-admitted missing behaviour",
  },
  {
    key: "documentation",
    label: "Documentation",
    hint: "Missing or stale docs",
  },
  { key: "test", label: "Test", hint: "Missing or disabled tests" },
]

/** The six numbers the user is editing, before Apply sends them. */
type Draft = { weights: CategoryWeights; trust_s: number }

/** Same six numbers? Compared with a tolerance because slider steps are floats. */
function sameNumbers(
  a: { weights: CategoryWeights; trust_s: number },
  b: { weights: CategoryWeights; trust_s: number },
) {
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-9
  return (
    near(a.trust_s, b.trust_s) &&
    WEIGHT_ROWS.every(({ key }) => near(a.weights[key], b.weights[key]))
  )
}

export default function ProfilesPage() {
  const { data: presets, loading: loadingPresets } = useProfiles()
  const { data: active, loading: loadingActive, error } = useActiveProfile()

  // Slider positions are CLIENT STATE until Apply is pressed. A single drag
  // crosses many intermediate values; writing each one would put a write and a
  // full re-derivation on the server per pixel of travel, and would leave no way
  // to abandon an experiment.
  //
  // The draft is DERIVED from the applied profile until the user touches
  // something, rather than copied into state by an effect. Same reason as
  // use-query: React 19's react-hooks/set-state-in-effect forbids the copy, and
  // deriving means the sliders cannot get stuck showing a stale profile.
  const [draft, setDraft] = useState<Draft>()
  const [saving, setSaving] = useState(false)

  const weights = draft?.weights ?? active?.weights
  const trustS = draft?.trust_s ?? active?.trust_s

  // Which preset, if any, these numbers still ARE. Derived by comparing values
  // rather than remembering which button was pressed: the moment a slider moves,
  // this is no longer that preset, and the contract says the name is then omitted
  // ("omit it for a custom profile"). Sending "Balanced" for numbers that are not
  // Balanced would mislabel the stored profile.
  const matchedPreset =
    weights && trustS !== undefined
      ? (presets ?? []).find((p) =>
          sameNumbers(p, { weights, trust_s: trustS }),
        )
      : undefined

  function seedFrom(preset: ScoreProfile) {
    setDraft({ weights: preset.weights, trust_s: preset.trust_s })
  }

  async function onApply() {
    if (!weights || trustS === undefined) return
    setSaving(true)
    try {
      // The response is the profile as it is really in force — the server clamps
      // rather than rejecting, so we adopt what came back instead of trusting
      // what we sent.
      const saved = await applyProfile({
        // Present only while the numbers are still exactly a preset's.
        name: matchedPreset?.name,
        weights,
        trust_s: trustS,
      })
      setDraft({ weights: saved.weights, trust_s: saved.trust_s })
      toast.success("Profile applied")
    } catch {
      toast.error("Couldn't apply the profile")
    } finally {
      setSaving(false)
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive text-sm">
          Couldn’t load the active profile: {error.message}
        </p>
      </div>
    )
  }

  if (loadingActive || loadingPresets || !weights || trustS === undefined) {
    return (
      <div className="max-w-2xl space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Profiles</h1>
        <p className="text-muted-foreground text-sm">
          What your team cares about, as six numbers. Nothing is saved until you
          press Apply.
        </p>
      </div>

      {/* Presets seed the sliders in one interaction; adjusting after is optional. */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium">Start from a preset</h2>
          <span
            className="text-muted-foreground text-xs"
            data-testid="profile-label"
          >
            {matchedPreset ? matchedPreset.name : "Custom"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(presets ?? []).map((preset) => (
            <Button
              key={preset.id}
              size="sm"
              variant={matchedPreset?.id === preset.id ? "default" : "outline"}
              onClick={() => seedFrom(preset)}
            >
              {preset.name}
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="text-sm font-medium">Category weights</h2>
        {WEIGHT_ROWS.map(({ key, label, hint }) => (
          <div key={key} className="space-y-2">
            <div className="flex items-baseline justify-between gap-4">
              <label htmlFor={`weight-${key}`} className="text-sm">
                {label}
                <span className="text-muted-foreground ml-2 text-xs">
                  {hint}
                </span>
              </label>
              <span
                className="text-sm tabular-nums"
                data-testid={`value-${key}`}
              >
                {weights[key].toFixed(1)}
              </span>
            </div>
            <Slider
              id={`weight-${key}`}
              aria-label={`${label} weight`}
              min={WEIGHT_MIN}
              max={WEIGHT_MAX}
              step={0.1}
              value={[weights[key]]}
              onValueChange={([v]) =>
                setDraft({ weights: { ...weights, [key]: v }, trust_s: trustS })
              }
            />
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor="trust-s" className="text-sm">
            Trust
            <span className="text-muted-foreground ml-2 text-xs">
              0 = trust the model · 1 = trust the rules
            </span>
          </label>
          <span className="text-sm tabular-nums" data-testid="value-trust_s">
            {trustS.toFixed(2)}
          </span>
        </div>
        <Slider
          id="trust-s"
          aria-label="Trust slider"
          min={TRUST_MIN}
          max={TRUST_MAX}
          step={0.05}
          value={[trustS]}
          onValueChange={([v]) => setDraft({ weights, trust_s: v })}
        />
        <p className="text-muted-foreground text-xs">
          Security findings are excluded — no position of this slider can
          de-weight them.
        </p>
      </section>

      <Button onClick={onApply} disabled={saving}>
        {saving ? "Applying…" : "Apply"}
      </Button>
    </div>
  )
}
