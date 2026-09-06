# Facts stay atomic, and bullets are welded at render time

The first comparison against real career material found the generated résumé carried 58 experience
bullets averaging 126 characters, against the hand-produced document's 30 averaging 192, with 33%
carrying a number against 57%. The cause is two rules pulling the same way: `EXTRACTION_SYSTEM_PROMPT`
splits every claim into its own fact, and `RESUME_REGISTER` caps every bullet at one sentence, so
nothing puts them back together. The fix belongs in the render register rather than in extraction. A
bullet may draw on several facts, and `Block.factIds` is already a list.

## Why not fix it in extraction

A fact carries one quote, and that quote must appear verbatim in its source document. Letting a single
fact weld a diagnosis to its measurement to its consequence would force evidence to become multi-quote,
and would make half a fact impossible to reject. Review granularity is what is being protected here.
Composition at render time is a prompt change and reversible. Composition at extraction time rewrites
the data and cannot be undone without a new source version.

## What a future reader will see

Small facts and thin bullets, and the obvious conclusion that extraction is too aggressive. It is not.
Look at the render register first.
