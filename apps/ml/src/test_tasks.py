import unittest
from unittest.mock import patch
from tasks import app, run_analysis

class TestCeleryTasks(unittest.TestCase):
    def setUp(self):
        # Enforce that tasks run synchronously during tests without Redis
        app.conf.update(task_always_eager=True)

    def test_run_analysis_success(self):
        """
        Verify that the run_analysis task executes successfully and returns the correct payload.
        """
        # We patch time.sleep to make the test run instantly instead of waiting 10 seconds
        with patch('time.sleep', return_value=None):
            repo_url = "https://github.com/test/repo.git"
            
            # Run the task synchronously
            result = run_analysis.delay(repo_url)
            
            # Assertions
            self.assertEqual(result.status, "SUCCESS")
            self.assertEqual(result.result["status"], "completed")
            self.assertEqual(result.result["repo"], repo_url)
            self.assertEqual(result.result["findings_count"], 42)

if __name__ == "__main__":
    unittest.main()
