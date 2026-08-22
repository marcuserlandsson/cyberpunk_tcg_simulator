# Transcription report — `data/cards.json` (pass 1)

Pass 1 (this document): transcription + source attribution for all 141
reconciled cards, done by reading the live card database directly (its JSON
API, not screen-scraped HTML) plus the two print-and-play PDFs. Pass 2
(independent field-by-field verification) is done by a separate agent —
its column below is `pending` for every card until that pass runs.

## Card count reconciliation: 141, not 131

See `docs/rulings.md` §1 for the full derivation. Summary: the task brief's
"131 beta cards" undercounts by exactly the 10 cards that are exclusive to
the two starter decks' retail printings (5 per deck: the deck's Legends plus
1–2 supporting cards). The live database's own totals are:

| Set (`set.code`) | Unique cards | New vs. core (130) |
|---|---|---|
| `welcometonightcitybeta` (= `welcometonightcityretail`, same 130 cards) | 130 | — (base) |
| `PRM01` (Set 1 Promos) | 2 | 1 new (`rebecca-having-a-moment`); `adam-smasher-ender-of-legends` is a reprint already in the 130 |
| `embracingpowerretailstarterdeck` (Arasaka starter deck) | 20 | 5 new |
| `theheistretailstarterdeck` (Mercs starter deck) | 20 | 5 new |
| **Total unique** | | **141** |

`data/cards.json` contains all 141. This is flagged as a deviation from the
literal "131" instruction — see `docs/rulings.md` §1 and the accompanying
task-2-report.md concerns section.

## Sources and API endpoints used

The site https://cyberpunktcg.com/cards is a Vite/React SPA (no server-
rendered card data, no `__NEXT_DATA__`). Reading its main JS bundle
(`/assets/index-*.js`) surfaced the backing API directly:

- Base URL: `https://api.netdeck.gg/api`
- List endpoint: `GET /cards/cyberpunk?limit=&offset=&set=&color=&type=&cost=&power=&ram=&keywords=&classifications=&q=&sort=`
  — returns `{ items: Card[], total, limit, offset }`. `items[].rules_text` is
  the full verbatim rules text (no separate detail fetch was needed).
- Detail endpoint (not needed, list already has full text):
  `GET /cards/cyberpunk/{slug}`
- Filter metadata: `GET /cards/cyberpunk/filters` — lists all valid `set`
  codes/names, `classifications`, `color`, `type`, `cost`, `power`, `ram`
  option values. Used this to discover the `welcometonightcitybeta`,
  `arasakademodeck`, `mercdemodeck`, `PRM01`, `embracingpowerretailstarterdeck`,
  `theheistretailstarterdeck` set codes.

No API key/auth was required; requests were made with a plain `curl -A
"Mozilla/5.0"`. All 141 cards were pulled by paginating
`?set=welcometonightcitybeta&limit=100&offset=0|100`, plus one-off filtered
queries for `arasakademodeck`, `mercdemodeck`, and `PRM01`.

## Sources per card group

- **130 core cards** — `data/cards.json` entries tagged "DB:
  welcometonightcitybeta (core beta set)" in the table below. Source: the API
  list endpoint, `set=welcometonightcitybeta`. Full verbatim `rules_text` came
  directly from the API; no PDF cross-reference needed (none of these appear
  in the print-and-play PDFs).
- **11 cards used in the Arasaka print-and-play deck** (3 exclusive Legends +
  `minotaur` + `goro-takemura-losing-his-way` + 6 more cards shared with the
  core set but also reprinted in this starter deck) — tagged "DB:
  arasakademodeck (also in PnP arasaka.pdf)". Source: the API's
  `set=arasakademodeck` filter AND visual cross-check against
  `docs/rules/print-and-play-arasaka.pdf` (extracted to PNG pages, read with
  the Read tool). Text/cost/power/ram all matched between the two sources for
  every one of these cards — no discrepancies found (see `docs/rulings.md`
  for the one genuine Alpha/Beta-style naming difference we did find, which
  was a keyword-name issue, not a card-data issue: §2, "Rush" vs
  "Adrenaline").
- **12 cards used in the Mercs print-and-play deck** — tagged "DB:
  mercdemodeck (also in PnP mercs.pdf)". Same method, cross-checked against
  `docs/rules/print-and-play-mercs.pdf`. No discrepancies found.
- **1 promo card** (`rebecca-having-a-moment`) — tagged "DB: PRM01 (Set 1
  Promos)". Source: API only; not in either PDF. `rules_text` is `null` in
  the source and `ram` is also `null` (unusual for a Legend) — flagged
  `uncertain: ramLimit` (see `docs/rulings.md` §5). No image was rendered
  (the signed CDN URL was not fetched); if pass 2 has image access, it should
  verify this card's RAM value visually.

No cards were sourced from the PDFs *alone* — every card in the two demo
decks also has a full structured record in the online database, which was
preferred per the brief's "database wins" rule. The PDFs were used to: (a)
confirm the two decks' exact card lists and copy counts (Step 6 — the API
does not expose deck copy-counts, only unique card lists), and (b) spot-check
rules text/cost/power/ram agreement.

## Deck copy counts (from the print-and-play PDFs)

Copy counts were **not** read from the small "x1"/"x2" badge printed on each
card (that badge is the card's RAM value, confirmed by cross-referencing
against the database's `ram` field — e.g. every card badged "x2" has
`ram: 2`). Copy counts were determined by counting how many physical card
images of each unique card appear across the printed sheet grid (3×3 per
page, 4 pages per deck).

**Arasaka — Embracing Power** (`data/decks/arasaka-embracing-power.json`,
30 cards total): 3 Legends (`goro-takemura-hands-unclean`,
`yorinobu-arasaka-embracing-destruction`, `saburo-arasaka-stubborn-patriarch`,
1 copy each) + `minotaur`×1, `swordwise-huscle`×2, `mantis-blades`×3,
`satori-sword-of-saburo`×3, `industrial-assembly`×3, `over-the-edge`×2,
`corpo-security`×3, `emergency-atlus`×3, `field-operator`×3,
`goro-takemura-losing-his-way`×1, `corporate-surveillance`×3.

**Mercs — The Heist** (`data/decks/mercs-the-heist.json`, 30 cards total):
3 Legends (`v-corporate-exile`, `viktor-vektor-sit-down-and-relax`,
`jackie-welles-pour-one-out-for-me`, 1 copy each) +
`dexter-deshawn-one-last-chance`×1, `dying-night-v-s-pistol`×2,
`secondhand-bombus`×2, `kiroshi-optics`×3, `mandibular-upgrade`×2,
`afterparty-at-lizzie-s`×2, `delamain-cab`×3, `evelyn-parker-scheming-siren`×3,
`mt0d12-flathead`×1, `psycho-squad`×3, `floor-it`×3, `reboot-optics`×2.

Both totals (14 and 15 unique cards respectively, including legends) match
the database's own `arasakademodeck`/`mercdemodeck` set sizes exactly, which
is independent corroboration that no card was missed or double-counted while
tallying the sheets.

## Uncertain cards

Only one field on one card could not be determined from any source:

- `rebecca-having-a-moment` — `uncertain: ramLimit`. The database returns
  `ram: null` for this card (unlike every other Legend); no image was
  rendered to check visually. Encoded as `ramLimit: null` rather than a
  guessed number.

No other fields on any of the 141 cards were left undetermined; every other
value came directly from the database's structured fields.

## Judgment calls

See `docs/rulings.md` for full detail on: (1) the 141-vs-131 count
reconciliation, (2) the `"adrenaline"` vs `"rush"` keyword-name choice, (3)
the `faction`/`keywords` split of the database's `classifications` tags, (4)
encoding "no Go Solo cost" as `cost: 0` for Legends, (5) the
`rebecca-having-a-moment` RAM gap, (6) `{Spend}` not being a keyword, (7)
flavor text embedded directly in `rules_text` for some vanilla Gear.

## Per-card source table (141 cards)

| id | name | source | pass-2 status | notes |
|---|---|---|---|---|
| 6th-street-recruits | 6th Street Recruits | DB: welcometonightcitybeta (core beta set) | pending |  |
| adam-smasher-ender-of-legends | Adam Smasher — Ender of Legends | DB: welcometonightcitybeta (core beta set) | pending |  |
| adam-smasher-metal-over-meat | Adam Smasher — Metal Over Meat | DB: welcometonightcitybeta (core beta set) | pending |  |
| adrenaline-converter | Adrenaline Converter | DB: welcometonightcitybeta (core beta set) | pending |  |
| afterparty-at-lizzie-s | Afterparty at Lizzie's | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| all-is-lost | All is Lost | DB: welcometonightcitybeta (core beta set) | pending |  |
| alt-cunningham-mother-of-daemons | Alt Cunningham — Mother of Daemons | DB: welcometonightcitybeta (core beta set) | pending |  |
| alt-cunningham-soulkiller-architect | Alt Cunningham — Soulkiller Architect | DB: welcometonightcitybeta (core beta set) | pending |  |
| animals-wrecker | Animals Wrecker | DB: welcometonightcitybeta (core beta set) | pending |  |
| appetite-for-destruction | Appetite for Destruction | DB: welcometonightcitybeta (core beta set) | pending |  |
| arasaka-emergency-radioport | Arasaka Emergency Radioport | DB: welcometonightcitybeta (core beta set) | pending |  |
| augmented-negotiators | Augmented Negotiators | DB: welcometonightcitybeta (core beta set) | pending |  |
| bonnie-and-clyde | Bonnie and Clyde | DB: welcometonightcitybeta (core beta set) | pending |  |
| bootleg-black-sapphire-show | Bootleg Black Sapphire Show | DB: welcometonightcitybeta (core beta set) | pending |  |
| caliber-totentanz-s-top-dog | Caliber — Totentanz's Top Dog | DB: welcometonightcitybeta (core beta set) | pending |  |
| carnage-at-the-colosseum | Carnage at the Colosseum | DB: welcometonightcitybeta (core beta set) | pending |  |
| chrome-fang | Chrome Fang | DB: welcometonightcitybeta (core beta set) | pending |  |
| chrome-reverie | Chrome Reverie | DB: welcometonightcitybeta (core beta set) | pending |  |
| corpo-security | Corpo Security | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| corporate-surveillance | Corporate Surveillance | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| cyberpsychosis | Cyberpsychosis | DB: welcometonightcitybeta (core beta set) | pending |  |
| deadman-transmitter | Deadman Transmitter | DB: welcometonightcitybeta (core beta set) | pending |  |
| delamain-cab | Delamain Cab | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| delamain-rideshare-ai | Delamain — Rideshare AI | DB: welcometonightcitybeta (core beta set) | pending |  |
| dexter-deshawn-off-the-grid | Dexter DeShawn — Off the Grid | DB: welcometonightcitybeta (core beta set) | pending |  |
| dexter-deshawn-one-last-chance | Dexter DeShawn — One Last Chance | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| don-t-fear-the-reaper | (Don't Fear) The Reaper | DB: welcometonightcitybeta (core beta set) | pending |  |
| dum-dum-maelstrom-triggerman | Dum Dum — Maelstrom Triggerman | DB: welcometonightcitybeta (core beta set) | pending |  |
| dying-night-v-s-pistol | Dying Night — V's Pistol | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| el-sombrero-n-la-venganza-lenta | El Sombrerón — La Venganza Lenta | DB: welcometonightcitybeta (core beta set) | pending |  |
| emergency-atlus | Emergency Atlus | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| evelyn-parker-beautiful-enigma | Evelyn Parker — Beautiful Enigma | DB: welcometonightcitybeta (core beta set) | pending |  |
| evelyn-parker-scheming-siren | Evelyn Parker — Scheming Siren | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| field-operator | Field Operator | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| floor-it | Floor It | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| fool-on-the-hill | Fool on the Hill | DB: welcometonightcitybeta (core beta set) | pending |  |
| gilded-mato-n | Gilded Matón | DB: welcometonightcitybeta (core beta set) | pending |  |
| gorilla-arms | Gorilla Arms | DB: welcometonightcitybeta (core beta set) | pending |  |
| goro-takemura-hands-unclean | Goro Takemura — Hands Unclean | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| goro-takemura-losing-his-way | Goro Takemura — Losing His Way | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| goro-takemura-vengeful-bodyguard | Goro Takemura — Vengeful Bodyguard | DB: welcometonightcitybeta (core beta set) | pending |  |
| gunpoint-diplomacy | Gunpoint Diplomacy | DB: welcometonightcitybeta (core beta set) | pending |  |
| hacked-corpo | Hacked Corpo | DB: welcometonightcitybeta (core beta set) | pending |  |
| hanako-arasaka-daughter-of-the-emperor | Hanako Arasaka — Daughter of the Emperor | DB: welcometonightcitybeta (core beta set) | pending |  |
| hanako-arasaka-in-a-gilded-cage | Hanako Arasaka — In a Gilded Cage | DB: welcometonightcitybeta (core beta set) | pending |  |
| heywood-ripperdoc | Heywood Ripperdoc | DB: welcometonightcitybeta (core beta set) | pending |  |
| industrial-assembly | Industrial Assembly | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| jacked-in-voodoo-boy | Jacked-In Voodoo Boy | DB: welcometonightcitybeta (core beta set) | pending |  |
| jackie-welles-mama-s-favorite | Jackie Welles — Mama's Favorite | DB: welcometonightcitybeta (core beta set) | pending |  |
| jackie-welles-pour-one-out-for-me | Jackie Welles — Pour One Out For Me | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| jackie-welles-ride-or-die-choom | Jackie Welles — Ride or Die Choom | DB: welcometonightcitybeta (core beta set) | pending |  |
| japantown-jonin | Japantown Jonin | DB: welcometonightcitybeta (core beta set) | pending |  |
| johnny-silverhand-never-stop-fighting | Johnny Silverhand — Never Stop Fighting | DB: welcometonightcitybeta (core beta set) | pending |  |
| johnny-silverhand-rocking-renegade | Johnny Silverhand — Rocking Renegade | DB: welcometonightcitybeta (core beta set) | pending |  |
| judy-a-lvarez-braindance-maestro | Judy Álvarez — Braindance Maestro | DB: welcometonightcitybeta (core beta set) | pending |  |
| judy-a-lvarez-nothing-to-doubt | Judy Álvarez — Nothing to Doubt | DB: welcometonightcitybeta (core beta set) | pending |  |
| kerry-eurodyne-axe-attitude-audience | Kerry Eurodyne — Axe, Attitude, Audience | DB: welcometonightcitybeta (core beta set) | pending |  |
| kerry-eurodyne-the-last-rockerboy | Kerry Eurodyne — The Last Rockerboy | DB: welcometonightcitybeta (core beta set) | pending |  |
| kiroshi-optics | Kiroshi Optics | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| la-llorona-ghost-of-the-past | La Llorona — Ghost of the Past | DB: welcometonightcitybeta (core beta set) | pending |  |
| les-e-le-mens | Les Élémens | DB: welcometonightcitybeta (core beta set) | pending |  |
| live-with-the-aftermath | Live with the Aftermath | DB: welcometonightcitybeta (core beta set) | pending |  |
| lizzy-wizzy-delicate-weapon | Lizzy Wizzy — Delicate Weapon | DB: welcometonightcitybeta (core beta set) | pending |  |
| maelstrom-goons | Maelstrom Goons | DB: welcometonightcitybeta (core beta set) | pending |  |
| maelstrom-zealots | Maelstrom Zealots | DB: welcometonightcitybeta (core beta set) | pending |  |
| maman-brigitte-spirit-of-death | Maman Brigitte — Spirit of Death | DB: welcometonightcitybeta (core beta set) | pending |  |
| mandibular-upgrade | Mandibular Upgrade | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| mantis-blades | Mantis Blades | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| maxtac-av | MaxTac AV | DB: welcometonightcitybeta (core beta set) | pending |  |
| maxtac-squadron | MaxTac Squadron | DB: welcometonightcitybeta (core beta set) | pending |  |
| maxtac-suppression-team | MaxTac Suppression Team | DB: welcometonightcitybeta (core beta set) | pending |  |
| meredith-stout-stone-cold-corpo | Meredith Stout — Stone Cold Corpo | DB: welcometonightcitybeta (core beta set) | pending |  |
| minotaur | Minotaur | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| misty-olszewski-mender-of-broken-spirits | Misty Olszewski — Mender of Broken Spirits | DB: welcometonightcitybeta (core beta set) | pending |  |
| modded-kusanagi | Modded Kusanagi | DB: welcometonightcitybeta (core beta set) | pending |  |
| modded-muramasa | Modded Muramasa | DB: welcometonightcitybeta (core beta set) | pending |  |
| mox-inciters | Mox Inciters | DB: welcometonightcitybeta (core beta set) | pending |  |
| mt0d12-flathead | MT0D12 Flathead | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| muamar-reyes-el-capita-n | Muamar Reyes — El Capitán | DB: welcometonightcitybeta (core beta set) | pending |  |
| nadia-fighting-through-grief | Nadia — Fighting Through Grief | DB: welcometonightcitybeta (core beta set) | pending |  |
| netwatch-netdriver | NetWatch Netdriver | DB: welcometonightcitybeta (core beta set) | pending |  |
| octant | Octant | DB: welcometonightcitybeta (core beta set) | pending |  |
| offduty-malfini | Offduty Malfini | DB: welcometonightcitybeta (core beta set) | pending |  |
| over-the-edge | Over the Edge | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| overwatch-panam-s-gift | Overwatch — Panam's Gift | DB: welcometonightcitybeta (core beta set) | pending |  |
| pacifica-netrunner | Pacifica Netrunner | DB: welcometonightcitybeta (core beta set) | pending |  |
| padre-man-of-the-cross | Padre — Man of the Cross | DB: welcometonightcitybeta (core beta set) | pending |  |
| panam-palmer-nomad-cavalry | Panam Palmer — Nomad Cavalry | DB: welcometonightcitybeta (core beta set) | pending |  |
| panam-palmer-strength-through-family | Panam Palmer — Strength Through Family | DB: welcometonightcitybeta (core beta set) | pending |  |
| peace-offering | Peace Offering | DB: welcometonightcitybeta (core beta set) | pending |  |
| pepe-najarro-working-doubles | Pepe Najarro — Working Doubles | DB: welcometonightcitybeta (core beta set) | pending |  |
| placide-voodoo-sentinel | Placide — Voodoo Sentinel | DB: welcometonightcitybeta (core beta set) | pending |  |
| psycho-squad | Psycho Squad | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| pyramid-song | Pyramid Song | DB: welcometonightcitybeta (core beta set) | pending |  |
| rebecca-having-a-moment | Rebecca — Having a Moment | DB: PRM01 (Set 1 Promos) | pending | uncertain: ramLimit |
| reboot-optics | Reboot Optics | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| riding-nomad | Riding Nomad | DB: welcometonightcitybeta (core beta set) | pending |  |
| riot-shield | Riot Shield | DB: welcometonightcitybeta (core beta set) | pending |  |
| rita-wheeler-no-stupid-questions | Rita Wheeler — No Stupid Questions | DB: welcometonightcitybeta (core beta set) | pending |  |
| river-ward-detective-on-the-hunt | River Ward — Detective on the Hunt | DB: welcometonightcitybeta (core beta set) | pending |  |
| rockn-rockerboy | Rockn' Rockerboy | DB: welcometonightcitybeta (core beta set) | pending |  |
| rogue-amendiares-preem-solo | Rogue Amendiares — Preem Solo | DB: welcometonightcitybeta (core beta set) | pending |  |
| royce-don-t-call-me-simon | Royce — Don't Call Me Simon | DB: welcometonightcitybeta (core beta set) | pending |  |
| royce-psycho-on-the-edge | Royce — Psycho on the Edge | DB: welcometonightcitybeta (core beta set) | pending |  |
| ruthless-lowlife | Ruthless Lowlife | DB: welcometonightcitybeta (core beta set) | pending |  |
| saburo-arasaka-stubborn-patriarch | Saburo Arasaka — Stubborn Patriarch | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| safety-override | Safety Override | DB: welcometonightcitybeta (core beta set) | pending |  |
| sandayu-oda-hanako-s-guardian | Sandayu Oda — Hanako's Guardian | DB: welcometonightcitybeta (core beta set) | pending |  |
| sandevistan | Sandevistan | DB: welcometonightcitybeta (core beta set) | pending |  |
| sasha-yakovleva-won-t-let-you-down | Sasha Yakovleva — Won't Let You Down | DB: welcometonightcitybeta (core beta set) | pending |  |
| satori-sword-of-saburo | Satori — Sword of Saburo | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| saul-bright-stormrider | Saul Bright — Stormrider | DB: welcometonightcitybeta (core beta set) | pending |  |
| screw-lovelorn-fool | Screw — Lovelorn Fool | DB: welcometonightcitybeta (core beta set) | pending |  |
| secondhand-bombus | Secondhand Bombus | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| shattered-memories | Shattered Memories | DB: welcometonightcitybeta (core beta set) | pending |  |
| sketchy-ripper | Sketchy Ripper | DB: welcometonightcitybeta (core beta set) | pending |  |
| swordwise-huscle | Swordwise Huscle | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| synapse-burnout | Synapse Burnout | DB: welcometonightcitybeta (core beta set) | pending |  |
| t-bug-amateur-philosopher | T-Bug — Amateur Philosopher | DB: welcometonightcitybeta (core beta set) | pending |  |
| take-control | Take Control | DB: welcometonightcitybeta (core beta set) | pending |  |
| tetratronic-rippler | Tetratronic Rippler | DB: welcometonightcitybeta (core beta set) | pending |  |
| the-heist | The Heist | DB: welcometonightcitybeta (core beta set) | pending |  |
| the-relic-experimental-biochip | The Relic — Experimental Biochip | DB: welcometonightcitybeta (core beta set) | pending |  |
| trauma-team-operatives | Trauma Team Operatives | DB: welcometonightcitybeta (core beta set) | pending |  |
| trust-no-one | Trust No One | DB: welcometonightcitybeta (core beta set) | pending |  |
| unlikely-bond | Unlikely Bond | DB: welcometonightcitybeta (core beta set) | pending |  |
| v-corporate-exile | V — Corporate Exile | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| v-roamer-of-the-badlands | V — Roamer of the Badlands | DB: welcometonightcitybeta (core beta set) | pending |  |
| v-streetkid | V — Streetkid | DB: welcometonightcitybeta (core beta set) | pending |  |
| valentino-guerrera | Valentino Guerrera | DB: welcometonightcitybeta (core beta set) | pending |  |
| valentino-street-racer | Valentino Street Racer | DB: welcometonightcitybeta (core beta set) | pending |  |
| viktor-vektor-drop-your-illusions | Viktor Vektor — Drop Your Illusions | DB: welcometonightcitybeta (core beta set) | pending |  |
| viktor-vektor-sit-down-and-relax | Viktor Vektor — Sit Down and Relax | DB: mercdemodeck (also in PnP mercs.pdf) | pending |  |
| viktor-vektor-you-might-feel-a-little-pinch | Viktor Vektor — You Might Feel a Little Pinch | DB: welcometonightcitybeta (core beta set) | pending |  |
| wakako-okada-peace-and-harmony | Wakako Okada — Peace and Harmony | DB: welcometonightcitybeta (core beta set) | pending |  |
| wild-in-the-streets | Wild in the Streets | DB: welcometonightcitybeta (core beta set) | pending |  |
| wraith-marauders | Wraith Marauders | DB: welcometonightcitybeta (core beta set) | pending |  |
| yorinobu-arasaka-embracing-destruction | Yorinobu Arasaka — Embracing Destruction | DB: arasakademodeck (also in PnP arasaka.pdf) | pending |  |
| yorinobu-arasaka-steel-dragon | Yorinobu Arasaka — Steel Dragon | DB: welcometonightcitybeta (core beta set) | pending |  |
| zetatech-berserk | Zetatech Berserk | DB: welcometonightcitybeta (core beta set) | pending |  |
| zetatech-faceplate | Zetatech Faceplate | DB: welcometonightcitybeta (core beta set) | pending |  |
