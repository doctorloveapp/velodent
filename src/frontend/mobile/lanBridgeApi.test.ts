import { beforeEach, describe, expect, it, vi } from "vitest";
import { pairLanDevice, storedLanDeviceUid, storedLanDeviceToken } from "./lanBridgeApi";

function createLocalStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value)
  };
}

describe("LAN bridge session persistence", () => {
  beforeEach(() => {
    const localStorage = createLocalStorage();
    vi.stubGlobal("window", {
      location: { hostname: "velodent.local", port: "1420" },
      localStorage
    });
    vi.stubGlobal("navigator", { userAgent: "VeloDent Test Device" });
    vi.stubGlobal("crypto", { randomUUID: () => "device-uid-1" });
  });

  it("keeps a stable device uid for repeated pairing attempts", () => {
    expect(storedLanDeviceUid()).toBe("device-uid-1");
    expect(storedLanDeviceUid()).toBe("device-uid-1");
  });

  it("sends device uid and stores the returned device token", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      expect(typeof init?.body).toBe("string");
      expect(JSON.parse(init?.body as string)).toMatchObject({
        device_uid: "device-uid-1",
        pin: "123456"
      });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          device: {
            allowed_lan_cidr: "192.168.1.0/24",
            expires_at: null,
            id: 1,
            label: "VeloDent Test Device",
            revoked_at: null,
            user_id: 1
          },
          token_once: "token-1"
        })
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(pairLanDevice("123456")).resolves.toBe("token-1");
    expect(fetchMock).toHaveBeenCalledWith("http://velodent.local:1422/pair", expect.any(Object));
    expect(storedLanDeviceToken()).toBe("token-1");
  });
});
