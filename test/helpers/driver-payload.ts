let seq = 0;

/**
 * Body for POST /personnel/drivers that registers a driver whose profile is
 * already COMPLETE (every required self-service field filled). Registering only
 * the basic fields leaves the profile INCOMPLETE, and an incomplete driver
 * cannot apply, so tests that go on to create applications use this.
 */
export function completeDriver(overrides: Record<string, unknown>) {
  const n = `${Date.now()}${++seq}`;
  return {
    email: `e2e.${n}@mod.gov.et`,
    contactPhone: '+251911000000',
    gender: 'MALE',
    nationalIdNumber: `FAN-E2E-${n}`,
    bloodGroup: 'O+',
    photoUrl: 'e2e-photo.jpg',
    emergencyContactName: 'E2E Contact',
    emergencyContactPhone: '+251911000001',
    ...overrides,
  };
}
