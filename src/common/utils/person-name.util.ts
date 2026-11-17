import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MinLength } from 'class-validator';

/**
 * Names follow the Ethiopian convention: a given name, then the father's name
 * and the grandfather's name. They are stored as firstName / middleName (father)
 * / lastName (grandfather); `fullName` is the three joined for display.
 *
 * A name part holds letters (any script, including Ethiopic), spaces,
 * apostrophes and hyphens only: no titles ("Sgt."), periods or digits. The rank
 * has its own field.
 */
export const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}'’ -]*$/u;
export const NAME_MESSAGE =
  'Enter the name only, without a title (the rank has its own field).';

/** Validation shared by every DTO that takes a name part. */
export const IsPersonName = () =>
  applyDecorators(
    IsString(),
    MinLength(2),
    Matches(NAME_PATTERN, { message: NAME_MESSAGE }),
  );

export function normalizeNamePart(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** "Abebe Bikila Demissie": the three parts, single-spaced, blanks skipped. */
export function composeFullName(
  firstName?: string | null,
  middleName?: string | null,
  lastName?: string | null,
): string {
  return [firstName, middleName, lastName]
    .map((p) => (p ? normalizeNamePart(p) : ''))
    .filter(Boolean)
    .join(' ');
}
