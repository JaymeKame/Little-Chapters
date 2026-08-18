# Parent SMS — build spec

Not built yet. This is the spec the generator must satisfy when it is.

Source: Sophie Torrado-Gittleman, literacy specialist, August 2026 review.

## The churn thesis

Families quit because they expect results in days when the repetition takes
weeks or months to pay off. The parent — not the child — is the retention
surface. Every message has to do two jobs at once.

## Required in every message

**1. One small, specific, named win.** Not "good progress" or "doing well." A
particular word, on a particular night.

> Sam read "tip" on his own for the first time tonight.

The win must be real. The interpretation layer knows which words moved from
stumbled to correct, and which words the child had never read unaided before —
that is where the win comes from. If there is genuinely no first-time win,
name the strongest thing that did happen rather than inventing one.

**2. Normalise the timeline.** Every message. Not occasionally.

> These take weeks to stick, and that's normal.

The parent should never be able to conclude from a message that progress is
slower than expected, because the message has already told them what expected
looks like.

## Structure

2-4 lines:

1. The specific win
2. Sounds still tricky
3. Timeline normalisation
4. What's coming tomorrow

## Hard constraints

- No scores, percentages, grades, charts, or comparisons to other children
- No exclamation marks
- Never negative, even on a mostly-assisted night

## The mostly-assisted night

The hard case. The child was read to for most of the session. Stay honest —
do not claim reading that did not happen — but the message still has to carry
a real win and the timeline line.

The site's own framing is the guide here: *"The worst possible session here is
one where your child gets read a lovely story."* On those nights the win can be
that they finished the chapter and heard what happened, and the timeline line
does the rest of the work.

## Validator

The message generator needs its own validator with the same zero-failure bar as
the phonics and content validators:

- reject any digit or percent sign
- reject any exclamation mark
- reject any word from the never_say list in config.json
- reject if no specific word is named
- reject if the timeline line is missing
