# App mockup

A clickable phone mockup (390 × 844) of six screens. It shows the intended look and the status language from the
PRD. It is a design reference, not a spec: where it disagrees with `context/prd.md` or an item's plan, those win.

| Screen | Files | Shows |
|--------|-------|-------|
| Connect | `Connect.dc.html` | connected companion, capabilities (FR-03), technical details, scan |
| Dashboard | `Main.dc.html` | sync, Dashboard / All contacts filter, node statuses, nearest node card (FR-04, FR-11, FR-21) |
| Node details | `Node.dc.html` | telemetry with units and "last hop" (FR-07), voltage chart and trend text (FR-12), recent runs |
| Diagnostic run | `Run.dc.html` | step, attempt n of m, airtime notice, Cancel (FR-05, FR-10) |
| Result | `Result.dc.html` | `NO_RESPONSE` with unconfirmed causes, next steps, cooldown (FR-06, FR-09, FR-10) |
| Settings | `Settings.dc.html` | timeout, attempts, export redaction, data deletion (FR-15) |

- `*.dc.html` and `canvas.json` are the source, in the format of the Claude Design canvas where the mockup is edited.
  They need that canvas's runtime and do not render on their own.
- `preview/*.html` are static copies that open in any browser (start at `preview/Main.html`; links between screens
  work). Regenerate them after changing the source.

Look: IBM Plex Sans and Mono, ground `#F3F4F1`, accent `#0E6B5E`. Every status has an icon and a text label, never
colour alone. Node names other than Room K, telemetry values and times are example data.
