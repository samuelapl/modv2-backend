import { composeFullName } from '../../common/utils/person-name.util';
import { CreateIdentityInput } from './keycloak-provider.interface';

export interface KeycloakUserRepresentation {
  id?: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  attributes?: Record<string, string[]>;
}

export interface IdlmsMappedIdentity {
  keycloakId?: string;
  serviceNumber: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  fullName: string;
  rank: string | null;
  phone: string | null;
  email: string | null;
  unitCode: string | null;
  enabled: boolean;
}

/**
 * Normalizes an IDLMS service number to Keycloak username (lowercase).
 * e.g. "MOD-1309001" -> "mod-1309001"
 */
export function toKeycloakUsername(serviceNumber: string): string {
  return serviceNumber.trim().toLowerCase();
}

/**
 * Normalizes a Keycloak username to IDLMS service number (uppercase).
 * e.g. "mod-1309001" -> "MOD-1309001"
 */
export function toIdlmsServiceNumber(username: string): string {
  return username.trim().toUpperCase();
}

/**
 * Maps an IDLMS creation input to a Keycloak User Representation.
 * - Keycloak firstName = Given Name (firstName)
 * - Keycloak lastName = Father's Name (middleName)
 * - Keycloak custom attribute grandfatherName = Grandfather's Name (lastName)
 */
export function toKeycloakUser(input: CreateIdentityInput): KeycloakUserRepresentation {
  const attributes: Record<string, string[]> = {};

  if (input.lastName) {
    attributes.grandfatherName = [input.lastName.trim()];
  }
  if (input.rank) {
    attributes.rank = [input.rank.trim()];
  }
  if (input.phone) {
    attributes.phone = [input.phone.trim()];
  }
  if (input.unitCode) {
    attributes.unitCode = [input.unitCode.trim()];
  }

  return {
    username: toKeycloakUsername(input.serviceNumber),
    firstName: input.firstName?.trim() || undefined,
    lastName: input.middleName?.trim() || undefined,
    email: input.email?.trim() || undefined,
    enabled: true,
    emailVerified: false,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
  };
}

/**
 * Maps a Keycloak User representation into IDLMS identity fields.
 */
export function toIdlmsIdentity(user: KeycloakUserRepresentation): IdlmsMappedIdentity {
  const firstName = user.firstName?.trim() || null;
  const middleName = user.lastName?.trim() || null;
  const lastName = user.attributes?.grandfatherName?.[0]?.trim() || null;

  const fullName = composeFullName(firstName, middleName, lastName);

  return {
    keycloakId: user.id,
    serviceNumber: toIdlmsServiceNumber(user.username),
    firstName,
    middleName,
    lastName,
    fullName,
    rank: user.attributes?.rank?.[0]?.trim() || null,
    phone: user.attributes?.phone?.[0]?.trim() || null,
    email: user.email?.trim() || null,
    unitCode: user.attributes?.unitCode?.[0]?.trim() || null,
    enabled: user.enabled !== false,
  };
}

/**
 * Maps partial IDLMS identity update fields into Keycloak User Representation fields.
 */
export function toKeycloakPartialUser(input: Partial<CreateIdentityInput>): Partial<KeycloakUserRepresentation> {
  const payload: Partial<KeycloakUserRepresentation> = {};
  if (input.firstName !== undefined) payload.firstName = input.firstName?.trim() || undefined;
  if (input.middleName !== undefined) payload.lastName = input.middleName?.trim() || undefined;
  if (input.email !== undefined) payload.email = input.email?.trim() || undefined;

  const attributes: Record<string, string[]> = {};
  if (input.lastName !== undefined) {
    attributes.grandfatherName = input.lastName ? [input.lastName.trim()] : [];
  }
  if (input.rank !== undefined) {
    attributes.rank = input.rank ? [input.rank.trim()] : [];
  }
  if (input.phone !== undefined) {
    attributes.phone = input.phone ? [input.phone.trim()] : [];
  }
  if (input.unitCode !== undefined) {
    attributes.unitCode = input.unitCode ? [input.unitCode.trim()] : [];
  }
  if (Object.keys(attributes).length > 0) {
    payload.attributes = attributes;
  }
  return payload;
}

