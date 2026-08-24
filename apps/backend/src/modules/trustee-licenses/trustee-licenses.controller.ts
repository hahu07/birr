import { Body, Controller, Get, NotFoundException, Param, Post, Put } from "@nestjs/common";
import {
  TrusteeLicensesService,
  CreateTrusteeLicenseInput,
  UpdateTrusteeLicenseInput,
} from "./trustee-licenses.service";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// Reads default to "any authenticated staff" (SessionAuthGuard's floor —
// no metadata needed here); writes are platform_admin-only, same posture
// as PlatformSettingsController — this is Birr's own regulatory-standing
// record, not a per-waqf governance decision, so it doesn't go through
// governed_actions.
@Controller("trustee-licenses")
export class TrusteeLicensesController {
  constructor(private readonly service: TrusteeLicensesService) {}

  @Post()
  @RequiresStaffRole("platform_admin")
  create(@Body() body: CreateTrusteeLicenseInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Put(":id")
  @RequiresStaffRole("platform_admin")
  update(
    @Param("id") id: string,
    @Body() body: UpdateTrusteeLicenseInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.update(id, body, staff.userId);
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const license = await this.service.findById(id);
    if (!license) throw new NotFoundException(`Trustee license "${id}" not found.`);
    return license;
  }
}
