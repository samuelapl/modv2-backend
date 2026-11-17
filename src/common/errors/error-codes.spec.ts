import { ERROR_CODES } from './error-codes';
import { AppBadRequestException } from './app-error';

describe('error catalogue', () => {
  it('has unique SCREAMING_SNAKE_CASE codes', () => {
    const codes = [...ERROR_CODES] as string[];
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
  });

  it('AppException keeps status, English message, code and params', () => {
    const e = new AppBadRequestException(
      'X' as never,
      { permit: 'P-1' },
      'Permit P-1 expired.',
    );
    expect(e.getStatus()).toBe(400);
    expect(e.message).toBe('Permit P-1 expired.');
    expect(e.getResponse()).toMatchObject({ code: 'X', params: { permit: 'P-1' } });
  });
});
