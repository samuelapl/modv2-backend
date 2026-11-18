export interface KeycloakConfig {
  baseUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
  syncGroup: string;
  isKeycloakEnabled: boolean;
}

export function getKeycloakConfig(): KeycloakConfig {
  const isKeycloakEnabled = process.env.IDENTITY_PROVIDER === 'keycloak';
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;

  if (process.env.NODE_ENV === 'production' && isKeycloakEnabled && !clientSecret) {
    throw new Error('KEYCLOAK_CLIENT_SECRET environment variable is mandatory in production when IDENTITY_PROVIDER=keycloak.');
  }

  return {
    baseUrl: (process.env.KEYCLOAK_BASE_URL || 'http://localhost:8080').replace(/\/+$/, ''),
    realm: process.env.KEYCLOAK_REALM || 'mod-defense',
    clientId: process.env.KEYCLOAK_CLIENT_ID || 'idlms-backend',
    clientSecret: clientSecret || 'idlms-backend-secret-2026',
    syncGroup: process.env.KEYCLOAK_SYNC_GROUP || 'idlms-users',
    isKeycloakEnabled,
  };
}
