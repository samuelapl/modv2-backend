import { computeChangedFields, sanitizeAuditValue } from './audit-sanitizer';

describe('audit-sanitizer', () => {
  it('redacts sensitive credential and clinical fields while preserving ordinary fields', () => {
    const out = sanitizeAuditValue({
      serviceNumber: 'MOD-1234',
      passwordHash: '$2b$10$secret',
      clinicalNotes: 'Confidential diagnosis',
      qrDataUrl: 'data:image/png;base64,AAAA',
      nested: { refreshToken: 'abc', outcome: 'FIT' },
    }) as Record<string, any>;

    expect(out.serviceNumber).toBe('MOD-1234');
    expect(out.passwordHash).toBe('[REDACTED]');
    expect(out.clinicalNotes).toBe('[REDACTED]');
    expect(out.qrDataUrl).toBe('[BINARY_OMITTED]');
    expect(out.nested).toEqual({ refreshToken: '[REDACTED]', outcome: 'FIT' });
  });

  it('computes sorted changed field names between oldValue and newValue', () => {
    expect(
      computeChangedFields(
        { status: 'SUBMITTED', unitId: 'u1', stage: 'SCREENING' },
        { status: 'APPROVED', unitId: 'u1', stage: 'APPROVAL' },
      ),
    ).toEqual(['stage', 'status']);
  });
});
