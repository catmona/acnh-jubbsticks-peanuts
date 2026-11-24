# How the Peanuts build is made

Notes on what the patcher does to the port's download and why. Everything here is for ACNH 3.0.3 under Peanuts Native 0.1.7, with three romfs mods in this order: ACNH-Combined (0), QoL Enhancements for Peanuts (1), this one (2).

## What goes wrong without it

Peanuts layers romfs mods, so the last mod's copy of a file wins. The port and ACNH-Combined both ship their own versions of the same files:

| File | Port | Combined | What the patcher does |
| --- | --- | --- | --- |
| `Bcsv/ItemParam.bcsv` | new items, 3.0.x IDs | one field on one item | port's table plus Combined's changed field |
| `Bcsv/ItemKind.bcsv` | stack limits 254 | stack 99 on one kind | port's table plus Combined's one edit |
| `Bcsv/EventFlagsLifeSupportDailyParam.bcsv` | port's rows | reward doubled on every row | port's rows with the reward doubled |
| `Message/String_USen.sarc.zs` | 2.x-era text, 79 vanilla item names missing | 7 renames | port's text plus the 79 vanilla names and Combined's 7 renames |
| `System/Resource/ResourceSizeTable.srsizetable` | 2.x-era sizes | Combined's sizes | one table that covers all three mods |
| 8 flower and fruit models | Jubbsticks' 2.x files | 3.0.3-safe copies | left out, so Combined's stay |

The merge is three-way: for each row the port and Combined share, a field takes Combined's value only when Combined changed it from vanilla 3.0.3 and the port didn't. Rows the port added are left alone. The stack limit of 254 is the port's feature and stays.

## What is left out

Bisecting on the Thor (each build listed in the launch log's `DM_ROMFS_OVERLAY`, so the mod was really loaded):

| Build | Result |
| --- | --- |
| Item tables, size table and `String_USen` only | boots, plays the new-game intro |
| All of the port except `EventFlow/*` and `Model/UnitIcon*` | boots (this is what the patcher makes) |
| ... plus the port's `EventFlow/` | hangs on load |
| ... plus the 20 `UnitIcon*` models | crashes (SIGSEGV) |
| ... plus the port's other `Message/` sarcs | crashes while loading `Message/System_*` (they are 2.x-era; all 9 USen sarcs differ from 3.0.3) |

So the patcher drops `EventFlow/*`, `Model/UnitIcon*` and every `Message/` file except `String_USen`.

### EventFlow (open)

The port's `EventFlow/Info/EventFlowInfoProduct.byml` is a 2.x-era file that also changes existing 3.0.3 entries. A merged one (vanilla 3.0.3 plus only the port's new entries) still crashes at boot, with or without the new flow files, at `main+0x1ae078c`: a NULL resource returned while the Message sarcs load. The size table is ruled out, and the merged byml is semantically equal to vanilla apart from the additions. The current lead is the number of sub-entries (vanilla has exactly 8000, the merged file 8074). That needs more device tests, so the new NPC dialogue flows are missing for now.

## The patch file

`jub-port-patch.json` (about 470 KB) holds no files from the port or the original mod:

- `bcsv`: byte edits per table, with the SHA-256 of the port's table before and of the result after
- `strings`: the label text to add or change per MSBT inside `String_USen`, with content hashes before and after
- `rstb`: the merged size table, deflated
- `drop`: the 8 model files to leave out

The page reads the port's `.7z` itself (a small LZMA/LZMA2 reader in `docs/app.js`, the whole build takes about 1.4 s in Node from the 33 MB download, against 0.3 s from a zip) or a zip of the same files, applies the edits, checks every hash and writes a stored (uncompressed) zip. Recompression is skipped: `String_USen` goes out as a raw-block zstd frame and the size table as store-only Yaz0, which the game reads fine.

## Checks that were run

- The page's code (`node test/run.mjs`) and the Python build give the same 1,249 files for V0.0.2, compared file by file (zstd files compared after decompressing).
- The `.7z` and a re-zipped copy of the same download give byte-identical output zips.
- A damaged `.7z` and the V0.0.1 download are both refused with an error instead of a broken zip.
- V0.0.1 builds were boot-tested on an AYN Thor (table above). The V0.0.2 build has not been on the device yet.
