export const MAXIMUM_PASSWORD_LENGTH = 128;
export const PASSWORD_POLICY_MESSAGE = "密码设置不符合要求，请重新设置。";

export function meetsPasswordPolicy(password: string) {
  return (
    password.trim().length > 0 &&
    password.length <= MAXIMUM_PASSWORD_LENGTH
  );
}
