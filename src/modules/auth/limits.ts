/** The password rules. The sign-up form, the server and the claim script all use these. */
export const PASSWORD_MIN = 8;
/** scrypt on a huge input is a cheap way to tie the server up. */
export const PASSWORD_MAX = 200;
