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

# CK 0.7.0 is tag `ck-0.7.0` at this exact upstream commit. Fetching the
# published fat JAR avoids Maven timestamps making locally built output differ.
# The checksum makes the build fail closed if the URL serves different bytes.
FROM alpine:3.22 AS ck-fetch

ARG CK_VERSION=0.7.0
ARG CK_COMMIT=54c21707a7a27a9511dba9a97d19c3554a5a44ac
ARG CK_SHA256=2ddfdc275b6b59c2033e03253c4fec511c338fe494a10b70f651bc039a72c74d

RUN apk add --no-cache ca-certificates curl \
    && curl --fail --location --silent --show-error \
        --retry 5 --retry-all-errors --retry-delay 2 \
        "https://repo1.maven.org/maven2/com/github/mauricioaniche/ck/${CK_VERSION}/ck-${CK_VERSION}-jar-with-dependencies.jar" \
        --output /ck.jar \
    && echo "${CK_SHA256}  /ck.jar" | sha256sum -c

FROM python:3.12-slim AS base

ARG CK_VERSION=0.7.0
ARG CK_COMMIT=54c21707a7a27a9511dba9a97d19c3554a5a44ac
ARG CK_SHA256=2ddfdc275b6b59c2033e03253c4fec511c338fe494a10b70f651bc039a72c74d

LABEL org.codesage.ck.version="${CK_VERSION}" \
      org.codesage.ck.source-commit="${CK_COMMIT}" \
      org.codesage.ck.sha256="${CK_SHA256}"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# git      — the clone stage and PyDriller's history walk
# default-jre-headless — runs the CK jar (SRS FR-7; v1.0 analyses Java only)
RUN apt-get update \
    && apt-get install -y --no-install-recommends git default-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# ── CK ──────────────────────────────────────────────────────────────────────
# CK is not a pip package. The first stage downloads the release tied to the
# pinned upstream commit and verifies its SHA-256. Only the verified JAR is
# copied here; curl and the download stage do not enter the runtime image.
# See apps/api/vendor/README.md for the controlled upgrade procedure.
ENV CODESAGE_CK_JAR=/opt/ck/ck.jar
COPY --from=ck-fetch /ck.jar /opt/ck/ck.jar

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
