import { ServiceUnavailableException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  const controller = new HealthController();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("check() returns ok when the database is reachable", async () => {
    await expect(controller.check()).resolves.toEqual({ status: "ok" });
  });

  test("check() throws ServiceUnavailableException when the database is unreachable", async () => {
    // prisma.$disconnect() doesn't reliably simulate this — the client
    // lazily reconnects on the very next query, so a real query right
    // after disconnecting can still succeed. Mocking $queryRaw to reject
    // is the reliable way to exercise this branch against the real
    // (connected) shared client every other spec file also uses.
    const queryRawSpy = jest.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("simulated DB outage"));
    try {
      await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
    } finally {
      queryRawSpy.mockRestore();
    }
  });
});
