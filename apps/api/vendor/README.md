# vendor/

Third-party binaries that are not Python packages, so `pip` cannot fetch them.

**Nothing in here is committed, and as of 26 Aug 2026 nothing in here is needed either.**

## ck.jar — now fetched by the Dockerfile, not by you

CK measures Java source: lines of code, complexity, nesting depth, method counts (SRS FR-7). It is
a Java program the worker runs as a separate process, which is why the image installs a JRE.

**You do not download it any more.** `apps/api/Dockerfile` fetches it during the build, pinned to
an exact version and verified against a SHA-256:

```dockerfile
ADD --checksum=sha256:2ddfdc275b6b59c2033e03253c4fec511c338fe494a10b70f651bc039a72c74d \
    https://repo1.maven.org/maven2/com/github/mauricioaniche/ck/0.7.0/ck-0.7.0-jar-with-dependencies.jar \
    /opt/ck/ck.jar
```

`CODESAGE_CK_JAR=/opt/ck/ck.jar` points at it, and the next line of the Dockerfile runs the jar and
greps for its usage string — so a build that cannot execute CK fails, instead of producing an image
whose scans die at run time.

### Why it changed

This folder used to hold `ck.jar`, downloaded by hand, and the Dockerfile did `COPY vendor/ /opt/ck/`.

That quietly did not work. `apps/api/vendor/*.jar` is gitignored — correctly, it is 16 MB of build
output that does not belong in git history — so a fresh checkout has no jar. **CI checks out
fresh.** Every image CI published therefore had an empty `/opt/ck/`, and any scan run from one
failed in `extractors/ck_metrics.py` with:

```
CK jar was not found at /opt/ck/ck.jar
```

`run_scan` catches that, writes phase `error` and the message *"The repository could not be
analysed."*, and moves on — so the visible symptom was a scan that failed for no stated reason,
with the real cause only in the worker log. The build was green the whole time, because nothing
asked.

Full write-up: **[deployment log, Entry 5, Finding 1 and Step 2](../../../docs/Project%20Management%20&%20Planning/deployment-implementation-log.md#step-2--the-published-image-could-not-run-a-scan)**.

### Why Maven Central and not GitHub

The old instructions here said to take `ck-0.7.0-jar-with-dependencies.jar` from
<https://github.com/mauricioaniche/ck/releases>. **That page is empty** — the project publishes
tags but no release assets (`gh api repos/mauricioaniche/ck/releases` returns `[]`). Maven Central
carries the same artifact and, unlike a release asset, a published coordinate there is immutable —
so a pinned version plus a digest means the build gets exactly that file or fails loudly.

### Bumping the version

The version and the checksum live on adjacent lines in the Dockerfile and **must be changed
together**:

```bash
curl -sLO https://repo1.maven.org/maven2/com/github/mauricioaniche/ck/<new>/ck-<new>-jar-with-dependencies.jar
sha256sum ck-<new>-jar-with-dependencies.jar
```

Then record the same version string on `AnalysisEngineVersion.ck_version`. A floating version
silently invalidates historical comparisons — REL-10 claims "same revision, consistent results",
and that claim is only checkable if the engine version is written down next to the results.

## Do you ever need a jar in here?

Only to unblock yourself on a branch that predates this change, or to test a CK version before
pinning it. Put it at `apps/api/vendor/ck.jar` and mount or copy it deliberately; the Dockerfile no
longer reads this directory at all.
