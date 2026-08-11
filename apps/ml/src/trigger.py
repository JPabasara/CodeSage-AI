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
    last_step = None
    while not result.ready():
        info = result.info
        if result.state == "PROGRESS" and info:
            step = info.get("step")
            progress = info.get("current")
            if step != last_step:
                print(f"    -> Active Step: {step}")
                last_step = step
            print(f"       [{progress}% completed]")
        else:
            print(f"    -> Current State: {result.state}")
        time.sleep(1.5)

    # 3. Fetch and print formatted final report
    print(f"\n[4] Task Finished! Status: {result.state}")
    
    res = result.result
    if result.state == "SUCCESS" and res:
        print("\n" + "="*45)
        print("          TECHNICAL DEBT ANALYSIS REPORT      ")
        print("="*45)
        print(f" Target Repository    : {res.get('repo')}")
        print(f" Files Analyzed       : {res.get('files_analyzed')}")
        print(f" Classes Detected     : {res.get('classes_found')}")
        print("-"*45)
        print(" CHIDAMBER & KEMERER (CK) OO DESIGN METRICS:")
        metrics = res.get("metrics", {})
        print(f"  - Weighted Methods per Class (WMC) : {metrics.get('avg_wmc')}")
        print(f"  - Coupling Between Objects (CBO)    : {metrics.get('avg_cbo')}")
        print(f"  - Lack of Cohesion in Methods (LCOM): {metrics.get('avg_lcom')}")
        print(f"  - Max Inheritance Depth (DIT)      : {metrics.get('max_dit')}")
        print("-"*45)
        print(f" SATD Comments Found  : {res.get('satd_comments_found')}")
        print(f" Avg Bug-Proneness    : {res.get('bug_risk_avg') * 100:.1f}%")
        print(f" Technical Debt Est.  : {res.get('technical_debt_hours')} hours")
        print("="*45 + "\n")
    else:
        print(f"    Error/Output: {res}")

if __name__ == "__main__":
    main()
