import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KEYCLOAK_PROVIDER_TOKEN } from './keycloak-provider.interface';
import { LocalIdentityProvider } from './providers/local-identity.provider';
import { KeycloakRemoteIdentityProvider } from './providers/keycloak-identity.provider';
import { KeycloakTokenService } from './keycloak-token.service';
import { KeycloakAdminService } from './keycloak-admin.service';
import { KeycloakSyncService } from './keycloak-sync.service';
import { KeycloakController } from './keycloak.controller';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [KeycloakController],
  providers: [
    LocalIdentityProvider,
    KeycloakTokenService,
    KeycloakAdminService,
    KeycloakRemoteIdentityProvider,
    KeycloakSyncService,
    {
      provide: KEYCLOAK_PROVIDER_TOKEN,
      useFactory: (
        localProvider: LocalIdentityProvider,
        keycloakProvider: KeycloakRemoteIdentityProvider,
      ) => {
        const providerType = process.env.IDENTITY_PROVIDER || 'local';
        if (providerType === 'keycloak') {
          return keycloakProvider;
        }
        return localProvider;
      },
      inject: [LocalIdentityProvider, KeycloakRemoteIdentityProvider],
    },
  ],
  exports: [
    KEYCLOAK_PROVIDER_TOKEN,
    LocalIdentityProvider,
    KeycloakRemoteIdentityProvider,
    KeycloakTokenService,
    KeycloakAdminService,
    KeycloakSyncService,
  ],
})
export class KeycloakModule {}
