import { redirect } from "next/navigation"

/**
 * Kept as an address only. New users used to be sent here before they had seen
 * the product; they now land in the app, and each page offers "Create
 * workspace" in place of its content. Old links and older API deployments still
 * point here, so it forwards rather than 404s.
 */
export default function OnboardingWorkspace() {
  redirect("/projects")
}
