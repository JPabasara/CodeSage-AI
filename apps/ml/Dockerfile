# Code Sage AI — ML inference container.
#
# Inference only. The `training` extra is deliberately not installed: training
# runs offline, which keeps the image small and makes it structurally impossible
# to train in production.
#
# The production ML-2 artifact is baked in so registry images are self-contained.
# Local Compose may mount the complete models directory over /models.

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
COPY models/risk_v2.joblib /models/risk_v2.joblib
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-build-isolation --no-deps .

ENV CODESAGE_ML_ARTIFACT_DIR=/models
VOLUME ["/models"]

EXPOSE 8001

CMD ["uvicorn", "codesage_ml.main:app", "--host", "0.0.0.0", "--port", "8001"]
