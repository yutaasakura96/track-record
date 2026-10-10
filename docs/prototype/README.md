# The Applications prototype

`applications-prototype.html` is the clickable prototype of the Applications area (issue #60) that
the owner reviewed on 2026-10-10. It is committed as reviewed and is not edited afterwards.

**It is the reference for how each Applications screen looks, reads and behaves.** The contract is
`docs/02-product-requirements.md` (§3a, S20 to S24) and `docs/10-screen-specifications.md` (Screens
12 to 15), with the decisions in `docs/06-decision-log.md` under 2026-10-11. Where the prototype and
those disagree, they win.

Open the file in a browser. It is one file with no build, and it loads nothing but its fonts. The
bar above the frame switches between desktop and phone width, starts from eight sample applications
or from first use, and jumps to each screen. The theme control is in the sidebar, or in the menu at
phone width.

**Everything in it is invented**: every company, person, posting and résumé line. Its "today" is
fixed at 2026-10-10 so that the day counts stay put. Nothing is saved and nothing is sent.

## Where the docs already differ from it

| The prototype shows | What was decided |
| --- | --- |
| `Upload audio or video`, a `Video` chip, a sample `.mp4`, `up to 2 GB a file` | **Audio only**, no video (review, question 10). The size limit is set by the issue that builds upload |
| The twelve open questions under the frame, each with a recommended answer | Settled on 2026-10-10: eleven as shown, question 10 changed. The outcome is on issue #60 |
| A stand-in for Review changes that stacks its two columns at phone width | Screen 2 is the existing screen, unchanged, and is not a phone screen |
| `Play`, `Download`, `History`, `Open` and `Edit`, which only name what they would do | Their behaviour is in `docs/10` |
| `Prototype only:` controls, and reading a posting by matching the two sample texts | Not part of any screen. The reading is a model function with a confirmation step |
| `Queue this answer`, which reports to a review board | The board is gone. Opened on its own, the page says there is nowhere to send an answer |

The prototypes in `design/prototype/` are the earlier visual references for Fact Review, Diff
Review and Home.
