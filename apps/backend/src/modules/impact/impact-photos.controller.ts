import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ImpactPhotosService, CreateImpactPhotoInput, UpdateImpactPhotoInput } from "./impact-photos.service";
import { ImpactPhotoStorageService, MAX_UPLOAD_BYTES } from "./impact-photo-storage.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { Public } from "../../common/guards/public.decorator";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";

// Same roles as blog authoring (BlogController). Going live is separately
// gated by the governed `impact_photo.publish` action.
const AUTHOR_ROLES = ["mutawalli_officer", "legal_adviser", "compliance_officer", "platform_admin"] as const;

@Controller("impact/photos")
export class ImpactPhotosController {
  constructor(
    private readonly service: ImpactPhotosService,
    private readonly storage: ImpactPhotoStorageService,
  ) {}

  // Public — approved photos only. Declared before ":id" so "staff" isn't read as an id.
  @Public()
  @Get()
  listPublic(@Query("limit") limit?: string) {
    const parsed = Number.parseInt(limit ?? "", 10);
    return this.service.listPublic(parsed > 0 ? Math.min(parsed, 12) : undefined);
  }

  @RequiresStaffRole([...AUTHOR_ROLES])
  @Get("staff")
  listForStaff() {
    return this.service.listForStaff();
  }

  // multipart/form-data; `limits.fileSize` stops multer buffering an
  // oversized upload before the app-layer size check ever runs.
  @RequiresStaffRole([...AUTHOR_ROLES])
  @Post()
  @UseInterceptors(FileInterceptor("photo", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @Body() body: CreateImpactPhotoInput,
    @UploadedFile() photo: Express.Multer.File | undefined,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    if (!photo) throw new BadRequestException("No photo was uploaded.");
    // Validate the attestation before writing a file nobody will reference.
    if (body.consentConfirmed !== "true") {
      throw new BadRequestException(
        "Confirm that Birr has the right to publish this photo and that everyone identifiable in it (or their guardian, for a child) has consented.",
      );
    }
    const { url } = await this.storage.savePhoto(photo);
    return this.service.create(body, url, staff.userId);
  }

  @RequiresStaffRole([...AUTHOR_ROLES])
  @Get(":id")
  async findById(@Param("id") id: string) {
    const photo = await this.service.findById(id);
    if (!photo) throw new NotFoundException(`Impact photo "${id}" not found.`);
    return photo;
  }

  @RequiresStaffRole([...AUTHOR_ROLES])
  @Patch(":id")
  update(@Param("id") id: string, @Body() body: UpdateImpactPhotoInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.update(id, body, staff.userId);
  }

  @RequiresStaffRole([...AUTHOR_ROLES])
  @Post(":id/unpublish")
  unpublish(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.unpublish(id, staff.userId);
  }

  @RequiresStaffRole([...AUTHOR_ROLES])
  @Post(":id/archive")
  archive(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.archive(id, staff.userId);
  }
}
