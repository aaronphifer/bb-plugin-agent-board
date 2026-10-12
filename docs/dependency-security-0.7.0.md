# Development dependency assessment for 0.7.0

Assessed 12 October 2026. GitHub's eight default-branch alerts were mapped to the
actual lockfile and code paths. No affected Hono/Undici/source-map-js module was
present in the plugin's generated backend source map. These packages are
development dependencies, not declared production dependencies. That distinction
does not exempt build/test tooling from malicious inputs or supply-chain risk.

## Dependency paths and narrow updates

- Direct development Hono **4.13.5 → 4.13.7**. The SDK 0.4.34 testing host uses
  that root optional peer; its compatible `^4.11.9` peer requirement is satisfied.
  The root minimum becomes `^4.13.7` without upgrading the SDK.
- `jsdom@30.0.1 → undici` **8.10.1 → 8.10.2**, pinned by a transitive override.
  jsdom's existing `^8.9.0` range accepts this patch.
- `jsdom → css-tree → source-map-js` and
  `vitest → vite → postcss → source-map-js` **1.2.1 → 1.2.2**, pinned by a
  transitive override. Existing transitive ranges accept this patch.

Only those three resolved package versions changed. Production dependencies,
BB runtime/build version 0.46.0, SDK pin 0.4.34, Node major 24 and declared BB/SDK
compatibility floors were retained. No major upgrade or forced audit fix was used.
Locked root engine metadata was reconciled with the existing package declarations:
BB >=0.40 and SDK >=0.4.21. Unrelated Linux libc metadata was retained.

## Original eight GitHub alerts

Every row retains its original alert; no alerts were merged or dismissed. Fixed
means the PR lockfile selects a patched version, not that an exploit was reproduced
or that GitHub's default-branch alert is closed before merge.

| Alert / advisory | Severity | Affected range / first fixed | Mechanism and current reachability | Action / status |
| --- | --- | --- | --- | --- |
| #12 [GHSA-hxh3-vqpv-xpqv](https://github.com/advisories/GHSA-hxh3-vqpv-xpqv), CVE-2026-93981 | Medium | Hono <4.13.7 / 4.13.7 | Unescaped strings in Hono JSX server boundaries/root can cause XSS. Agent Board uses React; its fake SDK HTTP routes return JSON and do not use Hono JSX/SSR. No current shipped/harness exploit path established. | Defensive patch to 4.13.7; fixed in PR lock. |
| #11 [GHSA-pmjh-fq2x-6v4x](https://github.com/advisories/GHSA-pmjh-fq2x-6v4x), CVE-2026-18149 | Medium | Undici >=8.0.0 <8.10.2 / 8.10.2 | A malicious retried response can leave a body pending. Current harness does not configure RetryHandler/retry interception. | Defensive patch to 8.10.2; fixed in PR lock. |
| #10 [GHSA-2gqq-gqf2-x968](https://github.com/advisories/GHSA-2gqq-gqf2-x968), CVE-2026-84947 | Low | Undici >=8.0.0 <8.10.2 / 8.10.2 | Oversized chunked responses can be truncated by the dump interceptor. No dump interceptor is configured. | Same patch; fixed in PR lock. |
| #9 [GHSA-2jfj-6hjv-fm6j](https://github.com/advisories/GHSA-2jfj-6hjv-fm6j), CVE-2026-84933 | Medium | Undici >=8.0.0 <8.10.2 / 8.10.2 | Shared cache can replay Set-Cookie across users. No shared cache interceptor is configured. | Same patch; fixed in PR lock. |
| #6 [GHSA-r53p-7pc4-xj5r](https://github.com/advisories/GHSA-r53p-7pc4-xj5r), CVE-2026-18540 | Low | Undici >=8.0.0 <8.10.2 / 8.10.2 | Retried bytes forwarded with old framing can split downstream responses. No retry interceptor or downstream HTTP proxy is configured. | Same patch; fixed in PR lock. |
| #5 [GHSA-w293-vg96-wgc3](https://github.com/advisories/GHSA-w293-vg96-wgc3), CVE-2026-84961 | High | Undici >=8.0.0 <8.10.2 / 8.10.2 | BalancedPool drops function-valued custom TLS checks. The current jsdom dispatcher uses the default Agent, not BalancedPool/custom TLS callbacks. | Same patch; fixed in PR lock. |
| #4 [GHSA-8436-99hf-9mmv](https://github.com/advisories/GHSA-8436-99hf-9mmv), CVE-2026-85008 | Low | Undici >=8.0.0 <8.10.2 / 8.10.2 | A cache interceptor can suppress/replay state-changing HTTP requests. No cache interceptor is configured. | Same patch; fixed in PR lock. |
| #2 [GHSA-vp8m-p9jh-q5pm](https://github.com/advisories/GHSA-vp8m-p9jh-q5pm), CVE-2026-85152 | High | Undici >=8.10.0 <8.10.2 / 8.10.2 | Shared originless cache/deduplication keys permit cross-origin poisoning. No such interceptor is configured; default Agent carries request origin. | Same patch; fixed in PR lock. |

Static triage classified these eight supplied application claims as not actionable
in the current inspected plugin/harness paths, rather than confirming them from
package presence alone. All received cheap compatible preventive patches anyway.
Future use of these features or untrusted network input would require reassessment.

## Additional npm audit evidence

`npm audit` also identified
[GHSA-68fv-2mgg-jv7q / CVE-2026-93749](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
in source-map-js >=1.0.0 <1.2.2 (high). An indexed source map with extreme section
offsets can synchronously block the event loop. Its build/test dependency path is
real; a complete attacker-controlled-map path in this project was not established.
This was a potential build-time exposure requiring review, not a confirmed shipped
plugin DoS. The 1.2.2 override removes the vulnerable version without relying on
risk acceptance.

The same Undici patch also covers npm's additional WebSocket decompression,
subprotocol, unclean-close and HTTP decompression advisories
([GHSA-3wwx-pv8p-q78v](https://github.com/advisories/GHSA-3wwx-pv8p-q78v),
[GHSA-rfgv-xxqx-mfg5](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5),
[GHSA-rx4f-c7p8-82vq](https://github.com/advisories/GHSA-rx4f-c7p8-82vq),
[GHSA-3xpg-4rpp-hhhm](https://github.com/advisories/GHSA-3xpg-4rpp-hhhm)).
These concern malicious network responses in build/test libraries; no production
Undici dependency or claimed runtime exploit was introduced. After locked install,
`npm audit --json` returned exit 0 with zero reported vulnerabilities.

No exploit PoC, exhaustive security scan or independent Node/BB host dependency
audit is claimed. Hosted CI uses disposable GitHub runners, read-only permissions,
no repository secrets, no persisted checkout credentials, no `pull_request_target`
execution and no uploaded runtime artifacts. GitHub alerts on unchanged main can
remain open until merge/reindexing; this task does not change their status.
