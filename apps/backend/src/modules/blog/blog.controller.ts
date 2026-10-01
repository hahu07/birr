import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { BlogService, CreateBlogArticleInput, UpdateBlogArticleInput } from "./blog.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { Public } from "../../common/guards/public.decorator";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";

// Who may author/edit/take down an article. Deliberately NOT everyone on
// staff (unlike Vault's plain CRUD): this is public marketing for a
// fiduciary service. Going *live* is separately gated by the governed
// `blog.publish` action — see GovernedActionsService.
const BLOG_AUTHOR_ROLES = ["mutawalli_officer", "legal_adviser", "compliance_officer", "platform_admin"] as const;

@Controller("blog-articles")
export class BlogController {
  constructor(private readonly service: BlogService) {}

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

  @RequiresStaffRole([...BLOG_AUTHOR_ROLES])
  @Post()
  create(@Body() body: CreateBlogArticleInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @RequiresStaffRole([...BLOG_AUTHOR_ROLES])
  @Get()
  list() {
    return this.service.listForStaff();
  }

  @RequiresStaffRole([...BLOG_AUTHOR_ROLES])
  @Get(":id")
  async findById(@Param("id") id: string) {
    const article = await this.service.findById(id);
    if (!article) throw new NotFoundException(`Blog article "${id}" not found.`);
    return article;
  }

  @RequiresStaffRole([...BLOG_AUTHOR_ROLES])
  @Patch(":id")
  update(@Param("id") id: string, @Body() body: UpdateBlogArticleInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.update(id, body, staff.userId);
  }

  @RequiresStaffRole([...BLOG_AUTHOR_ROLES])
  @Post(":id/unpublish")
  unpublish(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.unpublish(id, staff.userId);
  }

  @RequiresStaffRole([...BLOG_AUTHOR_ROLES])
  @Post(":id/archive")
  archive(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.archive(id, staff.userId);
  }
}
