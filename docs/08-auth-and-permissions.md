# 08 — Auth & Permissions

**Status:** Phase 4 · written 2026-08-12
**Trigger:** users log in.

This document is deliberately short. There is one user, no roles, and no sharing. Most of what this
document would normally contain does not exist, and **saying so explicitly is the point** — an agent
reading a missing document invents a permission model; an agent reading this one does not.

---

## 1. Login

**Google OIDC, via Better Auth. There are no passwords in this system.**

| Question | Answer |
|---|---|
| Method | Google as the sole OIDC provider |
| Why | The author already uses Google identity, it is the account the app's email address belongs to, and it removes password storage, password reset and email verification from the codebase entirely |
| Other providers | None. Adding GitHub or Apple would be scaffolding for users who do not exist |
| Password reset | **Does not exist.** There is no password |
| Email verification | **Does not exist.** Google has already verified it |

### 1.1 Requested scopes — exactly three, and never more

```
openid  email  profile
```

That is: *you are signed in*, *your email address*, *your name and picture*. Nothing else.

**Never request `gmail.*`, `drive.*`, `calendar.*` or any other Google API scope.** Nothing in this
product reads your mail, your files or your calendar, and an over-scoped OAuth client turns a stolen
session into a mailbox compromise. If a future feature appears to need a broader scope, that is a
decision-log entry and a re-consent, not a config tweak.

This is a **release blocker**, not a hardening task — it is checked before the first deploy.

**Rejected: Cloudflare Access.** It was the stronger pure-security answer — no unauthenticated
request reaches application code at all — and it was withdrawn because it is an internal-tools gate
priced per user that cannot become product authentication, and because Better Auth supplies the
`users` table PRD §1 requires anyway (decision log, 2026-08-12).

---

## 2. Sign-up is invite-only — permanently, not just for now

The application is **publicly reachable. Sign-up is not.** Open registration is not a later default
that invite-only is holding back; **invite-only is the model**, and opening it would be a separate
decision gated on §2.2.

### 2.1 How it works

| Stage | Mechanism | Milestone |
|---|---|---|
| **Today** | `ALLOWED_SIGNUP_EMAILS` — a comma-separated environment variable holding exactly one address | M1 |
| **When a second user exists** | An `invites` table: code, issued-to email, issued-at, redeemed-at, expiry. Same enforcement point, same `403` | When needed |

An identity not on the list completes the Google flow and is then **rejected with `403 forbidden`**
— the only 403 in the API — and **no `users` row is created**. A rejected sign-in leaves no trace
beyond a log line.

The allowlist is the degenerate case of the invite list, which is why moving between them is a
schema change at one enforcement point rather than a redesign.

### 2.2 What open sign-up would require first

These are **gates, not intentions.** Open registration without all three is an uncapped liability
attached to a personal credit card:

1. **A hard per-user spend cap on model calls.** Every user spends the operator's Anthropic budget.
   Without a cap, one account importing a 500-page PDF is an unbounded bill.
2. **Per-user rate limiting** on the import and generate endpoints
   (`13-infrastructure-security.md`).
3. **A privacy policy, terms, and an account-deletion path that actually deletes.** The moment a
   stranger stores their address and their employer's confidential material here, that is a legal
   obligation rather than a footer link.

**And a product gate beyond those:** 履歴書 and 職務経歴書 are currently assumed, not optional. A
user with a purely Western career would be shown two renders they cannot use.

**Why invite-only rather than open, stated plainly:** the operator does not want to wake up to
hundreds of users. Growth here is a cost and a legal exposure before it is a validation.

---

## 3. Sessions

Better Auth defaults, stated so they are not re-litigated:

| Property | Value |
|---|---|
| Mechanism | **Database sessions**, not stateless JWTs — the `sessions` table |
| Cookie | `httpOnly`, `secure`, `sameSite=lax`, `path=/` |
| Expiry | **30 days** |
| Sliding refresh | Yes — refreshed when a session is used and older than 1 day |
| Revocation | Deleting the `sessions` row logs that device out **immediately** |
| CSRF | Handled by Better Auth's state and cookie checks |

**Why database sessions rather than JWTs.** A JWT cannot be revoked before it expires. For an
application holding this material, "sign out everywhere, now" needs to actually mean now, and the
database round-trip that buys it is irrelevant at one user.

---

## 4. Route protection

**Deny-by-default.** Hono middleware requires a valid session on **every** route. The exemption list
is explicit and short:

```
/api/auth/*        — the OIDC start, callback and sign-out
/                  — the SPA shell and static assets
```

Everything else is protected **because it exists**, not because someone remembered to protect it.
A route added without thinking about auth fails closed.

**This is asserted by test** (`11-testing-plan.md`): a test enumerates the Hono router's registered
routes, calls each without a session, and fails if any responds with anything other than `401` —
so a new unprotected endpoint breaks the build rather than shipping.

**Where an unauthenticated user lands.** Any API call without a session returns `401`. The SPA
catches that globally and shows a sign-in screen; it does not deep-link back afterwards, because
there are three screens and it is not worth the state handling.

---

## 5. Permissions

There are no roles. The matrix has one column, and it exists to be explicit rather than useful:

| Action | The Author |
|---|---|
| Everything | ✅ |

**Authorisation is entirely ownership-based:** every query filters by the session's `userId`, and a
record belonging to another user returns **404** rather than 403 (`07-api-design.md` §1). That
filtering is the only access control in the system, which is why it is asserted by test rather than
left to review.

---

## 6. Multi-user readiness

The author has stated that other users are a **real future possibility**, not a hypothetical. This
section records exactly what is already true and exactly what would have to change, so that the
future work is a known quantity rather than a rewrite.

**Already true — nothing to do:**

| Property | Status |
|---|---|
| Every record-bearing table carries `user_id` | Done, in the schema from the first migration |
| Every query filters by `user_id` | Done, and **asserted by test** |
| A record belonging to another user returns `404`, not `403` | Done — no existence leak |
| Identity is a real `users` table from a real auth library | Done — Better Auth, not a hard-coded constant |
| Deny-by-default routing | Done, asserted by test |
| Sign-up model | **Invite-only**, permanently (§2). Growing it is adding invites, never removing the gate |

**What a second real user would require, none of it structural:**

1. **Onboarding** — Flow 1 assumes the author. A second user needs an empty-record path that does
   not assume a Japanese career (see `09-user-flows.md` Flow 7).
2. **Cost attribution and a hard per-user spend cap.** Model spend is currently a rounding error
   because there is one user. With N users it is a per-user cost someone has to pay for, and an
   uncapped one until §2.2's first gate exists. This is the decision that turns a side project into
   a product, and it is a business decision before it is a technical one.
3. **Rate limiting per user**, which does not exist today (`13-infrastructure-security.md`).
4. **A data-deletion path that actually deletes — the sharpest gap of the six.**
   `04-database-schema.md` §6 says render versions, source document versions and rejected facts are
   **never deleted**. That is the right rule for a personal system of record, where losing something
   is worse than keeping it, and it is **the wrong rule the moment the data belongs to someone
   else**: a request to delete an account must remove the account's source documents, its render
   versions and its facts, not just its login. Concretely this needs a `DELETE /api/account` that
   cascades through every table in the entity map, and a test asserting nothing survives it.
   **Build this before issuing the second invite, not after.**
5. **A privacy policy and terms**, because the app would then hold *other people's* PII and
   *other people's* NDA-bound material. This is a legal obligation, not a page in the footer.
6. **Support for careers that are not this one** — non-Japanese users need the 履歴書 renders to be
   optional rather than assumed.

**What stays out until a second user actually exists:** roles, sharing, teams, an admin surface,
per-record ACLs. The brief names perfectionism as the second-order risk that kills this project;
building product scaffolding for users who do not exist is the most likely form it would take.

---

## 7. Not built, and not to be added without a decision

| Not built | Why |
|---|---|
| Roles or permission levels | One user |
| Sharing, invitations, or per-record ACLs | PRD §9.6 — multi-user anything is out of v1 |
| An admin surface | There is nobody to administer |
| Password login, reset, or email verification | There are no passwords |
| Multiple OIDC providers | Scaffolding for users who do not exist |
| API tokens or machine access | Nothing calls this API but its own SPA |

If a future change needs any of these, it starts with a decision-log entry, not a pull request.
