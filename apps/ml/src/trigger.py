import time
from tasks import run_analysis

def main():
    repo = "https://github.com/JPabasara/CodeSage-AI.git"
    print(f"[1] Enqueuing task for: {repo}")
    
    # 1. delay() sends the task to Redis immediately without blocking python
    result = run_analysis.delay(repo)
    print(f"[2] Task enqueued! Task ID: {result.id}")

    # 2. Poll the result backend for status updates
    print("[3] Monitoring task progress...")
    while not result.ready():
        # Check current state/metadata
        info = result.info
        if result.state == "PROGRESS" and info:
            print(f"    -> Progress: {info.get('current')}%")
        else:
            print(f"    -> Current State: {result.state}")
        time.sleep(1.5)

    # 3. Fetch final result
    print(f"\n[4] Task Finished! Status: {result.state}")
    print(f"    Result: {result.result}")

if __name__ == "__main__":
    main()
