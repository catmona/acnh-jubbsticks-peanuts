# How the Peanuts build is made

Notes on what the patcher does to the port's download and why. Everything here is for ACNH 3.0.3 under Peanuts Native 0.1.7.

## What changes

The output is the port's own romfs with three changes:

| What | Why |
| --- | --- |
| `EventFlow/*`, `Model/UnitIcon*` and every `Message/` file except `String_USen` are left out | they hang or crash 3.0.3 on Peanuts (table below) |
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

### EventFlow (open)

The port's `EventFlow/Info/EventFlowInfoProduct.byml` is a 2.x-era file that also changes existing 3.0.3 entries. A merged one (vanilla 3.0.3 plus only the port's new entries) still crashes at boot, with or without the new flow files, at `main+0x1ae078c`: a NULL resource returned while the Message sarcs load. The size table is ruled out, and the merged byml matches vanilla apart from the additions. The current lead is the number of sub-entries (vanilla has exactly 8000, the merged file 8074). That needs more device tests, so the new NPC dialogue flows are missing for now.

## The patch file

`jub-port-patch.json` (about 465 KB) holds no files from the port or the original mod:

- `strings`: the 79 label texts to add per MSBT inside `String_USen`, with content hashes before and after
- `rstb`: the size table, deflated, with its hash
- `bcsv` and `drop`: empty in this release (kept in the format for later fixes)

The page reads the port's `.7z` itself (a small LZMA/LZMA2 reader in `docs/app.js`) or a zip of the same files, applies the patch, checks every hash and writes a stored (uncompressed) zip. In Node the whole build takes about 1.4 s from the 33 MB `.7z` and 0.3 s from a zip. Recompression is skipped: `String_USen` goes out as a raw-block zstd frame and the size table as store-only Yaz0, which the game reads fine.

## Checks that were run

- The page's code (`node test/run.mjs`) and the Python build give the same 1,252 files for V0.0.2, compared file by file (zstd files compared after decompressing).
- The `.7z` and a re-zipped copy of the same download give byte-identical output zips.
- A damaged `.7z` is refused with an error instead of a broken zip.
- The V0.0.2 standalone build has not been on the device yet.
