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

With QoL, Jubbsticks and full Combined, the title loads but the island load crashes (`pc=sdk+0x582b2c`, a NULL memset after an actor pool allocation fails). Removing parts of Combined on the device narrowed it to its oak models: without `PltTreeOak` and `PltTreeOakSnow`, all three load the island. Combined's own model check fails `PltTreeOak` (geometry and material block 1,458,176 bytes vs vanilla 1,462,272), so the fix belongs in Combined. Combined's current build (SHA-256 `7f0328c39d930d5a...`) loads the island with QoL and Jubbsticks on Peanuts 0.1.8.

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
