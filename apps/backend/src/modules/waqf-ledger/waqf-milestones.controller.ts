import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UnauthorizedException, UploadedFile, UseInterceptors } from "@nestjs/common";
import { Request } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { WaqfMilestonesService, CreateWaqfMilestoneInput, UpdateWaqfMilestoneEvidenceInput } from "./waqf-milestones.service";
import { WaqfMilestoneEvidenceStorageService, MAX_SIZE_BYTES as MAX_EVIDENCE_SIZE_BYTES } from "./waqf-milestone-evidence-storage.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff, isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
import { hasAnySessionCookie } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

// No complete/approve route here, deliberately — waqf.milestone_complete
// is always a governed_actions action, invoked only internally from
// GovernedActionsService.decide(). Same posture as VaultMilestonesController.
@Controller("waqf-milestones")
export class WaqfMilestonesController {
  constructor(
    private readonly service: WaqfMilestonesService,
    private readonly evidenceStorage: WaqfMilestoneEvidenceStorageService,
  ) {}

  @Post()
  create(@Body() body: CreateWaqfMilestoneInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  // @Public() — also reachable by a signed-in Founder viewing their own
  // fund's "Project progress" (read-only; only Birr staff can create(),
  // start, complete via governance, or set evidence). Same
  // session-priority pattern as AssetsController.list().
  @Public()
  @Get()
  async list(@Query("waqfId") waqfId: string | undefined, @Req() request: Request) {
    if (!waqfId) throw new BadRequestException("Query parameter waqfId is required.");
    if (!hasAnySessionCookie(request)) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      const milestones = await this.service.listForFounder(waqfId, founder.id);
      if (milestones === null) throw new NotFoundException(`Waqf "${waqfId}" not found.`);
      return milestones;
    }
    return this.service.list(waqfId);
  }

  // Plain staff action, not governed — see markInProgress()'s own
  // comment on why this doesn't need the same checkpoint complete() does.
  @Post(":id/start")
  markInProgress(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.markInProgress(id, staff.userId);
  }

  // multipart/form-data — same FileInterceptor shape as
  // VaultMilestonesController.setEvidence, `evidence` optional so a
  // staff member can update just the notes without re-uploading a file.
  @Post(":id/evidence")
  @UseInterceptors(FileInterceptor("evidence", { limits: { fileSize: MAX_EVIDENCE_SIZE_BYTES } }))
  async setEvidence(
    @Param("id") id: string,
    @Body() body: UpdateWaqfMilestoneEvidenceInput,
    @UploadedFile() evidence: Express.Multer.File | undefined,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    const evidenceFileUrl = evidence ? (await this.evidenceStorage.saveEvidence(evidence)).url : undefined;
    return this.service.setEvidence(id, { evidenceNotes: body.evidenceNotes, evidenceFileUrl }, staff.userId);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const milestone = await this.service.findById(id);
    if (!milestone) throw new NotFoundException(`WaqfMilestone "${id}" not found.`);
    return milestone;
  }
}
