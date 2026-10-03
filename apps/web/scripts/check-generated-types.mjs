#!/usr/bin/env node
// Fails if `src/lib/types/api.ts` is not what the OpenAPI contract generates.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CONTRACT = path.resolve(webRoot, "../../docs/api/openapi.yaml")
const GENERATED = path.resolve(webRoot, "src/lib/types/api.ts")
const CLI = path.resolve(webRoot, "node_modules/openapi-typescript/bin/cli.js")

const REGENERATE = "Run `pnpm gen:types` and commit the result."

/** LF, no trailing blank lines, exactly one newline at the end. */
const normalise = (text) => text.replace(/\r\n/g, "\n").trimEnd() + "\n"

function fail(message) {
  console.error(`\ngen:types:check FAILED\n\n${message}\n`)
  process.exit(1)
}

if (!existsSync(CONTRACT)) fail(`The contract is missing: ${CONTRACT}`)
if (!existsSync(CLI))
  fail("openapi-typescript is not installed. Run `pnpm install`.")
if (!existsSync(GENERATED)) fail(`${GENERATED} does not exist. ${REGENERATE}`)

const generation = spawnSync(process.execPath, [CLI, CONTRACT], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})

if (generation.error)
  fail(`Could not run openapi-typescript: ${generation.error.message}`)
if (generation.status !== 0) {
  fail(
    `openapi-typescript exited ${generation.status}.\n\n${generation.stderr ?? ""}`,
  )
}

const expected = normalise(generation.stdout)
const actual = normalise(readFileSync(GENERATED, "utf8"))

if (expected === actual) {
  console.log(
    "gen:types:check OK — src/lib/types/api.ts matches docs/api/openapi.yaml",
  )
  process.exit(0)
}

// Point at the first line that differs.
const expectedLines = expected.split("\n")
const actualLines = actual.split("\n")
const at = expectedLines.findIndex((line, i) => line !== actualLines[i]) + 1

fail(
  [
    "src/lib/types/api.ts is stale — it is not what docs/api/openapi.yaml generates.",
    "",
    `First difference at line ${at}:`,
    `  contract generates : ${JSON.stringify(expectedLines[at - 1] ?? "<end of file>")}`,
    `  file on disk has   : ${JSON.stringify(actualLines[at - 1] ?? "<end of file>")}`,
    "",
    `(${actualLines.length} lines on disk, ${expectedLines.length} generated)`,
    "",
    REGENERATE,
  ].join("\n"),
)
