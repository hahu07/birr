import { Module } from "@nestjs/common";
import { ShariahProhibitedSectorsService } from "./shariah-prohibited-sectors.service";
import { ShariahProhibitedSectorsController } from "./shariah-prohibited-sectors.controller";

@Module({
  controllers: [ShariahProhibitedSectorsController],
  providers: [ShariahProhibitedSectorsService],
  exports: [ShariahProhibitedSectorsService],
})
export class ShariahProhibitedSectorsModule {}
