import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { BlogService, CreateBlogArticleInput, UpdateBlogArticleInput } from "./blog.service";
import { BlogImageStorageService, MAX_BLOG_IMAGE_BYTES } from "./blog-image-storage.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { Public } from "../../common/guards/public.decorator";
import { RequiresAccess } from "../../common/guards/permission.guard";


@Controller("blog-articles")
export class BlogController {
  constructor(
    private readonly service: BlogService,
    private readonly images: BlogImageStorageService,
  ) {}

  // ---- Public (no session) — published articles only ----

  @Public()
  @Get("public")
  listPublic(@Query("limit") limit?: string) {
    // Parsed by hand: ParseIntPipe's `optional` option isn't honoured by
    // this Nest version, so a request with no ?limit= got a 400 (found
    // live, 2026-10-01). A junk or non-positive value just means "no
    // limit", capped at 100.
    const parsed = Number.parseInt(limit ?? "", 10);
    return this.service.listPublic(parsed > 0 ? Math.min(parsed, 100) : undefined);
  }

  @Public()
  @Get("public/:slug")
  async findPublic(@Param("slug") slug: string) {
    const article = await this.service.findPublicBySlug(slug);
    if (!article) throw new NotFoundException(`Article "${slug}" not found.`);
    return article;
  }

  // ---- Staff only ----

  @RequiresAccess("blog.manage")
  @Post()
  create(@Body() body: CreateBlogArticleInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @RequiresAccess("blog.manage")
  @Get()
  list() {
    return this.service.listForStaff();
  }

  @RequiresAccess("blog.manage")
  @Get(":id")
  async findById(@Param("id") id: string) {
    const article = await this.service.findById(id);
    if (!article) throw new NotFoundException(`Blog article "${id}" not found.`);
    return article;
  }

  @RequiresAccess("blog.manage")
  @Patch(":id")
  update(@Param("id") id: string, @Body() body: UpdateBlogArticleInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.update(id, body, staff.userId);
  }

  @RequiresAccess("blog.manage")
  @Post(":id/unpublish")
  unpublish(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.unpublish(id, staff.userId);
  }

  @RequiresAccess("blog.manage")
  @Post(":id/archive")
  archive(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.archive(id, staff.userId);
  }

  // multipart/form-data, field "image". `limits.fileSize` stops multer buffering
  // an oversized upload before the app-layer check runs. Drafts only, checked
  // before the file is stored.
  @RequiresAccess("blog.manage")
  @Post(":id/cover")
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: MAX_BLOG_IMAGE_BYTES } }))
  async uploadCover(
    @Param("id") id: string,
    @UploadedFile() image: Express.Multer.File | undefined,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    if (!image) throw new BadRequestException("No image was uploaded.");
    await this.service.assertEditable(id);
    const { url } = await this.images.saveImage(image);
    return this.service.setCover(id, url, staff.userId);
  }

  @RequiresAccess("blog.manage")
  @Post(":id/cover/remove")
  removeCover(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.setCover(id, null, staff.userId);
  }

  // An image to place inside the article text. Returns only its URL — the
  // editor inserts it into the body as ![description](url).
  @RequiresAccess("blog.manage")
  @Post(":id/images")
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: MAX_BLOG_IMAGE_BYTES } }))
  async uploadBodyImage(@Param("id") id: string, @UploadedFile() image: Express.Multer.File | undefined) {
    if (!image) throw new BadRequestException("No image was uploaded.");
    await this.service.assertEditable(id);
    return this.images.saveImage(image);
  }
}
