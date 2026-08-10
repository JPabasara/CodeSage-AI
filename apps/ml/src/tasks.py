import time
from celery import Celery

# 1. Setup the Celery application
# We point both the broker and backend to our local Redis server
REDIS_URL = "redis://localhost:6379/0"

app = Celery(
    "codesage_tasks",
    broker=REDIS_URL,
    backend=REDIS_URL
)

# 2. Define a background task
@app.task(bind=True)
def run_analysis(self, repo_url: str):
    """
    Simulates a heavy static analysis scan.
    """
    print(f"[*] Starting analysis for repository: {repo_url}")
    
    # Simulate a step-by-step progress update
    for i in range(1, 6):
        time.sleep(2)  # Simulate 2 seconds of work (Lizard/PyDriller)
        progress = i * 20
        
        # Update Celery's state so we can poll the progress from FastAPI
        self.update_state(state="PROGRESS", meta={"current": progress, "total": 100})
        print(f"[#] Scan progress: {progress}%")

    return {"status": "completed", "repo": repo_url, "findings_count": 42}
