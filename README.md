# Apex Run

An Out Run highway simcade on [pronto](../../plugins/pronto/README.md): five
stages of coast road with forks, traffic, a rival per stage, a stage clock and
a shared high-score table. It runs in the browser on Babylon.js and is released
to Cloudflare at <https://apexrun.bonisoft3.com>.

It started as `apps/supertuxkart`, a SuperTuxKart port: a kinetic arcade kart
racer with laps, items and four racers. It was rebuilt as an Out Run highway
simcade and renamed Apex Run. The kart game's item system, match and kart
state and handlers are deleted. The racers' internal ids (`tux`, `wilber`,
`gnu`, `suzanne`) remain from that origin.

- [DESIGN.md](DESIGN.md): the design system and the reasoning behind it.
- [journal.html](journal.html): turn by turn, what changed and why, with screenshots.
- [ir.html](ir.html) and [brief.md](brief.md): the engineering and product documents.
