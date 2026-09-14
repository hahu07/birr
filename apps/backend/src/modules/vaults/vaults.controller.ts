import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  VaultsService,
  CreateVaultInput,
  UpdateVaultStatusInput,
  CreateVaultCauseInput,
  UpdateVaultFeasibilityReportInput,
} from "./vaults.service";
import { VaultCoverStorageService, MAX_SIZE_BYTES as MAX_COVER_SIZE_BYTES } from "./vault-cover-storage.service";
import { VaultDocumentStorageService, MAX_SIZE_BYTES as MAX_DOCUMENT_SIZE_BYTES } from "./vault-document-storage.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { Public } from "../../common/guards/public.decorator";

@Controller("vaults")
export class VaultsController {
  constructor(
    private readonly service: VaultsService,
    private readonly coverStorage: VaultCoverStorageService,
    private readonly documentStorage: VaultDocumentStorageService,
  ) {}

  // Staff-only, no @Public() — matches WaqfCausesController.create()'s
  // own posture: plain CRUD, any authenticated staff member, no
  // dedicated role gate (see VaultsService.updateStatus's own comment on
  // why publishing itself is left at this same trust level for v1).
  @Post()
  create(@Body() body: CreateVaultInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Patch(":id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() body: UpdateVaultStatusInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.updateStatus(id, body.status, staff.userId);
  }

  // Ops Console listing — every vault regardless of status.
  @Get()
  list() {
    return this.service.list();
  }

  // Public listing — open vaults only, no session required. A later
  // slice (public contribution flow) is what actually lets someone give
  // to one of these; this just makes them browsable.
  @Public()
  @Get("open")
  listOpen() {
    return this.service.listOpen();
  }

  // @Public() — the vault's own donation-page lookup by its public slug,
  // not just an Ops Console concern. Still 404s identically whether the
  // slug doesn't exist at all or the vault isn't open yet, matching this
  // codebase's own "don't distinguish not-found from not-yours" posture
  // (see e.g. WaqfCausesService.listForFounder's comment) — here the
  // reason is simpler: a draft/closed vault's donation page shouldn't be
  // guessable-and-confirmable by slug before staff actually publish it.
  @Public()
  @Get("by-slug/:slug")
  async findBySlug(@Param("slug") slug: string) {
    const vault = await this.service.findBySlug(slug);
    if (!vault || vault.status !== "open") throw new NotFoundException(`Vault "${slug}" not found.`);
    return vault;
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const vault = await this.service.findById(id);
    if (!vault) throw new NotFoundException(`Vault "${id}" not found.`);
    return vault;
  }

  @Post("causes")
  createCause(@Body() body: CreateVaultCauseInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.createCause(body, staff.userId);
  }

  @Get(":id/causes")
  listCauses(@Param("id") id: string) {
    return this.service.listCauses(id);
  }

  // multipart/form-data, same FileInterceptor shape as
  // FoundersController's establish() route — no `storage` option
  // configured, so multer buffers file.buffer in memory (never touches
  // disk before VaultCoverStorageService validates it). `limits.fileSize`
  // matches that service's own cap for the same reason noted there:
  // without it, multer buffers the whole upload before the app-layer
  // size check ever runs.
  @Post(":id/cover")
  @UseInterceptors(FileInterceptor("cover", { limits: { fileSize: MAX_COVER_SIZE_BYTES } }))
  async uploadCover(
    @Param("id") id: string,
    @UploadedFile() cover: Express.Multer.File | undefined,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    if (!cover) throw new BadRequestException("No cover image file was uploaded.");
    const { url } = await this.coverStorage.saveCover(cover);
    return this.service.setCoverImage(id, url, staff.userId);
  }

  // multipart/form-data — same shape as uploadCover above. `report`
  // optional so a title-only edit doesn't require re-uploading the
  // file, mirroring VaultMilestonesController's own evidence route.
  @Post(":id/feasibility-report")
  @UseInterceptors(FileInterceptor("report", { limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES } }))
  async setFeasibilityReport(
    @Param("id") id: string,
    @Body() body: UpdateVaultFeasibilityReportInput,
    @UploadedFile() report: Express.Multer.File | undefined,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    const url = report ? (await this.documentStorage.saveDocument(report)).url : undefined;
    return this.service.setFeasibilityReport(id, { title: body.title, url }, staff.userId);
  }
}
