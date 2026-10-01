import { Module } from "@nestjs/common";
import { ImpactService } from "./impact.service";
import { ImpactController } from "./impact.controller";
import { ImpactPhotosService } from "./impact-photos.service";
import { ImpactPhotosController } from "./impact-photos.controller";
import { ImpactPhotoStorageService } from "./impact-photo-storage.service";

@Module({
  controllers: [ImpactController, ImpactPhotosController],
  providers: [ImpactService, ImpactPhotosService, ImpactPhotoStorageService],
  exports: [ImpactPhotosService],
})
export class ImpactModule {}
