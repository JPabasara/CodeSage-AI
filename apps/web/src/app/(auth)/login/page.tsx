import { SignInButton, SignedIn, SignedOut } from "@asgardeo/nextjs"
import { redirect } from "next/navigation"

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Code Sage AI</h1>
          <p className="text-muted-foreground text-sm">
            Sign in to analyse your repositories.
          </p>
        </div>
        <SignedOut>
          <SignInButton className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 w-full items-center justify-center rounded-md px-6 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50">
            Sign in with GitHub
          </SignInButton>
        </SignedOut>
        <SignedIn>{redirect("/projects")}</SignedIn>
      </div>
    </main>
  )
}
