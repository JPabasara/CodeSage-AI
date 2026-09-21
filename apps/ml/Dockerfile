# Code Sage AI — ML inference container.
#
# Inference only. The `training` extra is deliberately not installed: training
# runs offline, which keeps the image small and makes it structurally impossible
# to train in production.
#
# Model artifacts are not baked in. They are mounted at runtime as versioned
# files, so replacing a model is a volume change and a restart, not a rebuild.

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Runtime dependencies change much less often than application source. Keep them
# in their own cached layer so editing src/ never redownloads NumPy/SciPy.
COPY requirements-runtime.lock ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --requirement requirements-runtime.lock

COPY pyproject.toml ./
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-build-isolation --no-deps .

ENV CODESAGE_ML_ARTIFACT_DIR=/models
VOLUME ["/models"]

EXPOSE 8001

CMD ["uvicorn", "codesage_ml.main:app", "--host", "0.0.0.0", "--port", "8001"]
