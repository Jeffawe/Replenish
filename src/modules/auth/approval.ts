/** With REQUIRE_APPROVAL on, a new account can sign in but do nothing until it is approved (`npm run approve`). */
export const approvalRequired = () => ["1", "true"].includes(process.env.REQUIRE_APPROVAL?.trim().toLowerCase() ?? "");

export const isApproved = (user: { approvedAt: Date | null }) => !approvalRequired() || user.approvedAt !== null;
