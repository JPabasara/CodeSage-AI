const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"

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
        {/*
          A plain link, not a button with an onClick. The browser has to leave
          this page entirely and go to Asgardeo — a fetch would stay here and
          the sign-in could never complete. It is also the one request the mock
          service worker cannot intercept.
        */}
        <a
          href={`${API_BASE}/api/auth/login`}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 w-full items-center justify-center rounded-md px-6 text-sm font-medium transition-colors"
        >
          Sign in
        </a>
      </div>
    </main>
  )
}
