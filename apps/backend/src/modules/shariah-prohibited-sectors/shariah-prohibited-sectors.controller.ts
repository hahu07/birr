import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { ShariahProhibitedSectorsService, UpsertShariahProhibitedSectorInput } from "./shariah-prohibited-sectors.service";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// Same posture as CompliancePolicySetsController: reads default to any
// authenticated staff (the Shariah screening decision form's own
// multi-select needs this), writes are platform_admin-only.
@Controller("shariah-prohibited-sectors")
export class ShariahProhibitedSectorsController {
  constructor(private readonly service: ShariahProhibitedSectorsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @RequiresAccess("shariah_sector.manage")
  create(@Body() body: UpsertShariahProhibitedSectorInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Put(":id")
  @RequiresAccess("shariah_sector.manage")
  update(
    @Param("id") id: string,
    @Body() body: UpsertShariahProhibitedSectorInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.update(id, body, staff.userId);
  }

  @Delete(":id")
  @RequiresAccess("shariah_sector.manage")
  async remove(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    await this.service.remove(id, staff.userId);
    return { ok: true };
  }
}
