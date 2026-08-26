# syntax=docker/dockerfile:1.7
# Code Sage AI — backend image.
#
# ONE image, TWO entrypoints (SAD §7 deployment view):
#   API container    → uvicorn codesage_api.main:app        (default CMD below)
#   Worker container → celery -A codesage_api.worker worker (command override)
#
# They share db/, schemas/ and the domain model, so shipping two images would mean
# maintaining the same contract on both sides of a network boundary.
#
# ⚠️ THIS IMAGE CONTAINS A JRE. CK is a Java metrics tool distributed as a JAR, not
# a Python package, so the worker runs it as an external process. Strictly only the
# worker needs the JVM and the jar; they are in the shared image because splitting
# the image to save ~180 MB would cost the shared domain model. Revisit if image
# size becomes a real constraint.

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# git      — the clone stage and PyDriller's history walk
# default-jre-headless — runs the CK jar (SRS FR-7; v1.0 analyses Java only)
RUN apt-get update \
    && apt-get install -y --no-install-recommends git default-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# ── CK ──────────────────────────────────────────────────────────────────────
# CK is a Java program, not a pip package, so it is not in requirements.txt and
# cannot be. It is FETCHED HERE, at build time, rather than copied from vendor/.
#
# WHY THIS CHANGED (J4.1, 26 Aug 2026). It used to be `COPY vendor/ /opt/ck/`,
# with the jar downloaded by hand into apps/api/vendor/. But `apps/api/vendor/*.jar`
# is gitignored — correctly; it is 16 MB of build output that does not belong in
# git history — so a fresh checkout has no jar, and CI checks out fresh.
#
# The result: every image CI published had an EMPTY /opt/ck/, and every scan run
# from one died in ck_metrics.py with "CK jar was not found at /opt/ck/ck.jar".
# The build stayed green throughout, because nothing asked. See the deployment
# log, Entry 5, Finding 1.
#
# Fetching it here means the jar is in the image by construction: CI, a laptop and
# Railway all get the identical bytes, and there is nothing to remember to do.
#
# PINNED AND CHECKSUMMED. Maven Central rather than GitHub, because the CK project
# publishes tags but no release assets — github.com/mauricioaniche/ck/releases is
# empty. A Maven Central coordinate is immutable, so a version plus a digest means
# the build either gets exactly this file or fails loudly.
#
# ⚠️ THE VERSION AND THE CHECKSUM MUST BE CHANGED TOGETHER. To bump CK, take the
# new URL, download it, `sha256sum` it, and update both lines. Then record the same
# version string on AnalysisEngineVersion.ck_version — that is what makes REL-10's
# "same revision, consistent results" claim checkable rather than aspirational.
#
# ck 0.7.0 · sha256 verified 26 Aug 2026 against Maven Central's published .sha1
#
# --chmod=0644 because ADD defaults to 0600 root-only. This image has no USER
# directive today, so root reads it either way — but the web image already runs as
# a non-root user, and the day anyone hardens this one the same way, a 0600 jar
# becomes an unreadable jar and every scan fails on a permission error that looks
# nothing like its cause. One flag now, instead of that afternoon later.
ENV CODESAGE_CK_JAR=/opt/ck/ck.jar
ADD --chmod=0644 --checksum=sha256:2ddfdc275b6b59c2033e03253c4fec511c338fe494a10b70f651bc039a72c74d \
    https://repo1.maven.org/maven2/com/github/mauricioaniche/ck/0.7.0/ck-0.7.0-jar-with-dependencies.jar \
    /opt/ck/ck.jar

# Prove the JRE can actually RUN the jar, not merely that a file of the right size
# landed. Costs about a second, and turns "the deployed worker cannot scan" from a
# runtime mystery into a failed build.
#
# CK with no arguments prints its usage and exits 1, so the exit code cannot be the
# assertion — the pipeline's status is grep's, and grep only succeeds on the real
# usage line.
RUN java -jar "$CODESAGE_CK_JAR" 2>&1 | grep -q "^Usage java -jar ck.jar"

WORKDIR /app

COPY pyproject.toml ./
COPY src/ ./src/
RUN pip install --no-cache-dir .

COPY alembic.ini ./
COPY alembic/ ./alembic/

# Worker scratch space. ~2 GB per concurrent scan, released when the scan ends,
# fails or is cancelled — mount a volume here rather than growing the container's
# writable layer.
ENV CODESAGE_CLONE_DIR=/var/tmp/codesage-clones
RUN mkdir -p ${CODESAGE_CLONE_DIR}

EXPOSE 8000

CMD ["uvicorn", "codesage_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
