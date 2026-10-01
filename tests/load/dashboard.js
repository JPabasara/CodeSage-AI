// Performance Profiling (§3.1.4) and Load Testing (§3.1.5) of the Master Test Plan.
//
// One script, two workloads, chosen with MODE:
//
//   baseline  1 virtual user for 2 minutes — the single-user reference numbers.
//   load      ramp to 50 users over 2 minutes, hold 6, ramp down over 2 (PERF-06).
//
// Each iteration is one person opening the product: session, projects, branches,
// the dashboard payload and scan history, then reading for 1 to 3 seconds.
//
// Read-only on purpose. Scans are started by hand from the web app during the
// scan-queue and concurrent-scan tests, so this script never triggers a scan or
// changes a profile — either would send the dashboard back to SCORE_PENDING and
// measure the recalculation instead of the read path.
//
// Run (the HTML report comes from k6's built-in web dashboard):
//
//   K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=load.html \
//   k6 run -e MODE=load -e CODESAGE_SESSION_FILE=cookie.txt \
//          --summary-export=load.json tests/load/dashboard.js
//
// Environment:
//   CODESAGE_BASE_URL       default https://api.codesageai.dev/api
//   CODESAGE_SESSION_FILE   file holding the codesage_session cookie value
//   CODESAGE_SESSION_TOKEN  the cookie value itself (instead of the file)
//   CODESAGE_REPOSITORY_ID  optional; default is the first project with a result
//   CODESAGE_BRANCH         optional; default is that project's default branch

import http from "k6/http"
import { check, fail, sleep } from "k6"
import { Counter } from "k6/metrics"

const MODE = __ENV.MODE || "baseline"
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

export const options = {
  scenarios: { reading: workloads[MODE] },
  thresholds: {
    // SRS PERF-11: the dashboard payload within 2 s at p95; PERF-02: everything else within 1 s.
    "http_req_duration{endpoint:dashboard}": ["p(95)<2000"],
    "http_req_duration{kind:other}": ["p(95)<1000"],
    // Listed per endpoint so the summary shows each one, not just the aggregate.
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

function get(path, endpoint, phase = "measured") {
  const kind = endpoint === "dashboard" ? "dashboard" : "other"
  return http.get(`${base}${path}`, { cookies, tags: { endpoint, kind, phase } })
}

// Runs once before the virtual users start. Neon pauses when idle, so the first
// requests here absorb any cold start and are not part of the measurement.
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

  // Dashboard timings are only meaningful once the scores exist (§3.1.5).
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

export default function ({ repoId, q }) {
  const pages = [
    ["session", "/auth/session"],
    ["projects", "/projects"],
    ["branches", `/repos/${repoId}/branches`],
    ["dashboard", `/repos/${repoId}/health?${q}`],
    ["history", `/repos/${repoId}/scans?${q}`],
  ]
  for (const [endpoint, path] of pages) {
    const r = get(path, endpoint)
    if (r.status === 503) scorePending.add(1, { endpoint })
    check(r, { [`${endpoint} 200`]: (res) => res.status === 200 }, { endpoint })
  }
  sleep(MODE === "baseline" ? 1 : 1 + Math.random() * 2)
}
