import { describe, expect, it } from "vitest"
import {
  allHelpArticles,
  helpTopics,
  helpTrail,
  searchHelp,
} from "./help-navigation"

describe("help navigation integrity", () => {
  it("resolves every parent and related link and has no duplicate routes or cycles", () => {
    const pages = [...helpTopics, ...allHelpArticles]
    expect(new Set(pages.map((page) => page.slug)).size).toBe(pages.length)
    for (const page of pages) {
      const visited = new Set<string>([page.slug])
      let parent = page.parent
      while (parent) {
        expect(visited.has(parent)).toBe(false)
        visited.add(parent)
        const topic = helpTopics.find((item) => item.slug === parent)
        expect(topic, `Missing parent ${parent}`).toBeDefined()
        parent = topic?.parent
      }
    }
    for (const article of allHelpArticles) {
      for (const slug of article.related)
        expect(allHelpArticles.some((item) => item.slug === slug)).toBe(true)
    }
  })
  it("places test exclusions under Dashboard and Filters", () => {
    const article = allHelpArticles.find(
      (item) => item.slug === "test-exclusions",
    )
    expect(helpTrail(article?.parent).map((item) => item.title)).toEqual([
      "Dashboard",
      "Filters",
    ])
  })
  it("finds multiword searches across article content and hierarchy", () => {
    expect(
      searchHelp("dashboard test exclusions").map((item) => item.slug),
    ).toContain("test-exclusions")
    expect(searchHelp("Asgardeo").map((item) => item.slug)).toContain(
      "sign-in-asgardeo",
    )
    expect(searchHelp("zzzznonexistent")).toHaveLength(0)
  })
})
