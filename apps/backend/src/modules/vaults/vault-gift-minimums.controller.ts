import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { UpsertVaultGiftMinimumInput, VaultGiftMinimumsService } from "./vault-gift-minimums.service";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { Public } from "../../common/guards/public.decorator";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

@Controller("vault-gift-minimums")
export class VaultGiftMinimumsController {
  constructor(private readonly service: VaultGiftMinimumsService) {}

  // Public: the giving page shows the minimum before a donor types an amount.
  @Public()
  @Get()
  list() {
    return this.service.list();
  }

  @Put(":currency")
  @RequiresAccess("vault.gift_minimum_set")
  upsert(@Param("currency") currency: string, @Body() body: UpsertVaultGiftMinimumInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.upsert(currency.toUpperCase(), body, staff.userId);
  }
}
