import { expect, test } from "@playwright/test"

const webUrl = process.env.DEPLOY_WEB_URL
const apiUrl = process.env.DEPLOY_API_URL?.replace(/\/$/, "")

if (!webUrl || !apiUrl) {
  throw new Error(
    "DEPLOY_WEB_URL and DEPLOY_API_URL are required for deployment smoke tests.",
  )
}

test("the deployed public web and API agree on the sign-in route", async ({
  page,
  request,
}) => {
  const health = await request.get(`${apiUrl}/api/healthz`)
  await expect(health).toBeOK()
  await expect(health.json()).resolves.toEqual({ status: "ok" })

  await page.goto("/")
  await expect(page.getByRole("heading", { name: "CodeSage AI" })).toBeVisible()

  const signIn = page.getByRole("link", { name: /sign in/i }).first()
  await expect(signIn).toBeVisible()
  await expect(signIn).toHaveAttribute("href", `${apiUrl}/api/auth/login`)

  await page.goto("/login")
  await expect(
    page.getByRole("heading", { name: /continue to your dashboard/i }),
  ).toBeVisible()
})
