import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AllowWhenPasswordChangeRequired } from '../decorators/allow-password-change.decorator';
import { Public } from '../decorators/public.decorator';
import { MustChangePasswordGuard } from './must-change-password.guard';

class Sample {
  @AllowWhenPasswordChangeRequired()
  changePassword() {}

  @Public()
  login() {}

  everythingElse() {}
}

function ctx(handler: () => void, user?: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Sample,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('MustChangePasswordGuard', () => {
  const guard = new MustChangePasswordGuard(new Reflector());
  const sample = new Sample();

  it('blocks ordinary routes while a temporary password is still active', () => {
    expect(() =>
      guard.canActivate(ctx(sample.everythingElse, { mustChangePassword: true })),
    ).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'AUTH_PASSWORD_CHANGE_REQUIRED' }) }));
  });

  it('still allows the change-password / me / logout routes', () => {
    expect(guard.canActivate(ctx(sample.changePassword, { mustChangePassword: true }))).toBe(true);
  });

  it('never gets in the way of public routes', () => {
    expect(guard.canActivate(ctx(sample.login))).toBe(true);
  });

  it('lets users with a normal password through', () => {
    expect(guard.canActivate(ctx(sample.everythingElse, { mustChangePassword: false }))).toBe(true);
  });
});
