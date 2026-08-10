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
# TEAM TODO: pin an exact CK release and record the same version string on
# AnalysisEngineVersion.ck_version, so REL-10's "same revision, consistent results"
# claim is actually checkable. A floating version silently invalidates historical
# comparisons.
ARG CK_VERSION=0.7.0
ENV CODESAGE_CK_JAR=/opt/ck/ck.jar
COPY vendor/ck-${CK_VERSION}-jar-with-dependencies.jar ${CODESAGE_CK_JAR}

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
