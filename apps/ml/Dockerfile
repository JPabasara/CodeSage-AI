
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements-runtime.lock ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --requirement requirements-runtime.lock

COPY pyproject.toml ./
COPY src/ ./src/
COPY models/satd_v1.joblib /models/satd_v1.joblib
COPY models/risk_v2.joblib /models/risk_v2.joblib
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-build-isolation --no-deps .

ENV CODESAGE_ML_ARTIFACT_DIR=/models
VOLUME ["/models"]

EXPOSE 8001

CMD ["uvicorn", "codesage_ml.main:app", "--host", "0.0.0.0", "--port", "8001"]
