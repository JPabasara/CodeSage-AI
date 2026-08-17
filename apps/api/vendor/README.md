# vendor/

Third-party binaries that are not Python packages, so `pip` cannot fetch them.

Nothing in here is committed. These files are build output from other projects —
tens of megabytes that would sit in git history forever and change nothing about
how the code behaves.

## ck.jar

CK is the tool that measures Java source: lines of code, complexity, nesting
depth, method counts (SRS FR-7). It is a Java program run as a separate process
by the worker, which is why the image installs a JRE.

**Download it once:**

1. Go to <https://github.com/mauricioaniche/ck/releases>
2. Take `ck-0.7.0-jar-with-dependencies.jar`
3. Save it in this folder, renamed to exactly **`ck.jar`**

The Dockerfile copies this whole directory to `/opt/ck/`, and
`CODESAGE_CK_JAR=/opt/ck/ck.jar` points at it.

## You probably do not need this yet

The image builds without the jar, and the API container never touches it. It is
needed only when the scan pipeline in `tasks/scan_pipeline.py` stops raising
`NotImplementedError` and a worker actually analyses a repository.

If the worker runs without it, you get a clear error naming this file — which is
better than a build that fails on a machine where nobody has explained why.
