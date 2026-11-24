# Banana Tree Fix for 3.0.3

dragonloverlord's 2.0.6 ExeFS patch gives banana trees 2 fruits, like coconut palms. This is the same patch re-fitted to ACNH 3.0.3's `main`. `tools/make_banana.py` writes it.

## The code

```
[Banana Tree Fix 3.0.3]
04000000 0113B45C AA1303E0
04000000 0113B460 94550899
04000000 0113B464 B40000F4
04000000 0113B468 7123C01F
04000000 0113B46C 52813B48
04000000 0113B470 7A481004
04000000 0113B474 52800048
04000000 0113B478 1A880508
04000000 0113B47C B9000288
```

The same 36 bytes as an IPS32 go in `atmosphere/exefs_patches/banana-tree-fix/ff1d1c05670db6021c85b624a710b963.ips` (IPS offsets are 0x100 higher for the NSO header).

## What changed from 2.0.6

The 2.0.6 patch rewrote an inline `ldrh w8, [x19]` and compared the id against 0x8F0 (2288, coconut) and 0x9DA (2522, Jubbsticks' banana): 2 fruits for those, 3 for the rest.

In 3.0.3 the same check is at `main+0x113b464`, but the compiler changed it:

```
cbz  x20, +0x1c         ; no count pointer: skip
mov  x0, x19
bl   0x267d6c4          ; item id getter (ldrh, plus fix-ups for a few special ids)
cmp  w0, #0x8f0
mov  w8, #2
cinc w8, w8, ne         ; 2 for coconut, else 3
str  w8, [x20]
mov  x0, x19
bl   0x267d6c4          ; the same id again, for the Easter egg check that follows
```

Only four words sit between the call and the store, so the 2.0.6 code doesn't fit. The new code calls the getter once and keeps its result for the Easter egg check. That frees the room for the second id, using one `ccmp`:

```
mov  x0, x19
bl   0x267d6c4
cbz  x20, 0x113b480     ; now jumps past the second call (w0 already holds the id)
cmp  w0, #0x8f0
mov  w8, #0x9da
ccmp w0, w8, #4, ne     ; coconut: Z=1; otherwise Z = (id == banana)
mov  w8, #2
cinc w8, w8, ne
str  w8, [x20]
```

## Checks

- Nothing else in `main` branches into the 9 rewritten words. The only branch is the `cbz` itself, which the patch re-aims.
- The getter only reads memory, so calling it once instead of twice changes nothing else.
- I ran the old and new code in Unicorn against the real 3.0.3 `main` for apple, orange, cherry, peach, pear, coconut, banana, the getter's special ids and a NULL count pointer. Only the banana count changes (3 to 2). `w0` and `x19` reach the following code with the same values.
- None of the QoL port's 152 hook sites in `main` is within 4 KB.
- Not run in a game yet: not on Switch, and not on Peanuts. Atmosphere cheats don't apply on Peanuts. Whether Peanuts applies this IPS next to another mod's IPS for the same `main` is also untested.
