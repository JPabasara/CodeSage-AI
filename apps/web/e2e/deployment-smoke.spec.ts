import { expect, test } from "@playwright/test"

const webUrl = process.env.DEPLOY_WEB_URL
const apiUrl = process.env.DEPLOY_API_URL?.replace(/\/$/, "")

if (!webUrl || !apiUrl) {
  throw new Error(
    "DEPLOY_WEB_URL and DEPLOY_API_URL are required for deployment smoke tests.",
  )
}

test("the deployed public web and API agree on the sign-in handoff", async ({
  page,
  request,
}) => {
  const health = await request.get(`${apiUrl}/api/healthz`)
  await expect(health).toBeOK()
  await expect(health.json()).resolves.toEqual({ status: "ok" })

  // The root is only an address: signed out, it lands on sign-in.
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
  await expect(
    page.getByRole("heading", { name: /continue to your dashboard/i }),
  ).toBeVisible()

  const apiSignIn = page.getByRole("link", {
    name: /sign in with asgardeo/i,
  })
  await expect(apiSignIn).toBeVisible()
  await expect(apiSignIn).toHaveAttribute("href", `${apiUrl}/api/auth/login`)
})
