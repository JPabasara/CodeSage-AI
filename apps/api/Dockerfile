
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends git default-jre-headless tini unzip \
    && rm -rf /var/lib/apt/lists/*

ENV CODESAGE_CK_JAR=/opt/ck/ck.jar
ADD --chmod=0644 --checksum=sha256:2ddfdc275b6b59c2033e03253c4fec511c338fe494a10b70f651bc039a72c74d \
    https://repo1.maven.org/maven2/com/github/mauricioaniche/ck/0.7.0/ck-0.7.0-jar-with-dependencies.jar \
    /opt/ck/ck.jar

RUN java -jar "$CODESAGE_CK_JAR" 2>&1 | grep -q "^Usage java -jar ck.jar"

# PMD 7.27.0 is pinned and checksummed for the optional worker detector stage.
ENV CODESAGE_PMD_BIN=/opt/pmd/bin/pmd
ADD --checksum=sha256:4ae396ffaf2b0d3ef0b73a10b2925e77066f73d57a4ce9078c60e7302bcddec9 \
    https://github.com/pmd/pmd/releases/download/pmd_releases%2F7.27.0/pmd-dist-7.27.0-bin.zip \
    /tmp/pmd.zip
RUN unzip -q /tmp/pmd.zip -d /opt \
    && mv /opt/pmd-bin-7.27.0 /opt/pmd \
    && rm /tmp/pmd.zip \
    && "$CODESAGE_PMD_BIN" --version | grep -q "PMD 7.27.0"

WORKDIR /app

COPY pyproject.toml ./
COPY src/ ./src/
RUN pip install --no-cache-dir .

COPY alembic.ini ./
COPY alembic/ ./alembic/
COPY THIRD_PARTY_LICENSES/ /app/THIRD_PARTY_LICENSES/

ENV CODESAGE_CLONE_DIR=/var/tmp/codesage-clones
RUN mkdir -p ${CODESAGE_CLONE_DIR}

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["uvicorn", "codesage_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
