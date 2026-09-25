import type { Metadata } from "next"
import Image from "next/image"
import { LockKeyhole, ScanSearch } from "lucide-react"

import { LoginPreview } from "@/components/auth/login-preview"
import { SignInPanel } from "@/components/auth/sign-in-panel"
import { signInErrorMessage, signInHref } from "@/lib/sign-in"

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "CodeSage AI ranks technical debt by bug risk, churn, severity, and team scoring priorities.",
}

/**
 * The one entry screen. `/` redirects here, so a visitor is one click from
 * Asgardeo. It is deliberately not skipped: sign-out lands here, and sending
 * this page straight on to Asgardeo would sign a user silently back in.
 */
export default async function LoginPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>
}>) {
  const { error } = await searchParams
  const errorMessage = signInErrorMessage(error)

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-background text-foreground outline-none"
    >
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

          {/* The dashboard in miniature, dark like this panel: hover it, but
              it goes nowhere until you sign in. */}
          <div className="relative z-10 my-10">
            <LoginPreview />
          </div>

          <div className="relative z-10 max-w-xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-md border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-100">
              <ScanSearch className="size-3.5" />
              Prioritize debt before it becomes release risk
            </div>
            <h1 className="text-4xl font-semibold leading-tight tracking-normal">
              Sign in to the CodeSage AI workspace.
            </h1>
            <p className="text-sm leading-6 text-zinc-300">
              Rank the debt most likely to cause future bugs, then spend limited
              refactoring time on the files and findings that matter before the
              next release.
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
                  Sign in with your organisation account.
                </p>
              </div>
            </div>

            <SignInPanel href={signInHref()} error={errorMessage} />

            <div className="rounded-lg border bg-card p-4 text-xs leading-5 text-muted-foreground">
              <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                <LockKeyhole className="size-4 text-primary" />
                Secure sign-in
              </div>
              You sign in on Asgardeo and come straight back. CodeSage never
              sees your password.
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
