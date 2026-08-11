import os
import time
from celery import Celery

# 1. Setup the Celery application
# We point both the broker and backend to our local Redis server
REDIS_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")

app = Celery(
    "codesage_tasks",
    broker=REDIS_URL,
    backend=REDIS_URL
)

# 2. Define a background task
@app.task(bind=True)
def run_analysis(self, repo_url: str):
    """
    Simulates repository analysis using Tree-sitter, CK metrics, and PyDriller.
    """
    print(f"[*] Starting analysis for repository: {repo_url}")
    
    stages = [
        ("Tree-sitter: Parsing AST & comments", 25),
        ("CK Metrics: Analyzing class couplings & cohesion (WMC, CBO, LCOM)", 50),
        ("PyDriller: Traversing git commit logs & churn history", 75),
        ("ML Models: Running SATD classification & bug-proneness estimator", 90)
    ]

    for step_name, progress in stages:
        time.sleep(1.5)  # Simulate the processing time
        self.update_state(
            state="PROGRESS",
            meta={"step": step_name, "current": progress, "total": 100}
        )
        print(f"[#] {step_name}: {progress}%")

    time.sleep(1.0)
    
    return {
        "status": "completed",
        "repo": repo_url,
        "files_analyzed": 87,
        "classes_found": 24,
        "metrics": {
            "avg_wmc": 14.5,
            "avg_cbo": 3.8,
            "avg_lcom": 0.22,
            "max_dit": 3
        },
        "satd_comments_found": 5,
        "bug_risk_avg": 0.31,
        "technical_debt_hours": 12.5
    }
