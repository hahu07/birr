import { Module } from "@nestjs/common";
import { ImpactService } from "./impact.service";
import { ImpactController } from "./impact.controller";
import { FieldPhotosService } from "./field-photos.service";
import { FieldPhotosController } from "./field-photos.controller";
import { FieldPhotoStorageService } from "./field-photo-storage.service";

@Module({
  controllers: [ImpactController, FieldPhotosController],
  providers: [ImpactService, FieldPhotosService, FieldPhotoStorageService],
})
export class ImpactModule {}
