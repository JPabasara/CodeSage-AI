import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { ScanControl } from "@/components/layout/scan-control";

test("idle shows a Scan button that fires onScan", async () => {
  const onScan = vi.fn();
  render(<ScanControl phase="idle" progress={0} onScan={onScan} />);
  await userEvent.click(screen.getByRole("button", { name: /scan/i }));
  expect(onScan).toHaveBeenCalledTimes(1);
});

test("running shows progress and a Stop button that fires onStop", async () => {
  const onStop = vi.fn();
  render(<ScanControl phase="running" progress={47} onStop={onStop} />);
  expect(screen.getByText(/47%/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /stop/i }));
  expect(onStop).toHaveBeenCalledTimes(1);
});
