import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { FindingDetailPanel } from "@/components/dashboard/finding-detail-panel";
import { mockFindings } from "@/lib/mocks/fixtures";

test("shows the finding's reason and location when open", () => {
  const finding = mockFindings[0];
  render(<FindingDetailPanel finding={finding} open onOpenChange={vi.fn()} />);

  expect(screen.getByText(finding.reason)).toBeInTheDocument();
  expect(screen.getByText(`${finding.file}:${finding.line}`)).toBeInTheDocument();
});

test("renders nothing selectable when there is no finding", () => {
  render(<FindingDetailPanel finding={null} open={false} onOpenChange={vi.fn()} />);
  expect(screen.queryByText(mockFindings[0].reason)).not.toBeInTheDocument();
});
