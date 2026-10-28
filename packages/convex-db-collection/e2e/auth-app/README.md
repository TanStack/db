# Authenticated official app fixture

Adapted from [get-convex/convex-auth-with-role-based-permissions](https://github.com/get-convex/convex-auth-with-role-based-permissions/tree/45f08008e1257758560948db4280cc4e7d64e84a), pinned at `45f08008e1257758560948db4280cc4e7d64e84a`.

Test setup loads the schema, message functions, permission checks, role update, and HTTP authentication routes from that pinned public checkout into an ignored runtime directory, no upstream source is vendored here. Its GitHub/Resend providers are replaced with Convex Auth's official Anonymous provider so a real sign-in can issue a JWT without external credentials. No admin authentication shortcut supplies the tested client identity. Setup generates fresh signing keys for an isolated local backend.

The example's public `updateRole` allows signed-in users to choose their own role, as its source comment explains. This fixture checks that message access follows those roles, it does not claim that role administration is secure. OAuth redirects, email delivery, browser auth-provider components, refresh-token rotation, and production infrastructure are outside this witness.
