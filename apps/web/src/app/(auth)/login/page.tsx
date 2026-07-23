import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Code Sage AI</h1>
          <p className="text-muted-foreground text-sm">Sign in to analyse your repositories.</p>
        </div>
        {/* does nothing yet — wired to (mock) GitHub auth in Phase 8 */}
        <Button size="lg" className="w-full">
          Sign in with GitHub
        </Button>
      </div>
    </main>
  );
}
