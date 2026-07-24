import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { ConnectRepo } from "@/components/projects/connect-repo";

test("submits a public repository URL", async () => {
  const onConnect = vi.fn();
  render(<ConnectRepo onConnect={onConnect} />);

  await userEvent.type(screen.getByLabelText(/repository url/i), "https://github.com/acme/x");
  await userEvent.click(screen.getByRole("button", { name: /connect/i }));

  expect(onConnect).toHaveBeenCalledWith("https://github.com/acme/x");
});
