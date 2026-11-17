import { Global, Module } from '@nestjs/common';
import { PermissionResolverService } from './services/permission-resolver.service';

@Global()
@Module({
  providers: [PermissionResolverService],
  exports: [PermissionResolverService],
})
export class CommonModule {}
