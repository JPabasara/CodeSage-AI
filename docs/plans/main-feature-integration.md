# Main and feature integration

Integrated on 2026-10-05 onto remote main `0cb10b4d`, on local branch `integrate/main-settings`. Changes remain uncommitted for review.

## Preservation

Main already contained all committed endgame work. Only the uncommitted feature changes were ported, resolving nine conflicting files in a separate temporary checkout before copying the result into the workspace.

Main's app shell, rail, top bar, global styles, UI primitives, dashboard tabs, finding search, code excerpts, snapshot-pinned GitHub links, scan progress model, and API response caching are retained. Changes to existing components are limited to the feature integration and its regressions. A byte comparison verified 50 shell, shared UI, theme and scan-progress files match remote main exactly.

The original endgame changes, including untracked files, are preserved in the Git stash named `Backup endgame feature work before main integration 2026-10-05`, and in `.tmp/integration-backup-20261005/`. The endgame branch reference is unchanged.

## Combined behavior

- Workspace rule selection and custom comment rules appear in the redesigned Profiles page at workspace scope. Only users with workspace update permission can edit them.
- Repository exclusions appear at repository scope in Profiles and through the existing findings toolbar control. Editing requires profile update permission.
- Connecting a repository opens exclusions for users who can configure them. Connect and scan offers Save and scan or an explicit Scan with current settings action. Closing the dialog keeps the repository connected without starting a scan. A failed save does not queue the scan.
- Repository settings determine the initial excluded-finding visibility. Main's Test code toggle remains available as a temporary override, and its search behavior is preserved. The subsequent user-requested card and paging change is described below.
- Saving exclusions refreshes mounted repository consumers. Dashboard headline finding counts and top findings use the same initial visibility setting as the Findings tab, without changing the scoring profile or health calculations.
- Scans freeze exclusions, disabled deterministic rules and custom comment rules. Changing analysis settings permits a new scan at the same commit. Main's progress callbacks and commit/file counts remain intact.
- Matched custom comments appear as Comment rule findings with their original evidence in the existing detail drawer. Unmatched comments continue to ML.
- OpenAPI and generated TypeScript contracts combine the feature fields with main's summary, trend, caching and progress fields. The regex dependency is included in both API dependency manifests.

## Database migrations

Forward migrations 0026–0028 form a single chain after main's 0025. They add repository scan/visibility settings, frozen attempt settings, workspace rule selection and custom comment patterns.

The initial migration uses current model metadata, so its existing later-column exclusion list was extended to exclude the new columns. This prevents fresh databases from creating those columns twice; the forward migrations perform the actual schema changes for both fresh and existing databases.

No application database was migrated. Apply the included migrations through the project's usual database deployment procedure before running the new API against an existing database.

## Initial integration validation

- API unit suite: 521 passed, 1 skipped.
- Frontend unit suite: 643 passed across 61 files.
- Web TypeScript check: passed.
- Web ESLint with zero warnings: passed.
- Generated API contract check: passed; independent regeneration also produced identical types.
- Architecture contracts: all three kept.
- Production Next.js build: passed.
- Alembic graph: single head `20261004_0028`.
- Changed Python files: Ruff passed.
- Browser regression checks: all 48 selected scenarios passed across dashboard, profiles, projects and themes. The first run passed 46; the remaining two passed on a targeted rerun after correcting the new checkbox test's label case and retrying a transient initial page-load timeout.

Unit tests explicitly cover configuration cancellation, failed saves before the first scan, refreshing visibility on the mounted dashboard, and retaining the temporary Show excluded findings toggle. Existing main tests cover search, pagination, historical links, progress, profiles and workspace permissions.

Validation logs are saved under `.tmp/integration-validation-20261005/`. Real database integration tests have not been performed. The local Docker web and worker were subsequently rebuilt, and the corrected PMD stage was verified in the worker container.

## Requested finding-card follow-up

The user requested the earlier card design and paging after integration. Findings now use separate bordered cards with larger, wrapping messages. Cards omit file paths and verbose method signatures; built-in metric rules use concise guidance. Locations, signatures and metric evidence remain available in details. Severity, category, source, priority, selection and triage controls remain available. Previous/Next pagination shows ten findings per page, preserves global ranks, opens initially linked findings on their page, resets after filter changes and clamps pages when results shrink. This replaces the Load more control.

Finding-list and dashboard tests: 71 passed. Type checking and lint for changed components passed. Five browser checks passed for selection, returning to Overview, SATD details, category filtering, and the 1280×720 layout.


## PMD workspace selection fix

Docker worker logs revealed PMD rejected generated workspace-selected rulesets because ElementTree emitted `ns0:` prefixes. Register the PMD default namespace before writing the selected ruleset, preserving enabled references and priorities. Regression assertions cover unprefixed XML; PMD unit checks passed (24 passed, 1 skipped), and a real PMD 7.27.0 run in Docker returned findings with a rule disabled. Completed scans retain their old results; unchanged commit and settings can reuse a completed scan.


## Final settings and help behavior

- Org admins can disable a built-in or PMD rule from finding details after confirming the workspace-wide scope. The action reads the latest disabled-rule list, preserves other selections, and uses the existing admin-protected API. Existing findings remain visible.
- Comment-rule dialogs separate Added rules from Add rule. Added rules expose Edit/Remove (Inspect for read-only users); rule IDs and ordering are preserved. Both tabs use a fixed-size dialog with scrolling content and retained drafts.
- Workspace rule selection uses a fixed-size dialog with a scrolling list.
- Directory exclusions use a fixed-size, responsive two-column dialog: collapsed tree on the left, exclusion choices on the right, and loading text before directories arrive. Detected test paths are preselected; unticking records production overrides.
- Directory choices are Exclude from scans and Hide from Refactor first by default. Show excluded findings only filters available findings; it cannot generate results for skipped paths.
- Removed the Include test-code findings control from Profiles without rewriting existing scoring settings. Updated help articles and added workspace-rule and comment-rule guides; the existing profile-test-inclusion URL remains valid with updated guidance.

Final frontend unit suite: 657 passed across 63 files. Latest affected components and help changes passed TypeScript, ESLint, formatting, and diff whitespace checks.
Latest Chromium verification: workspace rule selection and tabbed comment-rule creation both passed (2 scenarios).
