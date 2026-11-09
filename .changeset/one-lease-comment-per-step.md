---
"github-agent-workflow": patch
---

`claim` and `renew` now edit this account's own lease comment for the step in place instead of posting a new one each time, so an item taken through three claims of a step has one lease comment, not three. Each step keeps its own comment, a comment from another account is never edited, and if the edit fails the helper posts a new one. Because a comment's position in the thread no longer says which lease is newest, `lease_live` and `leaseState` now take the lease written last (`updated_at`, else `created_at`, else thread order); the expiry is still the `expires=` in the marker. New helper `ownLeaseComment` and CLI command `own-lease` in `helpers.mjs`, shared fixtures for the ordering, and shell tests for one comment per step, other accounts, the failed-edit fallback and the ordering (#69).
