# How the Peanuts build is made

Notes on what the patcher does to the port's download and why. Everything here is for ACNH 3.0.3 under Peanuts Native 0.1.8.

## What changes

The output is the port's own romfs with these changes:

| What | Why |
| --- | --- |
| The port's 25 `Model/UnitIcon*` models go in only with the memory fix | without it they crash 3.0.3 at the title (see below) |
| `EventFlow/`: the 40 new flows go in, and `EventFlowInfoProduct.byml` is the 3.0.3 file plus the port's new entries | the port's own byml is 2.x-era (see EventFlow below) |
| Each `Message/` sarc gets back the vanilla 3.0.3 labels it lacks: 79 item names in `String_USen` and `String_EUen`, one Leif line (`slo/SP_slo.msbt` label `400`) in `TalkSNpc_USen` and `TalkSNpc_EUen` | the port's copies are 2.x-era and lack those labels (9 tools, 70 other items). There is no vanilla EUen file, so the EUen sarcs get the USen text |
| `System/Resource/ResourceSizeTable.srsizetable` is rebuilt | vanilla 3.0.3's table, plus the port's entries for its new files, with sizes raised where a port file is bigger |

The item tables (`Bcsv/*`), stages, params, layouts and the other models go in exactly as the port ships them, including its 254 stack limit.

## What is left out, and why

Earlier builds left out the UnitIcon models and the other `Message/` sarcs after this bisect on an AYN Thor (each build listed in the launch log's `DM_ROMFS_OVERLAY`, so the mod was really loaded). These tests ran on V0.0.1 builds installed next to two other mods:

| Build | Result |
| --- | --- |
| Item tables, size table and `String_USen` only | boots, plays the new-game intro |
| All of the port except `EventFlow/*` and `Model/UnitIcon*` | boots |
| ... plus the port's `EventFlow/` | hangs on load |
| ... plus the `UnitIcon*` models | crashes (SIGSEGV) |
| ... plus the port's other `Message/` sarcs | crashes while loading `Message/System_*` (they are 2.x-era; all 9 USen sarcs differ from 3.0.3) |

The Message crash was a size cap, not a bad file. Another mod was first in the list, so its size table capped every file (see "Peanuts mod order" below): Combined's table caps `System_USen` at 350,816 bytes, and the port's file is 353,624. With Jubbsticks first and its size table covering every port message file, all of the port's `Message/` sarcs load the island on Peanuts 0.1.8, so they are back in.

The UnitIcon models crashed even then. These are the inventory icons of the port's new fruit and gems: 25 models: 17 new ones, and 8 that replace vanilla icons (seven fruit and the pansy petal). With them in, Peanuts 0.1.8 crashed at the title about 18 s in (`CRASH sig=11 addr=0 pc=sdk+0x582b2c lr=main+0x151ba24`), and without them the island loaded. Raising their size entries to twice the decompressed size plus 64 KB didn't help. The crash address is the same NULL memset after a failed allocation as Combined's oak crash below. A build that ships vanilla 3.0.3's own Pansy UnitIcon bytes and no new icon names loads the island, so the crash points at the 17 new icon models rather than at a replaced vanilla icon. One guess was that the game's fixed 22 MiB `GfxDrawArrayHeap` fills up. A code patch that raises it to 64 MiB applied but still crashed at the title (`pc=sdk+0x582b2c`, with the caller now at `lr=main+0x14c39d0`). That is an allocation from its parent heap, "Scene": the extra 42 MiB came out of Scene, and Scene ran out instead. The fix that works grows the draw-array heap and the root of its heap chain, cScene, by the same amount, so Scene keeps its free room and the extra memory comes out of cOthers, which leaves about 136 MB unused. That is the memory fix, a separate code mod (`acnh-memory-fix-peanuts.zip`, +42 MiB) that the patcher page saves next to the mod. It is described in full in [acnh-qol-peanuts' PORT.md](https://github.com/catmona/acnh-qol-peanuts/blob/main/docs/PORT.md#the-memory-fix). With the fix installed, the page ships all 25 icons. With its box unticked, the page leaves them out as before, and the items show without their own icons.

### EventFlow

The port's `EventFlow/Info/EventFlowInfoProduct.byml` is a 2.x-era file that also changes existing 3.0.3 entries, so the build uses a merged one: vanilla 3.0.3 plus only the port's new entries (`tools/add_eventflow.py`). The earlier boot crash at `main+0x1ae078c` was the size table, not the byml. Combined was first in the mod list then, and its table capped `EventFlowInfoProduct.byml` at 274,944 bytes, below the merged file's 277,392. With Jubbsticks first and the size tables max-merged, the EventFlow build boots and loads the island on Peanuts 0.1.8. It is in the release.

### Peanuts mod order and size tables

Peanuts lays mods over the game in list order, and the **first** mod that has a file wins. There is no reorder: deleting and reinstalling a mod puts it last. The `ResourceSizeTable.srsizetable` is a file like any other, so only the first mod's table is used, and the game refuses any file bigger than its entry there. That is why Jubbsticks must be installed first, and why the patcher's optional "other mods" step (and `tools/build_rstb.py --with`) takes the largest size per file across this mod and the other mods' tables.

### ACNH Combined 3.0.3

The two mods share `ItemParam`, `ItemKind`, `ItemOutfitInfo` and `EventFlagsLifeSupportDailyParam`. A keyed row diff against vanilla finds no clash that matters: Combined changes 1 ItemParam row, 6 ItemOutfitInfo rows and one daily-param field, and the only real overlap is the stack size of 34 ItemKind rows (Jubbsticks' 254 wins over Combined's 99). They also share the two flows `SNPC_fox_11_Commune_Lorrery` and `SNPC_slo_02_Commune` and the Pansy and Rose models, where Jubbsticks wins.

With QoL, Jubbsticks and full Combined, the title loads but the island load crashes (`pc=sdk+0x582b2c`, a NULL memset after an actor pool allocation fails). Removing parts of Combined on the device narrowed it to its oak models: without `PltTreeOak` and `PltTreeOakSnow`, all three load the island. Combined's own model check fails `PltTreeOak` (geometry and material block 1,458,176 bytes vs vanilla 1,462,272), so the fix belongs in Combined. Combined's build `7f0328c39d930d5a...` (SHA-256) loads the island with QoL and Jubbsticks on Peanuts 0.1.8.

The 6 ItemOutfitInfo rows are Combined's unbreakable gold tools. They come from "Unbreakable Golden Tools v3.0.0" (`goldtoolsunbreakable-v300.zip`), and its only file is `romfs/Bcsv/ItemOutfitInfo.bcsv`. That file sets the uses field (`68db76c2`) of rows 76, 78, 80, 82, 84 and 86, the golden rod, axe, watering can, shovel, net and slingshot, to 65535. Jubbsticks has its own version: its ItemOutfitInfo sets all 23 tool rows to 65535, so every tier, gold included, is unbreakable (vanilla uses: rod 10/30/90, axe 3/40/100/200, watering can 20/60/180, shovel 40/50/100/200, net 10/30/60/90, slingshot 10/20/60). In Peanuts the first mod in the list that has a file wins, and Jubbsticks comes first, so Combined's copy was never read. Gold tools are now out of Combined anyway. Combined is built by `acnhtree.py`, which copies each path from the highest-ranked mod that ships it. No other source mod and none of the hand-merged files has ItemOutfitInfo, so building without gold-tools gives the old build minus that one file. That is 154 files, SHA-256 `b8ea3745e419e7c4...`. The size table entry can stay, because the file is still a vanilla file (Jubbsticks or the base game supplies it). Nothing changes in game.

## Audit of the port against vanilla 3.0.3

`tools/audit_port.py` compares every file of the port's V0.0.2 release (the same bytes as its `main` on Nov 25, 2026) with vanilla 3.0.3 and with Jubbsticks 1.0.11, the 2.0-era original. Of the port's 1,335 romfs files, 123 replace a vanilla file:

| Folder | Replaces vanilla | Byte-identical to 1.0.11 |
| --- | --- | --- |
| `EventFlow/` | 32 (31 flows plus the flow list) | 28 |
| `Model/` | 40 | 40 |
| `Param/` | 18 | 17 |
| `Bcsv/` | 13 | 0 |
| `Message/` | 18 | 0 (the build puts back their missing labels, see above) |
| `Stage/`, `System/` | 2 | 0 |

A second pass also compared each replaced file with vanilla 1.0.0:

- If 1.0.0 and 3.0.3 agree and 1.0.11 differs, the change is Jubbsticks' own.
- If 1.0.0 and 1.0.11 agree and 3.0.3 differs, the port carries an old vanilla value.
- There is no 2.0 dump here. A difference in a file or row that 1.0.0 doesn't have can't be dated to 2.0 or 3.0.

### Flows

The item tables were redone on 3.0.3, but most flows were not. Of the 31 replaced flows:

- 28 are 1.0.11's files, byte for byte.
- Leif's two (`SNPC_slo_00_Peddling`, `SNPC_slo_02_Commune`) are 1.0.11's files with a port edit. The port added one string (`sub2`) and none of 3.0's content.
- `Demo_PublicAnnouncement_Process` is not in 1.0.11. Every string in it is also in 3.0.3's copy, but it lacks 24 of 3.0.3's strings. It looks like an older vanilla file shipped as is. `FileInfo.md` doesn't mention it.

The table lists the strings in vanilla 3.0.3 that the port's copy lacks:

| Flow | 3.0 content the port's copy lacks | What Jubbsticks adds |
| --- | --- | --- |
| `Ftr_Working` (workbench) | crafting several at once (`IsDIYMultiCreation`), materials from storage (`CanUseStorageMaterial`, `NoticeUsingStorageForRemake`), the hotel tutorial | bulk fish bait, which 3.0 now does natively. The port's README says this flow was ported, but it is the 1.0.11 file |
| `SNPC_slo_00_Peddling`, `SNPC_slo_02_Commune` (Leif) | 3.0's cheaper weeding (`SloExplainWeedingPriceDown`, `SloExplainWeeding_After3`, label `SP_slo:400`) | bamboo cultivation (`BambooCult`) |
| `Demo_PublicAnnouncement_Process` (morning announcement) | `EventFlowQueryIsSwitch2Edition`, `SendCloudIslandLetter`, `SendMegaphoneLetter`, `UnlockKpp2ndTourTips` and 20 event names | nothing: not a Jubbsticks file |
| `SNPC_pck` (Pascal) | `cCarnivalFeather`, `cSwap` | a feather trade |
| `SNPC_fox_11_Commune_Lorrery` (Redd, Harv's Island) | `FoxCommuneBook`, `FoxCommuneFood`, `FoxCommuneSubtool` prizes | the new fruit and the lucky prizes |
| `SNPC_pge` (Brewster) | `NetIsSwitch2EditionSession`, `SetMuseumCafeOver8CameraDemoParam` | the gyroid flag |
| `Player_GetDemo_Once` | hotel tickets and coupons, `PlayOnceAfterUpdateAOC`, `TapDreamFirstTalk` | one message |
| `Player_GetDemo`, `Player_GetDemo_Recipe_DIY` | `cCloudIslandAll` | the clam count, the sturdy tool recipes |
| `SNPC_hgc_01_NowQuest` | the hotel mannequin rental, `SP_hgc:181`-`182` | one achievement flag |
| `NNPC_Talk_General` (villager small talk) | 20 strings, among them `IsMidNight`, `ForMileTicketSupport_Chk`, `ContinuousTalkCount` | nothing visible |
| `Tutorials_Prologue_Tkk` (new game) | `AoC`, `BundledEdition`, `VersionUp`, and 21 more strings | a Tom Nook dream |
| `Obj_RcoMachine_MileExchange`, `SNPC_doc_52_CommuneIsland` | 8 and 12 events | Nook Miles rewards, the Mole flag |

`Tutorials_Prologue_Tkk`: 1.0.0's file has none of `AoC`, `BundledEdition` or `VersionUp`. 1.0.11's file has 18 strings that 1.0.0's lacks. So Jubbsticks started from a file newer than 1.0.0, and these three came with a later update: they aren't a pre-2.0 leftover. Without a 2.0 dump we can't tell whether Jubbsticks cut them or their base file never had them. Their own change (the dream) doesn't touch that part of the file.

This compares strings, not flow logic. A missing string shows that the port's file is older than 3.0.3, but how much each loss matters in play still needs checking in game.

### Item tables

Every vanilla 3.0.3 row id is still there, and every row 3.0 added is kept. In every cell where the port has 1.0.11's value instead of 3.0.3's, 1.0.0 has 3.0.3's value. So each of those is Jubbsticks' own change, not a revert:

- `ItemKind`: 3 cells, plus the port's own stack sizes.
- `ItemMenuIcon`: rows 474-525 are the planted-flower icons (`PltRose0` to `PltMum5`). They now point at Jubbsticks' fruit, ore and tool icons. Only the planted flowers use those rows.
- `ItemUnitIcon`:
  - 18 icon rows are reused the same way (floor, rug and wallpaper icons).
  - 157 Japanese comment cells came out garbled from Jubbsticks' tool. The game doesn't read them.
- `ItemOutfitInfo`: durability 65535 (unbreakable tools).
- `EventFlagsLifeSupportDailyParam`:
  - Row 22 (`AchieveQuest`) is in 1.0.0 and 3.0.3, but not in 1.0.11 or the port.
  - Rows 230 and 231 are new.
- `RecipeCraftParam`:
  - It has 3.0's 3 new fields.
  - The port changed field `9c4efa45` on 38 vanilla recipes (gold furniture, zodiac furniture).
  - All 97 recipes the port adds have 9800 in that field.
  - That may be the hotel-delivery exclusion the README describes. We haven't confirmed which field controls hotel requests.

What the port lost or broke on the way:

- **Recipes 1226 and 1227 make the wrong items.** Not checked in game.
  - In 1.0.11 they made the woodland arch and the woodland shrub (items 883 and 884).
  - 3.0 uses 883 and 884 for the apple and orange souvenir bags. The port moved the two furniture items to 881 and 886, but the recipes still point at 883 and 884, so crafting them should give a souvenir bag.
  - Items 881 and 886 have no recipe and no name.
  - The port still ships the names `Ftr_00883` "woodland arch" and `Ftr_00884` "woodland shrub", which nothing uses.
- **The green leaf balloon is gone.** 1.0.11's `ToolBalloonLeafGreen` was item 14540, which is 3.0's Nook Inc. balloon. The port kept 3.0's item but not its name: `Balloon_14540` reads "green leaf balloon" in USen and EUen.
- **The petaltail dragonfly furniture** moved from 1030 and 1031 (now villager photos) to 1028 and 1034, with no names.
- **Pansies: 20 items lost their field objects.** Not checked in game.
  - `FgMainParam` drops 1.0.11's 21 rows 59977-59999.
  - The planted pansies (`PltPansyRed1`-`3`, `Blue1`-`3`, `Pink1`-`3`, `Coral1`-`3`) are still in `ItemParam`, with nothing to place.
  - So are the flowers `FlwPansyCoral`, `FlwPansyPink`, `FlwPansyRedHybrid`, `FlwPansyBlueHybrid` and `FlwPansyCoralHybrid`.
  - Planting one may crash or show nothing.
- **17 new items have no name:**
  - the white modern bed (1000)
  - fish 1010-1013 and insects 1020-1027
  - the petal pieces (1028, 1034) and the woodland pieces (881, 886)
  - `ToolRadarSzo` (2001) and the Roost board (11111)

  1.0.11 had names for 6 of the critters: barbel steed, eel, black widow, house centipede, luna moth, petaltail dragonfly.
- Item 1935 (perfect-apple fritter) points at a menu icon row that doesn't exist.
- No recipe points at an item that doesn't exist. This checked each recipe's result and its 4 material fields.

### Messages

`LayoutMsg` and `TalkNNpc` match 3.0.3 label for label. `String_USen` and `String_EUen` lack 79 of 3.0.3's labels. 75 of them are vanilla item names: the Dream tools, the Cloud Island kits, `ToolMegaphoneMike`, the garden items. The Peanuts build puts them back. The port as released shows those names blank.

In these labels the port has 1.0.11's text instead of 3.0.3's:

- `TalkFtr` `FTR_WorkingTable:023`, `024`, `024_a`, `024_b`:
  - 3.0 reuses these labels for the Pocket Camp and Paradise Planning phone cases ("Customize it!" / "Not right now.").
  - The port has Jubbsticks' bait lines instead ("I made a bunch of fish bait!", "Craft more!" / "All done for now.").
- `pge/SP_pge_02_Takeout`: about 19 lines of Brewster's coffee to go, reworded in 3.0. Matches the port's 2.0 flow.
- `SP_slo_02_Commune:098`, and Leif's mail `SNpc_slo:201` (3.0 changed its sign-off).
- `String_EUen` has US names in the EU English file: Spork for Crackle, Jacob for Jakey, pachy, sparkling cider, aloha edition. Cosmetic.

### Params, presets and models

- **Mystery Tour presets 28-48** are 1.0.11's files. 1.0.0 has no copy of them.
  - They differ from 3.0.3 only in item ids: Jubbsticks' 608xx field objects in place of vanilla's 600xx.
  - Every 608xx id is in the port's `FgMainParam`.
- **`Preset0_Item_RVer_20000`** (Harv's Island) is the port's own: 3.0.3's file with 44 values changed and 8 keys added.
- **`IdrMuseumCafe`** is vanilla's 12 objects plus the Roost board.
- **`PhotoStudioIslandExtend`** is 3.0.3's 51 entries plus 1.0.11's 4 NPCs (`AI_NPC_Fsl_Commune`, `AI_NPC_CommuneDud`, `AI_NPC_Mob_Commune` and one more). Nothing of 3.0's is lost.
- **Models:** all 40 are 1.0.11's.
  - 30 are vanilla files that 3.0.3 still has as in 1.0.0, so they are Jubbsticks' changes.
  - 9 have no 1.0.0 copy: 8 smoothie icons and the Roost room.
  - `ToolFishingrodWood` changed in vanilla after 1.0.0, and the port has 1.0.11's, so it may be an old model.

### Flow list and size tables

`EventFlowInfoProduct.byml` names no flow that's missing. The port's copy adds 4 strings. It has no entries for 7 of the port's own new flows:

- `AI_NPC_CommuneDud`, `AI_NPC_Fsl_Commune`, `AI_NPC_Mob_Commune`, `AI_NPC_Mol_Commune`
- `SNPC_fsl_02_Commune`, `SNPC_mob_01_Commune`, `SNPC_spn_19_Commune_AltFslFlows`

The Peanuts build adds the names of all the port's new flows.

This table shows which size table has an entry for each port file:

| Files | Count | In 3.0.3's table | Only in the port's table | In neither |
| --- | --- | --- | --- | --- |
| Models | 1,236 | 40 | 667 | 529 |
| Roost loose textures (`_Tex_`) | 7 | 0 | 0 | 7 |
| Flows | 40 | 31 | 9 | 0 |
| Bcsv, messages, flow list | 32 | 32 | 0 | 0 |
| Param and Stage byml | 19 | 0 | 0 | 19 |

- Vanilla's table has no entries for Param or Stage byml at all, so those 19 are normal.
- The 529 new models with no entry load in the full build (see the checks below), so the game's fallback copes with them.
- The 7 Roost textures are the only loose texture files in the port, and the main suspect for the Roost crash.
- The port's own table lacks 23 entries that 3.0.3's has, among them `PltFlwPansy`, `PltFlwRose`, `ToolAxeFirst`, `ToolNetWood` and `IdrMuseumCafe00`. It also has 31 sizes smaller than 3.0.3's. That only matters for the port as released: the Peanuts build starts from 3.0.3's table.

### The port's README and FileInfo

- **Bait bulk crafting.** The README says "I did attempt to port the changes over". But `Ftr_Working` is 1.0.11's file, byte for byte, so 3.0's multi-craft and crafting from storage are gone at the workbench.
- **Hotel DIY deliveries.** The README says the mod's recipes were "manually flagged". See `RecipeCraftParam` above: plausible, not confirmed.
- **The "Removed" list** names only the 2 bananas and the translations. It leaves out the green leaf balloon, the pansy field objects, the woodland arch and shrub recipes, and the critter names.
- **`FileInfo.md`** names `SNPC_rcm_11_BuyDIYBook`, but the file is `SNPC_rcm_11_BuyDIYbook.bfevfl`. It lists only 2 of the 31 replaced flows as conflicts.

### The Roost

The port's Roost is Jubbsticks 1.0.11's, unchanged. It is 9 files:

- the room model `Model/IdrMuseumCafe00`
- 7 loose `IdrMuseumCafe00_Tex_*` texture files
- `Param/Field/StagePreset/IdrMuseumCafe.byml`

The preset adds one object to vanilla's 12: item 11111 at (17, 25). That is the bulletin board of the gyroids not yet given to Brewster (`Ftr_Bromide` checks `cMuseumCafe`). The board only shows a list. The gyroid trade itself is in Brewster's flows (`SNPC_pge`, `SNPC_pge_02_Takeout`). Neither Nintendo's 3.0.x notes nor Nookipedia list any change at the Roost or to gyroids.

The 7 texture files are the only loose `_Tex_` files in the whole port. Neither vanilla's nor the port's size table has an entry for them.

A player's log crashes as the Roost loads. Their setup: Retroid Pocket 5, Peanuts 0.1.8, QoL, this build and Shops Always Open.

- The log shows `[RED] BufferInitialize: pool has no storage (pool 0x0 ...)`, then `CRASH sig=11 addr=0x4`.
- The first game frame is `main+0x247c54`.
- The game sets up a GPU buffer with no memory pool behind it.

The next test is the same island without the 9 Roost files. Nobody has tried it yet, because nobody here has an island with the Roost.

### Shops Always Open (GameBanana 724342)

Version 1.1 (`shops_always_open_v1_1_0_for_acnh_v3_0_3.zip`, 51,234 bytes; the folder inside says v1.0.1), MIT licence. It is a 3.0.3 exefs patch (one 65-byte IPS) plus 13 flows:

- `AI_NPC_Rcm_Shop`, `Obj_Sign`
- `SNPC_alp_02_Commune`, `SNPC_alw_02_Commune`, `SNPC_bpt_02_Commune`, `SNPC_cml_02_Commune`, `SNPC_skk_02_Commune`, `SNPC_slo_02_Commune`, `SNPC_ttl_02_Commune`
- `SNPC_fox_11_Commune`, `SNPC_fox_11_Commune_Lorrery`
- `System_Door_Market`, `System_Door_Tailor`

Its flows are 3.0.3's with some bytes changed. They have the same strings as vanilla, so they keep 3.0's content.

Two of them are also in this port: `SNPC_slo_02_Commune` (Leif on Harv's Island) and `SNPC_fox_11_Commune_Lorrery` (Redd on Harv's Island). In Peanuts, the first mod in the list wins the whole file:

- With Jubbsticks first, those two NPCs keep the port's features but lose their 24/7 hours.
- With Shops Always Open first, they keep the 24/7 hours and 3.0's cheaper weeding, but lose bamboo cultivation and the new raffle.

Fixing that needs a merged flow.

## The patch file

`jub-port-patch.json` (about 476 KB) holds no files from the port or the original mod:

- `strings`: the 79 label texts to add per MSBT inside `String_USen`, with content hashes before and after
- `messages`: the same for the other message sarcs the build changes (`String_EUen`, `TalkSNpc_USen`, `TalkSNpc_EUen`). An entry also carries the label's ATR1 attribute bytes when the MSBT has them
- `rstb`: the size table, deflated, with its hash
- `eventflow`: the 40 new flow names, and the 3.0.3 values of the 7 flow-list entries the port's 2.x-era byml changed, which the page puts back (hashes before and after)
- `with_fix`: the 25 UnitIcon models, which the page ships only when the memory fix box is ticked
- `drop`: files the page always leaves out (empty in this release; the older patch listed the UnitIcon models here)
- `bcsv`: empty in this release (kept in the format for later fixes)

The page reads the port's `.7z` itself (a small LZMA/LZMA2 reader in `docs/app.js`) or a zip of the same files, applies the patch, checks every hash and writes a stored (uncompressed) zip. In Node the whole build takes about 1.4 s from the 33 MB `.7z` and 0.3 s from a zip. Recompression is skipped: the message sarcs go out as a raw-block zstd frame and the size table as store-only Yaz0, which the game reads fine.

## Checks that were run

- The page's code (`node test/run.mjs`) and the Python build give the same 1,269 files outside `EventFlow/` for V0.0.2, compared file by file (zstd files compared after decompressing). The page's full build is 1,310 files.
- An older patch file (without `messages`) still builds the older zip byte for byte on the new page.
- The `.7z` and a re-zipped copy of the same download give byte-identical output zips.
- A damaged `.7z` is refused with an error instead of a broken zip.
- On an AYN Thor (Peanuts 0.1.8, frame rate cap "Game owned"), QoL, this V0.0.2 build and ACNH Combined 3.0.3 load the island together, in that list order (checked in `DM_ROMFS_OVERLAY`). With the cap at 60 fps and no memory fix, QoL and a no-icon build of this mod crashed during the island load (`CRASH sig=11 addr=0x30 pc=main+0x38bb0cc`): the same draw-array heap running out. With the memory fix, QoL, the full build (1,335 files, 25 icons), ACNH Combined 3.0.3 and the fix load the island at the 60 fps cap with no crash, at 42-49 fps. That run had the pack's `main.xmod.tsv` copied into `60/` by hand, which QoL needs until Peanuts passes `--xmod`. This mod at 60 fps without QoL was not tried.
- Nobody has checked yet that one of the 40 new flows plays in game: the test island is at the tent stage, and its player can't reach the Resident Services tent or the villagers yet.
