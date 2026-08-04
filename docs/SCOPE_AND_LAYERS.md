# What SURVIVOR measures, and what it does not - 2026-08-04

## The tie that prompted this
BONK, WIF, POPCAT, PYTH and JTO score identically under validated-five. Their raw inputs
are not similar at all:

    BONK    1323 days, $109k liquidity, 37.83% top10
    WIF      988 days, $3,986k,          44.19%
    PYTH     989 days, $295k,            48.57%
    POPCAT   966 days, $2,941k,          41.73%
    JTO      972 days, $1,290k,          47.36%

A 37x liquidity spread and a 357-day age spread produce identical subscores, because
scoreTokenAge saturates at 168 hours and scoreLiquidityDepth at $100,000.

## That is the curves working, not failing
These are screening thresholds. They were built to separate a two-hour-old token with $3k
of liquidity from a two-week-old one with $60k, and they do that well. Above the threshold
the model is saying "all of these are far past the minimum", which is a correct answer to
the question it asks.

Extending them to a logarithmic curve would change the question from "has this survived
infancy?" to "has this survived two years?" - a different question, and one that should be
asked deliberately rather than by accident.

## The disappearing memecoin
Consider two tokens: mint renounced, no freeze authority, healthy holder structure, older
than a week, more than $100k liquidity. One is still trading. One vanished in two months.

They score the same, and that is correct. What killed the second was not mint authority,
freeze authority, holder control, liquidity depth or age. It was developers stopping,
volume collapsing, attention leaving, no new holders arriving, liquidity draining slowly.

Structural safety is not ecosystem survival. This is the same lesson the 35-point hole has
been repeating: LP lock measured burn rather than safety, and developer activity was never
measured at all.

## Layer boundary
    LAYER 1  STRUCTURAL INTEGRITY - what SURVIVOR measures today
      can someone mint? can someone freeze? is transfer constrained?
      can a keypair dump? is ownership concentrated? is liquidity real?
      has it survived infancy?

    LAYER 2  SURVIVAL DYNAMICS - not measured, and not claimed
      developer continuity, program upgrades, treasury movement, holder growth,
      volume persistence, daily active wallets, LP migration, exchange listings,
      governance participation, community decay

Layer 2 belongs to a separate module, not to a widened Layer 1 score. Forcing the launch
screener to answer questions it was never designed for is how the 35-point hole formed.

## The claim
SURVIVOR is an execution admissibility and launch-stage structural screening model.
Several signals intentionally saturate past established thresholds. Mature assets that
exceed them are structurally sufficient on those dimensions, and further discrimination
belongs to future protocol-specific layers.

The defensible statement is not "this token will survive". It is: based on the structural
evidence collected, this token exhibits these measured properties, and developer
continuity, ecosystem momentum, governance health and community persistence are outside
the scope of this assessment unless separately measured.

## Note on method
The strongest improvements this week did not come from more elaborate curves. They came
from measuring something more precisely - owner control instead of raw concentration,
observed separated from unobserved, keypair-signable separated from program-derived, and
execution cost computed in Gate rather than diluted into a score. Semantic accuracy, not
numeric resolution.
