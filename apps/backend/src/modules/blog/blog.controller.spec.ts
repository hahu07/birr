import { BlogController } from "./blog.controller";
import type { BlogService } from "./blog.service";
import type { BlogImageStorageService } from "./blog-image-storage.service";

describe("BlogController.listPublic", () => {
  const listPublic = jest.fn().mockResolvedValue([]);
  const controller = new BlogController({ listPublic } as unknown as BlogService, {} as unknown as BlogImageStorageService);

  beforeEach(() => listPublic.mockClear());

  it("works with no ?limit= at all", async () => {
    await controller.listPublic(undefined);
    expect(listPublic).toHaveBeenCalledWith(undefined);
  });

  it("passes a valid limit through, capped at 100", async () => {
    await controller.listPublic("3");
    expect(listPublic).toHaveBeenLastCalledWith(3);
    await controller.listPublic("5000");
    expect(listPublic).toHaveBeenLastCalledWith(100);
  });

  it("treats junk or non-positive values as no limit", async () => {
    for (const bad of ["abc", "0", "-4", ""]) {
      await controller.listPublic(bad);
      expect(listPublic).toHaveBeenLastCalledWith(undefined);
    }
  });
});
