/**
 * Every policy the system understands. The definitions (type, limits, default)
 * live in code; only the chosen value is stored in the database. To add a new
 * policy, add an entry here and read it with PoliciesService.getNumber().
 */
export type PolicyGroup = 'training' | 'examinations' | 'medical' | 'credentials';

export interface NumberPolicyDefinition {
  key: string;
  group: PolicyGroup;
  type: 'number';
  /** Whole numbers only. */
  integer: true;
  min: number;
  max: number;
  default: number;
  /** Shown next to the value, e.g. "%". */
  unit?: string;
}

export type PolicyDefinition = NumberPolicyDefinition;

export const POLICY_DEFINITIONS = [
  {
    key: 'training.minAttendancePercent',
    group: 'training',
    type: 'number',
    integer: true,
    min: 1,
    max: 100,
    default: 100,
    unit: '%',
  },
] as const satisfies readonly PolicyDefinition[];

export type PolicyKey = (typeof POLICY_DEFINITIONS)[number]['key'];

export const findPolicyDefinition = (key: string): PolicyDefinition | undefined =>
  POLICY_DEFINITIONS.find((d) => d.key === key);
