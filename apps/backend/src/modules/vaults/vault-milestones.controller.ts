import { Body, Controller, Get, NotFoundException, Param, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { VaultMilestonesService, CreateVaultMilestoneInput, UpdateVaultMilestoneEvidenceInput } from "./vault-milestones.service";
import { VaultMilestoneEvidenceStorageService, MAX_SIZE_BYTES as MAX_EVIDENCE_SIZE_BYTES } from "./vault-milestone-evidence-storage.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// No complete/approve route here, deliberately — vault.milestone_complete
// is always a governed_actions action, invoked only internally from
// GovernedActionsService.decide(). Same posture as
// VaultDistributionsController (its own approve() lives the same way).
@Controller("vault-milestones")
export class VaultMilestonesController {
  constructor(
    private readonly service: VaultMilestonesService,
    private readonly evidenceStorage: VaultMilestoneEvidenceStorageService,
  ) {}

  @Post()
  create(@Body() body: CreateVaultMilestoneInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Get()
  list(@Query("vaultId") vaultId: string) {
    return this.service.list(vaultId);
  }

  // Plain staff action, not governed — see markInProgress()'s own
  // comment on why this doesn't need the same checkpoint complete() does.
  @Post(":id/start")
  markInProgress(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.markInProgress(id, staff.userId);
  }

  // multipart/form-data — same FileInterceptor shape as
  // VaultsController.uploadCover, `evidence` optional so a staff member
  // can update just the notes without re-uploading a file (or vice
  // versa; setEvidence() only overwrites whichever field is actually
  // sent).
  @Post(":id/evidence")
  @UseInterceptors(FileInterceptor("evidence", { limits: { fileSize: MAX_EVIDENCE_SIZE_BYTES } }))
  async setEvidence(
    @Param("id") id: string,
    @Body() body: UpdateVaultMilestoneEvidenceInput,
    @UploadedFile() evidence: Express.Multer.File | undefined,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    const evidenceFileUrl = evidence ? (await this.evidenceStorage.saveEvidence(evidence)).url : undefined;
    return this.service.setEvidence(id, { evidenceNotes: body.evidenceNotes, evidenceFileUrl }, staff.userId);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const milestone = await this.service.findById(id);
    if (!milestone) throw new NotFoundException(`VaultMilestone "${id}" not found.`);
    return milestone;
  }
}
