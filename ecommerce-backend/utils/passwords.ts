import bcrypt from "bcryptjs";

let placeholderHash: Promise<string> | undefined;

/**
 * Spends the same bcrypt work (cost 12, as for real accounts) when the email
 * is unknown as when the password is wrong, so the response time does not
 * reveal whether an account exists. Always false.
 */
export async function verifyWithoutAccount(password: string): Promise<false> {
  placeholderHash ??= bcrypt.hash("no account has this password", 12);
  await bcrypt.compare(password, await placeholderHash);
  return false;
}
