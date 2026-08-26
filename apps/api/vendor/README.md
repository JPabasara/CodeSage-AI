# vendor/

Third-party binaries used by local development. Binaries in this directory are
ignored by Git and are not used by the Docker build.

## ck.jar

CK measures Java source metrics such as lines of code, complexity, nesting depth,
and method counts (SRS FR-7). The worker runs it as a separate Java process.

The Dockerfile downloads the published CK 0.7.0 fat JAR from Maven Central during
its disposable `ck-fetch` stage. That release is pinned to upstream commit
`54c21707a7a27a9511dba9a97d19c3554a5a44ac`, and Docker verifies this SHA-256:

```text
2ddfdc275b6b59c2033e03253c4fec511c338fe494a10b70f651bc039a72c74d
```

The build stops if the downloaded bytes do not match. Only the verified JAR is
copied to `/opt/ck/ck.jar` in the runtime image; download tools and intermediate
files are discarded. `CODESAGE_CK_JAR=/opt/ck/ck.jar` tells the scan worker where
to find it.

Consequently, a clean checkout needs no manually downloaded JAR. A local
`vendor/ck.jar` is useful only when running the worker directly outside Docker.

## Upgrading CK

1. Select a released CK tag and record the commit to which the tag resolves.
2. Download its `jar-with-dependencies` artifact and calculate its SHA-256.
3. Update `CK_VERSION`, `CK_COMMIT`, and `CK_SHA256` together in the Dockerfile.
4. Rebuild the image and run the extraction and end-to-end scan tests.

Never update only the URL or disable the checksum check. Historical scan results
must remain attributable to a known analysis-engine version.
