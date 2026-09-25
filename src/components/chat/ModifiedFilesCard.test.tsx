import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ModifiedFilesCard } from "./ModifiedFilesCard";

const changes = vi.hoisted(() => ({
  files: [
    {
      path: "src/pages/Index.tsx",
      type: "modified" as const,
      oldContent: "a",
      newContent: "b",
    },
  ],
}));

vi.mock("@/hooks/useVersionChanges", () => ({
  useVersionChanges: () => ({
    changes: changes.files,
    loading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/useVersionPreview", () => ({
  useVersionPreview: () => ({ send: vi.fn() }),
}));

const props = {
  appId: 6,
  commitHash: "abc123",
  onUndo: vi.fn(),
  isUndoLoading: false,
  onRetry: vi.fn(),
  isRetryLoading: false,
  isAnyVersionMutationPending: false,
};

it("drops Undo and Retry on a factory phase while keeping the file list", () => {
  const view = render(<ModifiedFilesCard {...props} hideRevisionActions />);
  expect(screen.getByText("Index.tsx")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

  view.rerender(<ModifiedFilesCard {...props} />);
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});
