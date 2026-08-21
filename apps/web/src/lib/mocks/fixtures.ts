// Realistic sample data shaped by the contract (@/lib/types). Used to build the
// screens before any backend exists (Phase 7). Phase 8 serves this same data over
// MSW; nothing here changes shape when the real API arrives.
import type {
  Branch,
  CategoryBreakdownItem,
  Finding,
  HealthPoint,
  HealthReport,
  Repo,
  ScanSummary,
  ScoreProfile,
  TreeNode,
} from "@/lib/types";

export const mockRepos: Repo[] = [
  {
    id: "demo-repo",
    name: "acme-payments",
    owner: "acme",
    visibility: "public",
    url: "https://github.com/acme/acme-payments",
    source: "public-url",
    default_branch: "main",
    connected_at: "2026-07-10T09:00:00.000Z",
    latest_health: { score: 72, grade: "B", delta: 3 },
  },
  {
    id: "web-store",
    name: "web-store",
    owner: "acme",
    visibility: "public",
    url: "https://github.com/acme/web-store",
    source: "public-url",
    default_branch: "main",
    connected_at: "2026-07-12T14:20:00.000Z",
    latest_health: { score: 54, grade: "C", delta: -4 },
  },
];

export const mockBranches: Branch[] = [
  {
    name: "main",
    is_default: true,
    head_commit_sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    head_commit_at: "2026-07-22T18:30:00.000Z",
  },
  {
    name: "develop",
    is_default: false,
    head_commit_sha: "b2c3d4e5f60718293a4b5c6d7e8f90123456789a",
    head_commit_at: "2026-07-21T11:05:00.000Z",
  },
];

// One critical hardcoded secret + one medium SATD TODO + code-design + a doc gap,
// matching the backend worked example (payment_service). Varied severities so the
// list + badges show every colour.
export const mockFindings: Finding[] = [
  {
    fingerprint: "f-secret-1",
    source: "security",
    category: "security",
    severity: "critical",
    file: "src/payments/payment_service.ts",
    line: 42,
    symbol: "charge()",
    reason: "Hardcoded Stripe API key detected — move it to an environment variable.",
    status: "open",
    priority: 40.8,
    rule_id: "hardcoded-secret",
  },
  {
    fingerprint: "f-long-1",
    source: "rule",
    category: "code-design",
    severity: "high",
    file: "src/orders/order_controller.ts",
    line: 5,
    symbol: "OrderController",
    reason: "order_controller.ts is 940 lines long (limit 800) — consider splitting the module.",
    status: "open",
    priority: 12.0,
    rule_id: "large-file",
    metric_value: 940,
    threshold: 800,
  },
  {
    fingerprint: "f-ccn-1",
    source: "rule",
    category: "code-design",
    severity: "medium",
    file: "src/payments/payment_service.ts",
    line: 58,
    symbol: "charge()",
    reason: "charge() has cyclomatic complexity 18, over the limit of 15 — split it into smaller functions.",
    status: "open",
    priority: 9.3,
    rule_id: "complex-function",
    metric_value: 18,
    threshold: 15,
  },
  {
    fingerprint: "f-todo-1",
    source: "satd",
    category: "code-design",
    severity: "medium",
    file: "src/payments/payment_service.ts",
    line: 12,
    symbol: "module",
    reason: "Self-admitted debt: 'TODO: temporary hack until v2 ships' — classified as code-design.",
    status: "open",
    priority: 5.1,
  },
  {
    fingerprint: "f-doc-1",
    source: "satd",
    category: "documentation",
    severity: "low",
    file: "src/lib/utils.ts",
    line: 3,
    symbol: "formatDate()",
    reason: "Self-admitted debt: 'FIXME: document the timezone handling' — classified as documentation.",
    status: "open",
    priority: 1.5,
  },
];

// A tree with low/medium/high health_score nodes so the heat map shows red/amber/green.
export const mockTree: TreeNode[] = [
  {
    path: "src",
    name: "src",
    type: "folder",
    health_score: 68,
    grade: "B",
    debt_score: 40,
    risk_score: 0.4,
    children: [
      {
        path: "src/payments",
        name: "payments",
        type: "folder",
        health_score: 34,
        grade: "E",
        debt_score: 61,
        risk_score: 0.78,
        children: [
          {
            path: "src/payments/payment_service.ts",
            name: "payment_service.ts",
            type: "file",
            health_score: 28,
            grade: "E",
            debt_score: 61,
            risk_score: 0.78,
          },
          {
            path: "src/payments/stripe_client.ts",
            name: "stripe_client.ts",
            type: "file",
            health_score: 74,
            grade: "B",
            debt_score: 9,
            risk_score: 0.22,
          },
        ],
      },
      {
        path: "src/orders",
        name: "orders",
        type: "folder",
        health_score: 52,
        grade: "C",
        debt_score: 22,
        risk_score: 0.5,
        children: [
          {
            path: "src/orders/order_controller.ts",
            name: "order_controller.ts",
            type: "file",
            health_score: 48,
            grade: "D",
            debt_score: 22,
            risk_score: 0.55,
          },
        ],
      },
      {
        path: "src/lib",
        name: "lib",
        type: "folder",
        health_score: 88,
        grade: "A",
        debt_score: 3,
        risk_score: 0.1,
        children: [
          {
            path: "src/lib/utils.ts",
            name: "utils.ts",
            type: "file",
            health_score: 85,
            grade: "A",
            debt_score: 3,
            risk_score: 0.12,
          },
        ],
      },
    ],
  },
];

const mockHistory: HealthPoint[] = [
  { t: "2026-06-20T00:00:00.000Z", score: 61, commit_sha: "1111111" },
  { t: "2026-06-30T00:00:00.000Z", score: 64 },
  { t: "2026-07-08T00:00:00.000Z", score: 66 },
  { t: "2026-07-15T00:00:00.000Z", score: 69 },
  { t: "2026-07-22T00:00:00.000Z", score: 72 },
];

const mockCategoryBreakdown: CategoryBreakdownItem[] = [
  { category: "code-design", count: 3, debt: 21 },
  { category: "security", count: 1, debt: 40 },
  { category: "documentation", count: 1, debt: 2 },
];

export const mockHealthReport: HealthReport = {
  snapshot_id: "scan-2026-07-22",
  repo_id: "demo-repo",
  branch: "main",
  commit_sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  scanned_at: "2026-07-22T18:35:00.000Z",
  health_score: 72,
  grade: "B",
  delta: 3,
  profile: "Balanced",
  red_issue_count: 2, // critical + high
  history: mockHistory,
  tree: mockTree,
  file_scores: [
    { file: "src/payments/payment_service.ts", debt_score: 61, risk_score: 0.78 },
    { file: "src/orders/order_controller.ts", debt_score: 22, risk_score: 0.55 },
    { file: "src/lib/utils.ts", debt_score: 3, risk_score: 0.12 },
  ],
  findings: mockFindings,
  category_breakdown: mockCategoryBreakdown,
};

export const mockScanHistory: ScanSummary[] = [
  {
    scan_id: "scan-2026-07-22",
    branch: "main",
    commit_sha: "a1b2c3d",
    scanned_at: "2026-07-22T18:35:00.000Z",
    health_score: 72,
    grade: "B",
    delta: 3,
    finding_count: 5,
  },
  {
    scan_id: "scan-2026-07-15",
    branch: "main",
    commit_sha: "9f8e7d6",
    scanned_at: "2026-07-15T10:00:00.000Z",
    health_score: 69,
    grade: "B",
    delta: 3,
    finding_count: 6,
  },
  {
    scan_id: "scan-2026-07-08",
    branch: "main",
    commit_sha: "5c4b3a2",
    scanned_at: "2026-07-08T10:00:00.000Z",
    health_score: 66,
    grade: "C",
    delta: 2,
    finding_count: 7,
  },
];

export const mockProfiles: ScoreProfile[] = [
  {
    id: "balanced",
    name: "Balanced",
    weights: { security: 1, code_design: 1, satd: 1, duplication: 1 },
    wMl: 1,
    is_preset: true,
  },
  {
    id: "security-first",
    name: "Security-first",
    weights: { security: 3, code_design: 1, satd: 1, duplication: 0.8 },
    wMl: 1,
    is_preset: true,
  },
  {
    id: "delivery-speed",
    name: "Delivery-speed",
    weights: { security: 1.5, code_design: 1.2, satd: 0.5, duplication: 0.5 },
    wMl: 1.2,
    is_preset: true,
  },
];
