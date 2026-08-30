import { WaqfCausesService } from "../waqf-causes.service";
import { WaqfProceedsService } from "../../waqf-proceeds/waqf-proceeds.service";

/**
 * WaqfCausesService and WaqfProceedsService now depend on each other
 * (see each one's own constructor comment) — real code resolves this
 * via NestJS's forwardRef() through the DI container, but a spec file
 * constructing both with plain `new` can't satisfy a genuine
 * constructor cycle that way (each constructor needs a fully-built
 * instance of the other before either exists). Construct one with a
 * placeholder, then patch it in once both real instances exist — safe
 * here because neither constructor actually calls a method on the
 * injected dependency, only stores the reference for later use.
 */
export function createWiredWaqfServices(): { causesService: WaqfCausesService; proceedsService: WaqfProceedsService } {
  const causesService = new WaqfCausesService(undefined as unknown as WaqfProceedsService);
  const proceedsService = new WaqfProceedsService(causesService);
  (causesService as unknown as { proceedsService: WaqfProceedsService }).proceedsService = proceedsService;
  return { causesService, proceedsService };
}
