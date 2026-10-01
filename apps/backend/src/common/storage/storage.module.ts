import { Global, Module } from "@nestjs/common";
import { FileStorageService } from "./file-storage.service";

// Global so every upload service (and main.ts) gets the same instance
// without each feature module importing this.
@Global()
@Module({ providers: [FileStorageService], exports: [FileStorageService] })
export class StorageModule {}
