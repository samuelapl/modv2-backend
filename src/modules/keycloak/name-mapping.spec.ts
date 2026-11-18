import {
  toKeycloakUsername,
  toIdlmsServiceNumber,
  toKeycloakUser,
  toIdlmsIdentity,
} from './name-mapping';

describe('Keycloak Name Mapping & Case Normalization', () => {
  it('normalizes service number case bi-directionally', () => {
    expect(toKeycloakUsername('MOD-1309001')).toBe('mod-1309001');
    expect(toIdlmsServiceNumber('mod-1309001')).toBe('MOD-1309001');
    expect(toIdlmsServiceNumber(toKeycloakUsername('MOD-88219'))).toBe('MOD-88219');
  });

  it('maps IDLMS 3-part names to Keycloak attributes correctly', () => {
    const keycloakUser = toKeycloakUser({
      serviceNumber: 'MOD-1309001',
      firstName: 'Abebe',
      middleName: 'Bikila',
      lastName: 'Demisse',
      rank: 'Captain',
      phone: '+251911223344',
      email: 'abebe@mod.gov.et',
      unitCode: 'LOG-CORPS',
    });

    expect(keycloakUser.username).toBe('mod-1309001');
    expect(keycloakUser.firstName).toBe('Abebe');
    expect(keycloakUser.lastName).toBe('Bikila'); // Father's name
    expect(keycloakUser.email).toBe('abebe@mod.gov.et');
    expect(keycloakUser.attributes?.grandfatherName).toEqual(['Demisse']); // Grandfather's name
    expect(keycloakUser.attributes?.rank).toEqual(['Captain']);
    expect(keycloakUser.attributes?.phone).toEqual(['+251911223344']);
    expect(keycloakUser.attributes?.unitCode).toEqual(['LOG-CORPS']);
  });

  it('maps Keycloak representation back to IDLMS identity', () => {
    const idlmsUser = toIdlmsIdentity({
      id: 'kc-uuid-1234',
      username: 'mod-1309001',
      firstName: 'Abebe',
      lastName: 'Bikila',
      email: 'abebe@mod.gov.et',
      enabled: true,
      attributes: {
        grandfatherName: ['Demisse'],
        rank: ['Captain'],
        phone: ['+251911223344'],
        unitCode: ['LOG-CORPS'],
      },
    });

    expect(idlmsUser.keycloakId).toBe('kc-uuid-1234');
    expect(idlmsUser.serviceNumber).toBe('MOD-1309001');
    expect(idlmsUser.firstName).toBe('Abebe');
    expect(idlmsUser.middleName).toBe('Bikila');
    expect(idlmsUser.lastName).toBe('Demisse');
    expect(idlmsUser.fullName).toBe('Abebe Bikila Demisse');
    expect(idlmsUser.rank).toBe('Captain');
    expect(idlmsUser.phone).toBe('+251911223344');
    expect(idlmsUser.email).toBe('abebe@mod.gov.et');
    expect(idlmsUser.unitCode).toBe('LOG-CORPS');
    expect(idlmsUser.enabled).toBe(true);
  });
});
