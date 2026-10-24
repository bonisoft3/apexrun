# Apex Run — Brief

## Vision
An Out Run highway simcade in the browser, painted as a Ghibli gouache afternoon: a red convertible with a girl at the wheel and a boy beside her, driving coast to coast against the clock. The game is the whole page. A run ends on a shared high-score table with three arcade initials. Decisions are in [DESIGN.md](DESIGN.md), the history in [journal.html](journal.html).

## Core Features
1. **Branching route**: 15 stages in Out Run's route tree, five per run. A fork at each stage's end picks one of two roads, and the run ends at one of five destinations.
2. **Against the clock**: 75 seconds to start, and each checkpoint adds 45. A run ends at a goal or at TIME OVER.
3. **Highway racing**: a deterministic 60 Hz drive with drifting, nitro, traffic to slip past for close passes, and one named rival per stage worth 1,000 to beat.
4. **A painted world**: every stage has its own light, sky and hero landmark, from Coconut Beach's sea wall to the colosseum. The camera pulls back at the landmarks and drops to the hood in a close pass. Each stage hazes out into the next with road always ahead.
5. **The riders**: she drives with both hands on the wheel. He holds the door and waves only when a moment earns it: the start, a close pass, a rival beaten, a checkpoint, nitro.
6. **Shared high scores**: the top ten, live for every player, with the ending, time and score. One save per run, and the table refuses scores no run could produce.
7. **Radio and sound**: three stations composed in code, and an engine, wind and tyres synthesized live.
