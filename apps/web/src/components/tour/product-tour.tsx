"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, X } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useProjects } from "@/hooks/use-projects"
import { useSession } from "@/hooks/use-session"
import { finishProductTour } from "@/lib/api/client"

export const TOUR_VERSION = "v1"

export const TOUR_SECTIONS = [
  "workspace",
  "projects",
  "dashboard",
  "profiles",
  "history",
] as const

export type TourSection = (typeof TOUR_SECTIONS)[number]
type TourScope = "full" | TourSection

export const TOUR_SECTION_LABELS: Record<TourSection, string> = {
  workspace: "Workspace",
  projects: "Projects",
  dashboard: "Dashboard",
  profiles: "Profiles",
  history: "Scan History",
}

type TourStep = {
  section: TourSection
  target: string
  title: string
  description: string
  profileScope?: "workspace" | "project"
}

export const PRODUCT_TOUR_STEPS: readonly TourStep[] = [
  {
    section: "workspace",
    target: "workspace-switcher",
    title: "Your workspace is ready",
    description:
      "We created My Workspace for you. Use this switcher later when you belong to more than one workspace.",
  },
  {
    section: "workspace",
    target: "workspace-settings",
    title: "Your team home",
    description:
      "A workspace keeps projects, profiles, and team access together. You can update its name and details here.",
  },
  {
    section: "projects",
    target: "project-connect",
    title: "Add a Java project",
    description:
      "Paste a public GitHub repository URL here. CodeSage currently analyses Java repositories.",
  },
  {
    section: "projects",
    target: "project-list",
    title: "PetClinic is ready",
    description:
      "We added Spring PetClinic so you can try CodeSage now. Open its dashboard when you are ready.",
  },
  {
    section: "dashboard",
    target: "branch-selector",
    title: "Choose a branch",
    description:
      "Choose the branch you want to inspect. Each branch keeps its own scan results and history.",
  },
  {
    section: "dashboard",
    target: "scan-action",
    title: "Run your first scan",
    description:
      "Run a scan for the branch you selected. You can keep this guide open while the analysis starts.",
  },
  {
    section: "dashboard",
    target: "dashboard-health",
    title: "Read the result",
    description:
      "The health score gives you a quick summary. The findings list shows what to review first.",
  },
  {
    section: "dashboard",
    target: "dashboard-views",
    title: "Choose your view",
    description:
      "Use these buttons to focus on findings, files, or an open finding detail. Your choice is remembered.",
  },
  {
    section: "profiles",
    target: "profile-scope",
    title: "Choose what you are tuning",
    description:
      "Set one profile for the workspace, or choose a project when it needs different priorities.",
    profileScope: "workspace",
  },
  {
    section: "profiles",
    target: "profile-pool",
    title: "Choose or create a profile",
    description:
      "Start with a built-in profile or create up to five custom profiles. Changing weights re-scores saved results without another scan.",
    profileScope: "workspace",
  },
  {
    section: "profiles",
    target: "profile-action",
    title: "Set the workspace default",
    description:
      "Choose a profile, then set it as the workspace default. Projects use it unless they have their own choice.",
    profileScope: "workspace",
  },
  {
    section: "profiles",
    target: "profile-action",
    title: "Use one profile for a project",
    description:
      "Choose a project and a profile, then select Use for this project. Only that project gets the override.",
    profileScope: "project",
  },
  {
    section: "history",
    target: "scan-history",
    title: "Return to an older scan",
    description:
      "Scan History keeps completed snapshots. Open one to review the result from that point in time.",
  },
] as const

type TourContextValue = {
  active: boolean
  startTour: (scope?: TourScope) => void
}

const TourContext = createContext<TourContextValue | null>(null)

export function useProductTour() {
  const value = useContext(TourContext)
  if (!value)
    throw new Error("useProductTour must be used inside ProductTourProvider")
  return value
}

function tourStorageKey(userId: string) {
  return `codesage.product-tour.${TOUR_VERSION}:${userId}`
}

function routeFor(step: TourStep, repoId?: string) {
  if (step.section === "workspace") return "/workspace"
  if (step.section === "projects") return "/projects"
  if (step.section === "profiles") {
    return step.profileScope === "project" && repoId
      ? `/profiles?project=${encodeURIComponent(repoId)}`
      : "/profiles"
  }
  if (!repoId) return "/projects"
  return step.section === "history"
    ? `/dashboard/${repoId}/history`
    : `/dashboard/${repoId}`
}

export function ProductTourProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const profileProjectId = searchParams.get("project") ?? undefined
  const { data: session } = useSession()
  const userId = session?.user_id
  const tourRequired = session?.product_tour_required
  const { data: projects } = useProjects()
  const repoId = projects?.[0]?.id
  const [scope, setScope] = useState<TourScope>()
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect>()
  const [confirmClose, setConfirmClose] = useState(false)
  const autoStartedFor = useRef<string | undefined>(undefined)

  const steps = useMemo(
    () =>
      scope === "full"
        ? PRODUCT_TOUR_STEPS
        : PRODUCT_TOUR_STEPS.filter((step) => step.section === scope),
    [scope],
  )
  const step = steps[stepIndex]

  const startTour = useCallback((nextScope: TourScope = "full") => {
    setScope(nextScope)
    setStepIndex(0)
    setConfirmClose(false)
  }, [])

  useEffect(() => {
    if (!userId || !tourRequired) return
    if (autoStartedFor.current === userId) return
    autoStartedFor.current = userId
    if (localStorage.getItem(tourStorageKey(userId))) return
    queueMicrotask(() => startTour("full"))
  }, [startTour, tourRequired, userId])

  useEffect(() => {
    if (!step) return
    const route = routeFor(step, repoId)
    const [targetPath, targetQuery = ""] = route.split("?")
    const targetProjectId =
      new URLSearchParams(targetQuery).get("project") ?? undefined
    const wrongProfileScope =
      step.section === "profiles" && profileProjectId !== targetProjectId
    if (pathname !== targetPath || wrongProfileScope) router.push(route)
  }, [pathname, profileProjectId, repoId, router, step])

  useEffect(() => {
    if (!step) return
    let highlighted: HTMLElement | null = null
    let stopped = false

    const locate = () => {
      if (stopped) return
      const next = document.querySelector<HTMLElement>(
        `[data-tour="${step.target}"]`,
      )
      if (highlighted && highlighted !== next) {
        highlighted.removeAttribute("data-tour-active")
      }
      highlighted = next
      if (next) {
        next.setAttribute("data-tour-active", "true")
        const rect = next.getBoundingClientRect()
        const outsideViewport =
          rect.bottom < 0 ||
          rect.top > window.innerHeight ||
          rect.right < 0 ||
          rect.left > window.innerWidth
        if (outsideViewport) {
          next.scrollIntoView({ block: "center", inline: "nearest" })
          requestAnimationFrame(locate)
          return
        }
        setTargetRect(rect)
      } else {
        setTargetRect(undefined)
      }
    }

    locate()
    const observer = new MutationObserver(locate)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener("resize", locate)
    window.addEventListener("scroll", locate, true)
    return () => {
      stopped = true
      observer.disconnect()
      window.removeEventListener("resize", locate)
      window.removeEventListener("scroll", locate, true)
      highlighted?.removeAttribute("data-tour-active")
    }
  }, [pathname, step])

  const persistEnd = useCallback(
    (status: "completed" | "skipped") => {
      if (userId) {
        localStorage.setItem(tourStorageKey(userId), status)
      }
      setScope(undefined)
      setStepIndex(0)
      void finishProductTour(status).catch(() => {
        // The local preference prevents an intrusive repeat in this browser.
        // A later manual run remains available from Support.
      })
    },
    [userId],
  )

  const next = () => {
    if (stepIndex >= steps.length - 1) persistEnd("completed")
    else setStepIndex((current) => current + 1)
  }

  const skipSection = () => {
    if (!step || scope !== "full") {
      persistEnd("completed")
      return
    }
    const nextSectionIndex = steps.findIndex(
      (candidate, index) =>
        index > stepIndex && candidate.section !== step.section,
    )
    if (nextSectionIndex === -1) persistEnd("completed")
    else setStepIndex(nextSectionIndex)
  }

  useEffect(() => {
    if (!step) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmClose(true)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [step])

  return (
    <TourContext.Provider value={{ active: Boolean(step), startTour }}>
      {children}
      {step && !confirmClose ? (
        <TourCard
          step={step}
          index={stepIndex}
          total={steps.length}
          targetRect={targetRect}
          canGoBack={stepIndex > 0}
          onBack={() => setStepIndex((current) => Math.max(0, current - 1))}
          onNext={next}
          onSkipSection={skipSection}
          onClose={() => setConfirmClose(true)}
        />
      ) : null}
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent className="z-[100]">
          <AlertDialogHeader>
            <AlertDialogTitle>Skip the entire trial?</AlertDialogTitle>
            <AlertDialogDescription>
              You can come back anytime from Support, then New User Trial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep learning</AlertDialogCancel>
            <AlertDialogAction onClick={() => persistEnd("skipped")}>
              Yes, skip trial
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TourContext.Provider>
  )
}

function TourCard({
  step,
  index,
  total,
  targetRect,
  canGoBack,
  onBack,
  onNext,
  onSkipSection,
  onClose,
}: Readonly<{
  step: TourStep
  index: number
  total: number
  targetRect?: DOMRect
  canGoBack: boolean
  onBack: () => void
  onNext: () => void
  onSkipSection: () => void
  onClose: () => void
}>) {
  const cardRef = useRef<HTMLElement>(null)
  useEffect(() => cardRef.current?.focus(), [index])
  const [cardSize, setCardSize] = useState({ width: 352, height: 260 })
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const measure = () => {
      const next = {
        width: card.offsetWidth || 352,
        height: card.offsetHeight || 260,
      }
      setCardSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(card)
    return () => observer.disconnect()
  }, [index])

  const gap = 16
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth
  const viewportHeight =
    typeof window === "undefined" ? 768 : window.innerHeight
  const targetIsUsable =
    targetRect && (targetRect.width > 0 || targetRect.height > 0)
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max))
  const centered = {
    left: clamp(
      (viewportWidth - cardSize.width) / 2,
      gap,
      viewportWidth - cardSize.width - gap,
    ),
    top: clamp(
      (viewportHeight - cardSize.height) / 2,
      gap,
      viewportHeight - cardSize.height - gap,
    ),
  }
  const candidates = targetIsUsable
    ? [
        {
          left: targetRect.right + gap,
          top: clamp(
            targetRect.top,
            gap,
            viewportHeight - cardSize.height - gap,
          ),
        },
        {
          left: targetRect.left - cardSize.width - gap,
          top: clamp(
            targetRect.top,
            gap,
            viewportHeight - cardSize.height - gap,
          ),
        },
        {
          left: clamp(
            targetRect.left + (targetRect.width - cardSize.width) / 2,
            gap,
            viewportWidth - cardSize.width - gap,
          ),
          top: targetRect.bottom + gap,
        },
        {
          left: clamp(
            targetRect.left + (targetRect.width - cardSize.width) / 2,
            gap,
            viewportWidth - cardSize.width - gap,
          ),
          top: targetRect.top - cardSize.height - gap,
        },
      ]
    : []
  const fits = (candidate: { left: number; top: number }) =>
    candidate.left >= gap &&
    candidate.top >= gap &&
    candidate.left + cardSize.width <= viewportWidth - gap &&
    candidate.top + cardSize.height <= viewportHeight - gap
  const corners = [
    { left: gap, top: gap },
    { left: viewportWidth - cardSize.width - gap, top: gap },
    { left: gap, top: viewportHeight - cardSize.height - gap },
    {
      left: viewportWidth - cardSize.width - gap,
      top: viewportHeight - cardSize.height - gap,
    },
  ].filter(fits)
  const overlapArea = (candidate: { left: number; top: number }) => {
    if (!targetRect) return 0
    const width = Math.max(
      0,
      Math.min(candidate.left + cardSize.width, targetRect.right) -
        Math.max(candidate.left, targetRect.left),
    )
    const height = Math.max(
      0,
      Math.min(candidate.top + cardSize.height, targetRect.bottom) -
        Math.max(candidate.top, targetRect.top),
    )
    return width * height
  }
  const leastObstructiveCorner = corners.sort(
    (left, right) => overlapArea(left) - overlapArea(right),
  )[0]
  const position = candidates.find(fits) ?? leastObstructiveCorner ?? centered
  const last = index === total - 1

  return (
    <>
      {targetIsUsable ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[70] rounded-lg ring-2 ring-primary ring-offset-4 ring-offset-background transition-[left,top,width,height] motion-reduce:transition-none"
          style={{
            left: targetRect.left - 4,
            top: targetRect.top - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            boxShadow: "0 0 0 9999px rgb(2 6 23 / 0.38)",
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[70] bg-slate-950/30"
        />
      )}
      <section
        ref={cardRef}
        role="dialog"
        aria-label={`${TOUR_SECTION_LABELS[step.section]} trial step`}
        aria-describedby="product-tour-description"
        tabIndex={-1}
        className="fixed z-[80] w-[calc(100vw-2rem)] max-w-[22rem] rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
        style={{ left: position.left, top: position.top }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {TOUR_SECTION_LABELS[step.section]}
            </p>
            <h2 className="mt-1 text-base font-semibold">{step.title}</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-mr-2 -mt-2 shrink-0"
            aria-label="Close trial"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <p
          id="product-tour-description"
          className="mt-2 text-sm leading-6 text-muted-foreground"
        >
          {step.description}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {index + 1} of {total}
          </span>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {canGoBack ? (
              <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                <ChevronLeft /> Back
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSkipSection}
            >
              Skip {TOUR_SECTION_LABELS[step.section]}
            </Button>
            <Button type="button" size="sm" onClick={onNext}>
              {last ? "Finish" : "Next"}
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}
