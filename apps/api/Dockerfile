# syntax=docker/dockerfile:1.7
# Code Sage AI — backend image.
#
# One image, two entrypoints:
#   API container    → uvicorn codesage_api.main:app        (default CMD below)
#   Worker container → celery -A codesage_api.worker worker (command override)
#
# They share db/, schemas/ and the domain model, so shipping two images would mean
# maintaining the same contract on both sides of a network boundary.
#
# ⚠️ This image contains a JRE. CK is a Java metrics tool distributed as a JAR,
# so the worker runs it as an external process. Only the worker needs it, but
# splitting the image to save ~180 MB would cost the shared domain model.

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# git      — the clone stage and PyDriller's history walk
# default-jre-headless — runs the CK jar (v1.0 analyses Java only)
RUN apt-get update \
    && apt-get install -y --no-install-recommends git default-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# ── CK ──────────────────────────────────────────────────────────────────────
# CK is a Java program, not a pip package, so it is fetched here at build time
# rather than copied from a vendor directory.
#
# It used to be `COPY vendor/ /opt/ck/`, with the jar downloaded by hand — but the
# jar is gitignored, correctly, and CI checks out fresh. So every published image
# had an empty /opt/ck/ and every scan run from one died, while the build stayed
# green because nothing asked. Fetching it here puts the jar in the image by
# construction: CI, a laptop and the host all get identical bytes.
#
# Pinned and checksummed, from Maven Central rather than GitHub: the CK project
# publishes tags but no release assets, and a Maven coordinate is immutable — so
# a version plus a digest either gets exactly this file or fails loudly.
#
# ⚠️ The version and the checksum must be changed together. To bump CK, download
# the new URL, `sha256sum` it, update both lines, and record the same version
# string on AnalysisEngineVersion.ck_version.
#
# ck 0.7.0 · sha256 verified against Maven Central's published .sha1
#
# --chmod=0644 because ADD defaults to 0600 root-only. Nothing here runs as a
# non-root user today, but the day it does, a 0600 jar becomes an unreadable jar
# and every scan fails on a permission error that looks nothing like its cause.
ENV CODESAGE_CK_JAR=/opt/ck/ck.jar
ADD --chmod=0644 --checksum=sha256:2ddfdc275b6b59c2033e03253c4fec511c338fe494a10b70f651bc039a72c74d \
    https://repo1.maven.org/maven2/com/github/mauricioaniche/ck/0.7.0/ck-0.7.0-jar-with-dependencies.jar \
    /opt/ck/ck.jar

# Prove the JRE can actually run the jar, not merely that a file of the right size
# landed. About a second, and it turns "the deployed worker cannot scan" from a
# runtime mystery into a failed build.
#
# CK with no arguments prints its usage and exits 1, so the exit code cannot be
# the assertion — grep's is, and grep only succeeds on the real usage line.
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
