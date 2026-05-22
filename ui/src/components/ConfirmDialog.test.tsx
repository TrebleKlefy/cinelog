import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ConfirmDialog,
  RemoveFromCatalogCopy,
  RemoveFromShelfCopy,
} from "./ConfirmDialog.tsx";

describe("catalog / shelf confirmation copy", () => {
  it("RemoveFromCatalogCopy quotes the film title", () => {
    render(<RemoveFromCatalogCopy movieTitle="The Matrix" />);
    expect(screen.getByText(/“The Matrix”/)).toBeInTheDocument();
    expect(screen.getByText(/from your catalog/)).toBeInTheDocument();
  });

  it("RemoveFromShelfCopy uses shelf-only wording", () => {
    render(<RemoveFromShelfCopy movieTitle="Alien" />);
    expect(screen.getByText(/“Alien”/)).toBeInTheDocument();
    expect(screen.getByText(/shelf only/)).toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("does not render a portal when closed", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="Hidden"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      >
        <p>inside</p>
      </ConfirmDialog>,
    );

    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows working state on confirm while pending", () => {
    render(
      <ConfirmDialog open title="T" confirmLabel="Remove" pending onConfirm={vi.fn()} onCancel={vi.fn()}>
        Body
      </ConfirmDialog>,
    );

    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  });

  it("Escape while pending does not dismiss", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog open title="Busy" confirmLabel="X" pending onConfirm={vi.fn()} onCancel={onCancel}>
        Wait
      </ConfirmDialog>,
    );

    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("runs onConfirm only when idle", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog open title="T" confirmLabel="Go" onConfirm={onConfirm} onCancel={vi.fn()}>
        Inner
      </ConfirmDialog>,
    );

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Go" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("Escape key invokes onCancel while not pending", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog open title="Dismiss me" confirmLabel="OK" onConfirm={vi.fn()} onCancel={onCancel}>
        Press escape
      </ConfirmDialog>,
    );

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("panel secondary cancel invokes onCancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog open title="T" confirmLabel="OK" destructive={false} onConfirm={vi.fn()} onCancel={onCancel}>
        x
      </ConfirmDialog>,
    );

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
