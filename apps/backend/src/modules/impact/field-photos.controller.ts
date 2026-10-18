import { BadRequestException, Body, Controller, Get, Param, Post, Query, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { FieldPhotosService, UploadFieldPhotosInput } from "./field-photos.service";
import { FieldPhotoStorageService, MAX_UPLOAD_BYTES } from "./field-photo-storage.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { Public } from "../../common/guards/public.decorator";
import { RequiresAccess } from "../../common/guards/permission.guard";

const MAX_FILES_PER_UPLOAD = 20;

@Controller("impact/photos")
export class FieldPhotosController {
  constructor(
    private readonly service: FieldPhotosService,
    private readonly storage: FieldPhotoStorageService,
  ) {}

  // Public — the homepage impact wall. Declared before ":id" routes so "staff" isn't read as an id.
  @Public()
  @Get()
  listPublic(@Query("limit") limit?: string) {
    const parsed = Number.parseInt(limit ?? "", 10);
    return this.service.listPublic(parsed > 0 ? Math.min(parsed, 60) : undefined);
  }

  @RequiresAccess("impact_photo.manage")
  @Get("staff")
  listForVault(@Query("vaultId") vaultId?: string) {
    if (!vaultId) throw new BadRequestException("vaultId is required.");
    return this.service.listForVault(vaultId);
  }

  // multipart/form-data, many photos in one request. `limits.fileSize`
  // stops multer buffering an oversized file before the app-layer check runs.
  @RequiresAccess("impact_photo.manage")
  @Post()
  @UseInterceptors(FilesInterceptor("photos", MAX_FILES_PER_UPLOAD, { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @Body() body: UploadFieldPhotosInput,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    if (!files || files.length === 0) throw new BadRequestException("No photos were uploaded.");
    // Validate the attestation and the event before writing any file nobody will reference.
    await this.service.validateUpload(body);
    const urls: string[] = [];
    for (const file of files) urls.push((await this.storage.savePhoto(file)).url);
    return this.service.createMany(body, urls, staff.userId);
  }

  @RequiresAccess("impact_photo.manage")
  @Post(":id/hide")
  hide(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.hide(id, staff.userId);
  }

  @RequiresAccess("impact_photo.manage")
  @Post(":id/unhide")
  unhide(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.unhide(id, staff.userId);
  }

  @RequiresAccess("impact_photo.manage")
  @Post(":id/archive")
  archive(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.archive(id, staff.userId);
  }
}
