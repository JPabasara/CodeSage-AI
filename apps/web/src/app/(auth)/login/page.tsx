"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { signInWithGitHub } from "@/lib/api/client"

export default function LoginPage() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  // Mocked GitHub sign-in: POST the fake auth endpoint, then land on Projects.
  // Real OAuth (redirect + session + route guards) is Phase 12 — see client.ts.
  const onSignIn = async () => {
    setPending(true)
    try {
      await signInWithGitHub()
      router.push("/projects")
    } catch {
      setPending(false)
      toast.error("Sign in failed. Please try again.")
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Code Sage AI</h1>
          <p className="text-muted-foreground text-sm">
            Sign in to analyse your repositories.
          </p>
        </div>
        <Button
          size="lg"
          className="w-full"
          onClick={onSignIn}
          disabled={pending}
        >
          {pending ? "Signing in…" : "Sign in with GitHub"}
        </Button>
      </div>
    </main>
  )
}
