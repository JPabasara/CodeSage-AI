import { redirect } from "next/navigation"

/**
 * `/onboarding` is not a screen — it is the shorter address people type, and the
 * one an older link may still point at.
 *
 * The screen itself lives at `/onboarding/workspace`, which is where the API's
 * sign-in callback sends a user who has no workspace yet. Two spellings, one
 * page, and no 404 on the first thing a new account ever does.
 */
export default function OnboardingIndex() {
  redirect("/onboarding/workspace")
}
