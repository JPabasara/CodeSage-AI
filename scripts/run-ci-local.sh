#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE_NAME=${CODESAGE_CI_IMAGE:-codesage-ci-local}

docker build \
    --file "$REPOSITORY_ROOT/Dockerfile.ci" \
    --tag "$IMAGE_NAME" \
    "$REPOSITORY_ROOT"

docker run --rm \
    --network host \
    --volume /var/run/docker.sock:/var/run/docker.sock \
    "$IMAGE_NAME"
