# How the Peanuts build is made

Notes on what the patcher does to the port's download and why. Everything here is for ACNH 3.0.3 under Peanuts Native 0.1.7.

## What changes

The output is the port's own romfs with three changes:

| What | Why |
| --- | --- |
| `Model/UnitIcon*` and every `Message/` file except `String_USen` are left out | they crash 3.0.3 on Peanuts (table below) |
| `EventFlow/`: the 40 new flows go in, and `EventFlowInfoProduct.byml` is the 3.0.3 file plus the port's new entries | the port's own byml is 2.x-era (see EventFlow below) |
| `Message/String_USen.sarc.zs` gets back 79 vanilla 3.0.3 item names | the port's copy lacks their labels (9 tools, 70 other items) |
| `System/Resource/ResourceSizeTable.srsizetable` is rebuilt | vanilla 3.0.3's table, plus the port's entries for its new files, with sizes raised where a port file is bigger |

The item tables (`Bcsv/*`), stages, params, layouts and models go in exactly as the port ships them, including its 254 stack limit.

## What is left out, and why

Bisecting on an AYN Thor (each build listed in the launch log's `DM_ROMFS_OVERLAY`, so the mod was really loaded). These tests ran on V0.0.1 builds installed next to two other mods:

| Build | Result |
| --- | --- |
| Item tables, size table and `String_USen` only | boots, plays the new-game intro |
| All of the port except `EventFlow/*` and `Model/UnitIcon*` | boots |
| ... plus the port's `EventFlow/` | hangs on load |
| ... plus the 20 `UnitIcon*` models | crashes (SIGSEGV) |
| ... plus the port's other `Message/` sarcs | crashes while loading `Message/System_*` (they are 2.x-era; all 9 USen sarcs differ from 3.0.3) |

### EventFlow

The port's `EventFlow/Info/EventFlowInfoProduct.byml` is a 2.x-era file that also changes existing 3.0.3 entries, so the build uses a merged one: vanilla 3.0.3 plus only the port's new entries (`tools/add_eventflow.py`). The earlier boot crash at `main+0x1ae078c` was the size table, not the byml. Combined was first in the mod list then, and its table capped `EventFlowInfoProduct.byml` at 274,944 bytes, below the merged file's 277,392. With Jubbsticks first and the size tables max-merged, the EventFlow build boots and loads the island on Peanuts 0.1.8. It is in the release: the page's build is byte for byte the zip that loaded the island on the Thor. Nobody has checked yet that a new NPC flow plays.

### Peanuts mod order and size tables

Peanuts lays mods over the game in list order, and the **first** mod that has a file wins. There is no reorder: deleting and reinstalling a mod puts it last. The `ResourceSizeTable.srsizetable` is a file like any other, so only the first mod's table is used, and the game refuses any file bigger than its entry there. That is why Jubbsticks must be installed first, and why the patcher's optional "other mods" step (and `tools/build_rstb.py --with`) takes the largest size per file across this mod and the other mods' tables.

### ACNH Combined 3.0.3

The two mods share `ItemParam`, `ItemKind`, `ItemOutfitInfo` and `EventFlagsLifeSupportDailyParam`. A keyed row diff against vanilla finds no clash that matters: Combined changes 1 ItemParam row, 6 ItemOutfitInfo rows and one daily-param field, and the only real overlap is the stack size of 34 ItemKind rows (Jubbsticks' 254 wins over Combined's 99). They also share the two flows `SNPC_fox_11_Commune_Lorrery` and `SNPC_slo_02_Commune` and the Pansy and Rose models, where Jubbsticks wins.

With QoL, Jubbsticks and full Combined, the title loads but the island load crashes (`pc=sdk+0x582b2c`, a NULL memset after an actor pool allocation fails). Removing parts of Combined on the device narrowed it to its oak models: without `PltTreeOak` and `PltTreeOakSnow`, all three load the island. Combined's own model check fails `PltTreeOak` (geometry and material block 1,458,176 bytes vs vanilla 1,462,272), so the fix belongs in Combined.

## The patch file

`jub-port-patch.json` (about 479 KB) holds no files from the port or the original mod:

- `strings`: the 79 label texts to add per MSBT inside `String_USen`, with content hashes before and after
- `rstb`: the size table, deflated, with its hash
- `eventflow`: the 40 new flow names, and the 3.0.3 values of the 7 flow-list entries the port's 2.x-era byml changed, which the page puts back (hashes before and after)
- `bcsv` and `drop`: empty in this release (kept in the format for later fixes)

The page reads the port's `.7z` itself (a small LZMA/LZMA2 reader in `docs/app.js`) or a zip of the same files, applies the patch, checks every hash and writes a stored (uncompressed) zip. In Node the whole build takes about 1.4 s from the 33 MB `.7z` and 0.3 s from a zip. Recompression is skipped: `String_USen` goes out as a raw-block zstd frame and the size table as store-only Yaz0, which the game reads fine.

## Checks that were run

- The page's code (`node test/run.mjs`) and the Python build give the same 1,252 files for V0.0.2, compared file by file (zstd files compared after decompressing).
- The `.7z` and a re-zipped copy of the same download give byte-identical output zips.
- A damaged `.7z` is refused with an error instead of a broken zip.
- The V0.0.2 standalone build has not been on the device yet.
