import type { Metadata } from "next"
import Image from "next/image"
import { ArrowRight, GitBranch, LockKeyhole, ScanSearch } from "lucide-react"

export const metadata: Metadata = { title: "Sign in" }

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"

export default function LoginPage() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background text-foreground outline-none">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_30rem]">
        <section className="relative hidden overflow-hidden bg-zinc-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="relative z-10">
            <Image
              src="/codesage-refactor-branch-logo.svg"
              alt="CodeSage"
              width={210}
              height={56}
              priority
              className="h-14 w-auto"
            />
          </div>

          <div
            aria-hidden="true"
            className="absolute inset-x-10 top-28 rounded-lg border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-emerald-950/30"
          >
            <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-2 text-xs text-white/60">
                <GitBranch className="size-4 text-emerald-300" />
                acme-payments/main
              </div>
              <span className="rounded-full bg-emerald-300/15 px-2 py-1 text-[0.625rem] font-semibold text-emerald-200">
                scan complete
              </span>
            </div>
            <div className="grid gap-3">
              {[
                ["Code health", "81", "bg-emerald-300"],
                ["Refactor first", "14", "bg-amber-300"],
                ["Bug-prone files", "6", "bg-rose-300"],
              ].map(([label, value, color]) => (
                <div
                  key={label}
                  className="grid grid-cols-[0.5rem_1fr_auto] items-center gap-3 rounded-md bg-black/25 p-3"
                >
                  <span className={`h-8 rounded-full ${color}`} />
                  <span className="h-2 rounded-full bg-white/20" />
                  <span className="text-sm font-semibold">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 max-w-xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-100">
              <ScanSearch className="size-3.5" />
              Prioritize debt before it becomes release risk
            </div>
            <h1 className="text-4xl font-semibold leading-tight tracking-normal">
              Sign in to the CodeSage AI workspace.
            </h1>
            <p className="text-sm leading-6 text-zinc-300">
              Repository scans, scoring profiles, and dashboard history stay
              tied to your authenticated workspace session.
            </p>
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-sm space-y-8">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Image
                  src="/codesage-refactor-branch-mark.svg"
                  alt=""
                  width={44}
                  height={44}
                  priority
                  className="size-11"
                />
                <div>
                  <p className="text-sm font-semibold">CodeSage AI</p>
                  <p className="text-xs text-muted-foreground">
                    Technical debt analytics
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-normal">
                  Continue to your dashboard
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Sign-in is handled by Asgardeo, the configured identity
                  provider. CodeSage receives the workspace session after the
                  secure redirect completes.
                </p>
              </div>
            </div>

            <a
              href={`${API_BASE}/api/auth/login`}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-5 text-sm font-medium transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
            >
              Sign in with Asgardeo
              <ArrowRight className="size-4" />
            </a>

            <div className="rounded-lg border bg-card p-4 text-xs leading-5 text-muted-foreground">
              <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                <LockKeyhole className="size-4 text-primary" />
                Identity provider redirect
              </div>
              The browser leaves this page for authentication and returns after
              Asgardeo confirms your session. No password is collected by the
              web app.
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
