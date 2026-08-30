import { Controller, Get } from "@nestjs/common";
import { RolesService } from "./roles.service";

// No @RequiresPermission/@RequiresStaffRole — same convention as
// invitations.controller.ts / waqf-case-assignments.controller.ts for a
// route that isn't a governed_actions concept. Every staff member
// benefits from seeing the org's own governance structure (who they'd
// need to route an approval to), so this is gated at SessionAuthGuard's
// default floor only: any authenticated Birr staff session, no specific
// role required.
@Controller("roles")
export class RolesController {
  constructor(private readonly service: RolesService) {}

  @Get()
  list() {
    return this.service.list();
  }
}
