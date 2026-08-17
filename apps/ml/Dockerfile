# Code Sage AI — ML inference container.
#
# Inference only. The `training` extra is deliberately NOT installed: training runs
# offline and the deployed service only answers questions (SRS AI-05). That keeps
# the image small and makes it structurally impossible to train in production.
#
# Model artifacts are NOT baked in. They are mounted at runtime as versioned files,
# so replacing a model is a volume change and a restart, not a rebuild (MAINT-05).

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml ./
COPY src/ ./src/
RUN pip install --no-cache-dir .

ENV CODESAGE_ML_ARTIFACT_DIR=/models
VOLUME ["/models"]

EXPOSE 8001

CMD ["uvicorn", "codesage_ml.main:app", "--host", "0.0.0.0", "--port", "8001"]
