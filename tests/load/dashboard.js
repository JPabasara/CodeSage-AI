import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    browsing: { executor: "constant-vus", vus: 50, duration: "5m" },
    scans: { executor: "constant-vus", vus: 3, duration: "5m", exec: "scan" },
  },
  thresholds: {
    http_req_duration: ["p(95)<1000"],
    http_req_failed: ["rate==0"],
  },
};

const base = __ENV.CODESAGE_BASE_URL || "http://localhost:8000/api";
const cookies = { codesage_session: __ENV.CODESAGE_SESSION_TOKEN };
const repository = __ENV.CODESAGE_REPOSITORY_ID;

export default function () {
  for (const path of [`/projects`, `/repos/${repository}/branches`, `/repos/${repository}/health?branch=main`, `/repos/${repository}/scans?branch=main`]) {
    check(http.get(`${base}${path}`, { cookies }), { "read succeeds": (r) => r.status === 200 });
  }
  sleep(1);
}

export function scan() {
  const response = http.post(`${base}/repos/${repository}/scan`, JSON.stringify({ branch: "main" }), { cookies, headers: { "Content-Type": "application/json" } });
  check(response, { "scan accepted or already active": (r) => [200, 202, 409].includes(r.status) });
  sleep(5);
}
