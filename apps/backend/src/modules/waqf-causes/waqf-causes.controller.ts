import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { WaqfCausesService, CreateWaqfCauseInput } from "./waqf-causes.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

@Controller("waqf-causes")
export class WaqfCausesController {
  constructor(private readonly service: WaqfCausesService) {}

  @Post()
  create(@Body() body: CreateWaqfCauseInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Get()
  list(@Query("waqfId") waqfId?: string) {
    if (!waqfId) {
      throw new BadRequestException("Query parameter waqfId is required.");
    }
    return this.service.list(waqfId);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const cause = await this.service.findById(id);
    if (!cause) throw new NotFoundException(`WaqfCause "${id}" not found.`);
    return cause;
  }
}
