import { redirect } from "next/navigation"

/** An old address: onboarding now happens inside the app. */
export default function OnboardingIndex() {
  redirect("/projects")
}
