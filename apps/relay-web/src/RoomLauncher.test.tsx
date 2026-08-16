import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { validateRelayPackage, type RelayPackageV1, type RelayRoomRepository } from "@dialogue-atlas/relay-contract";
import { createStarterRelayPackage, newRoomPublishId, RoomLauncher } from "./RoomLauncher";

function launcherRepository(
  createRoomWithPackage: RelayRoomRepository["createRoomWithPackage"],
): RelayRoomRepository {
  return { createRoomWithPackage } as unknown as RelayRoomRepository;
}

describe("createStarterRelayPackage", () => {
  it("produces a package the Relay contract accepts", () => {
    const pkg = createStarterRelayPackage({
      title: "  How do we keep review evidence attached to decisions?  ",
      publishId: newRoomPublishId(1786849557000, 0.42),
      publishedAt: "2026-08-16T05:00:00.000Z",
    });
    expect(validateRelayPackage(pkg).errors).toEqual([]);
    expect(pkg.title).toBe("How do we keep review evidence attached to decisions?");
    expect(pkg.graph.nodes[0]?.label).toBe(pkg.title);
  });

  it("mints a distinct publish id per attempt", () => {
    expect(newRoomPublishId(1786849557000, 0.42)).not.toBe(newRoomPublishId(1786849557001, 0.42));
  });
});

describe("RoomLauncher", () => {
  it("creates the room and reports the room id and invite token", async () => {
    const published: RelayPackageV1[] = [];
    const createRoomWithPackage = vi.fn(async (pkg: RelayPackageV1) => {
      published.push(pkg);
      return { roomId: "room_new", inviteToken: "invite_new" };
    });
    const onCreated = vi.fn();
    render(<RoomLauncher repository={launcherRepository(createRoomWithPackage)} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText("开场问题"), {
      target: { value: "Where does our onboarding lose people?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ roomId: "room_new", inviteToken: "invite_new" }));
    expect(published[0]?.title).toBe("Where does our onboarding lose people?");
  });

  it("rejects an opening question that carries private detail before any request", async () => {
    const createRoomWithPackage = vi.fn(async () => ({ roomId: "room_new", inviteToken: "invite_new" }));
    render(<RoomLauncher repository={launcherRepository(createRoomWithPackage)} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("开场问题"), {
      target: { value: "Why does the import at /home/mina/export.json fail?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("文件路径");
    expect(createRoomWithPackage).not.toHaveBeenCalled();
  });

  it("keeps the form usable when the room cannot be created", async () => {
    const createRoomWithPackage = vi.fn(async () => { throw new Error("room_quota_exhausted"); });
    render(<RoomLauncher repository={launcherRepository(createRoomWithPackage)} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("开场问题"), { target: { value: "Anything" } });
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("room_quota_exhausted");
    expect(screen.getByRole("button", { name: "创建房间" })).toBeEnabled();
  });
});
