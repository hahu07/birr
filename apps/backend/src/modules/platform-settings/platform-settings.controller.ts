import { Body, Controller, Delete, Get, Param, Put, Req } from "@nestjs/common";
import { IsString } from "class-validator";
import type { Request } from "express";
import { SettingsService } from "../../common/settings/settings.service";
import { PROVIDER_FIELDS } from "../../common/settings/provider-fields";
import { resolveBirrStaffFromSession } from "../../common/auth/current-birr-staff";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";

class SetSettingBody {
  @IsString()
  value!: string;
}

@Controller("platform-settings")
export class PlatformSettingsController {
  constructor(private readonly settings: SettingsService) {}

  // Read access is lower-stakes than write (no plaintext value is ever
  // returned, see SettingsService.getStatus()) but still requires being
  // signed-in staff — not fully public.
  @Get()
  async list(@Req() request: Request) {
    await resolveBirrStaffFromSession(request);

    const result: Record<string, unknown> = {};
    for (const [provider, fields] of Object.entries(PROVIDER_FIELDS)) {
      result[provider] = {
        fields: await Promise.all(
          fields.map(async (field) => ({
            key: field.key,
            label: field.label,
            secret: field.secret,
            ...(await this.settings.getStatus(provider, field.key)),
          })),
        ),
      };
    }
    return result;
  }

  @Put(":provider/:key")
  @RequiresStaffRole("platform_admin")
  async set(
    @Param("provider") provider: string,
    @Param("key") key: string,
    @Body() body: SetSettingBody,
    @Req() request: Request & { birrStaff: { userId: string } },
  ) {
    await this.settings.set(provider, key, body.value, request.birrStaff.userId);
    return { ok: true };
  }

  @Delete(":provider/:key")
  @RequiresStaffRole("platform_admin")
  async clear(
    @Param("provider") provider: string,
    @Param("key") key: string,
    @Req() request: Request & { birrStaff: { userId: string } },
  ) {
    await this.settings.clear(provider, key, request.birrStaff.userId);
    return { ok: true };
  }
}
