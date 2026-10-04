// Dashboard load test.

import http from "k6/http"
import { check, fail, sleep } from "k6"
import { Counter } from "k6/metrics"

const MODE = __ENV.MODE || "baseline"
// "app" reads the dashboard the way the web app does: the summary, then the
// findings in pages of 500. "full" is the old one-shot payload, for comparison.
const PAYLOAD = __ENV.PAYLOAD || "app"
// Send If-None-Match like a returning browser, so unchanged reads cost a 304.
const REVALIDATE = __ENV.REVALIDATE === "1"
const FINDINGS_PAGE = 500
const base = (__ENV.CODESAGE_BASE_URL || "https://api.codesageai.dev/api").replace(/\/$/, "")
const token = (__ENV.CODESAGE_SESSION_FILE ? open(__ENV.CODESAGE_SESSION_FILE) : __ENV.CODESAGE_SESSION_TOKEN || "").trim()
const cookies = { codesage_session: token }

const scorePending = new Counter("score_pending_responses")

const workloads = {
  baseline: { executor: "constant-vus", vus: 1, duration: "2m" },
  load: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "2m", target: 50 },
      { duration: "6m", target: 50 },
      { duration: "2m", target: 0 },
    ],
    gracefulRampDown: "30s",
  },
}

if (!workloads[MODE]) throw new Error(`MODE must be baseline or load, not ${MODE}`)
if (!["app", "full"].includes(PAYLOAD)) throw new Error(`PAYLOAD must be app or full, not ${PAYLOAD}`)

export const options = {
  scenarios: { reading: workloads[MODE] },
  thresholds: {
    // Dashboard requests allow a longer p95 than the supporting endpoints.
    "http_req_duration{endpoint:dashboard}": ["p(95)<2000"],
    "http_req_duration{kind:other}": ["p(95)<1000"],
    "http_req_duration{endpoint:session}": ["p(95)<1000"],
    "http_req_duration{endpoint:projects}": ["p(95)<1000"],
    "http_req_duration{endpoint:branches}": ["p(95)<1000"],
    "http_req_duration{endpoint:history}": ["p(95)<1000"],
    // Fewer than 1% of requests fail.
    "http_req_failed{phase:measured}": ["rate<0.01"],
    checks: ["rate>0.99"],
  },
  summaryTrendStats: ["min", "avg", "med", "p(90)", "p(95)", "p(99)", "max"],
}

// Per virtual user, like one browser's HTTP cache.
const etags = {}

function get(path, endpoint, phase = "measured") {
  const kind = endpoint === "dashboard" ? "dashboard" : "other"
  // A browser always offers compression; the ingress answers with Brotli or gzip.
  const headers = { "Accept-Encoding": "br, gzip" }
  if (REVALIDATE && etags[path]) headers["If-None-Match"] = etags[path]
  const response = http.get(`${base}${path}`, { cookies, headers, tags: { endpoint, kind, phase } })
  if (REVALIDATE && response.headers.Etag) etags[path] = response.headers.Etag
  return response
}

const ok = (res) => res.status === 200 || res.status === 304

// Prepare one scanned project before virtual users start.
export function setup() {
  if (!token) fail("No session cookie: set CODESAGE_SESSION_FILE or CODESAGE_SESSION_TOKEN.")

  const session = get("/auth/session", "warmup", "warmup")
  if (session.status !== 200) fail(`Session check returned ${session.status}; the cookie is missing, expired or signed out.`)

  const projects = get("/projects", "warmup", "warmup")
  if (projects.status !== 200) fail(`Projects returned ${projects.status}.`)
  const list = projects.json()
  const repo = __ENV.CODESAGE_REPOSITORY_ID
    ? list.find((p) => p.id === __ENV.CODESAGE_REPOSITORY_ID)
    : list.find((p) => p.latest_health)
  if (!repo) fail("No scanned project found in this workspace (or CODESAGE_REPOSITORY_ID is not in it).")
  const branch = __ENV.CODESAGE_BRANCH || repo.default_branch

  // Wait until dashboard data is ready.
  const q = `branch=${encodeURIComponent(branch)}`
  for (let i = 0; i < 12; i++) {
    const health = get(`/repos/${repo.id}/health?${q}`, "warmup", "warmup")
    if (health.status === 200) {
      console.log(`Target: ${repo.owner}/${repo.name} (${repo.id}), branch ${branch}, mode ${MODE}`)
      return { repoId: repo.id, q }
    }
    if (health.status !== 503) fail(`Dashboard returned ${health.status} during warm-up.`)
    sleep(5)
  }
  fail("Dashboard still SCORE_PENDING after 60 s of warm-up.")
}

function read(endpoint, path) {
  const r = get(path, endpoint)
  if (r.status === 503) scorePending.add(1, { endpoint })
  check(r, { [`${endpoint} 200`]: ok }, { endpoint })
  return r
}

// The dashboard as the web app loads it: summary, then findings page by page.
function dashboard(repoId, q) {
  if (PAYLOAD === "full") {
    read("dashboard", `/repos/${repoId}/health?${q}`)
    return
  }
  read("dashboard", `/repos/${repoId}/health?${q}&include_findings=false`)
  let offset = 0
  let total = 1
  while (offset < total) {
    const page = read("dashboard", `/repos/${repoId}/health/findings?${q}&limit=${FINDINGS_PAGE}&offset=${offset}`)
    if (page.status !== 200) return // a 304 or a failure: nothing more to page through
    const body = page.json()
    total = body.total
    if (body.items.length === 0) return
    offset += body.items.length
  }
}

export default function ({ repoId, q }) {
  read("session", "/auth/session")
  read("projects", "/projects")
  read("branches", `/repos/${repoId}/branches`)
  dashboard(repoId, q)
  read("history", `/repos/${repoId}/scans?${q}`)
  sleep(MODE === "baseline" ? 1 : 1 + Math.random() * 2)
}
