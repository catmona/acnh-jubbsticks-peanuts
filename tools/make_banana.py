"""2 bananas per tree for ACNH 3.0.3: dragonloverlord's 2.0.6 "Banana Tree Fix" re-fitted to 3.0.3 main (docs/BANANA.md).
Usage: make_banana.py <out dir> [main]   writes the IPS32 (atmosphere/exefs_patches layout) and the cheat text.
With main (the exefs NSO or a flat image of 3.0.3 main) it first checks the 9 stock words at the site by SHA-256."""
import sys, os, struct, hashlib

BUILD_ID = 'ff1d1c05670db6021c85b624a710b963'   # ACNH 3.0.3 main
SITE = 0x113b45c                                 # main offset; 9 words up to 0x113b480
STOCK_SHA = '3a6b278b6279bcdc5dfb6cafc9817fcce144ff0c47ba29f0ceb9a315c9804fc3'
GETTER = 0x267d6c4                               # item id getter (ldrh [x0] plus remake fix-ups)
COCONUT, BANANA = 0x8f0, 0x9da                   # 2288 vanilla coconut, 2522 Jubbsticks' banana

bl = lambda src, dst: 0x94000000 | (((dst - src) >> 2) & 0x3ffffff)
WORDS = [
    0xaa1303e0,                                          # mov  x0, x19
    bl(SITE + 4, GETTER),                                # bl   getter          w0 = fruit item id (kept for the egg check at +0x24)
    0xb4000000 | ((0x113b480 - (SITE + 8)) >> 2) << 5 | 20,  # cbz  x20, 0x113b480  no count wanted: skip (stock skipped to the 2nd getter call)
    0x7100001f | COCONUT << 10,                          # cmp  w0, #0x8f0
    0x52800008 | BANANA << 5,                            # mov  w8, #0x9da
    0x7a481004,                                          # ccmp w0, w8, #4, ne  coconut: Z=1, else Z = (banana)
    0x52800048,                                          # mov  w8, #2
    0x1a880508,                                          # cinc w8, w8, ne      3 for every other fruit
    0xb9000288,                                          # str  w8, [x20]
]
CODE = b''.join(struct.pack('<I', w) for w in WORDS)


def stock_words(path):
    d = open(path, 'rb').read()
    if d[:4] != b'NSO0':
        return d[SITE:SITE + 36]
    assert d[0x40:0x50].hex() == BUILD_ID, 'not ACNH 3.0.3 main'
    foff, moff, size = struct.unpack_from('<III', d, 0x10)
    raw = d[foff:foff + struct.unpack_from('<I', d, 0x60)[0]]
    if struct.unpack_from('<I', d, 0xC)[0] & 1:
        import lz4.block
        raw = lz4.block.decompress(raw, uncompressed_size=size)
    return raw[SITE - moff:SITE - moff + 36]


out = sys.argv[1]
if len(sys.argv) > 2:
    assert hashlib.sha256(stock_words(sys.argv[2])).hexdigest() == STOCK_SHA, 'stock code at the site differs: not 3.0.3 main, or already patched'
    print('stock words match')
d = os.path.join(out, 'atmosphere', 'exefs_patches', 'banana-tree-fix'); os.makedirs(d, exist_ok=True)
ips = b'IPS32' + struct.pack('>IH', 0x100 + SITE, len(CODE)) + CODE + b'EEOF'   # IPS offsets count the 0x100 NSO header
open(os.path.join(d, BUILD_ID + '.ips'), 'wb').write(ips)
cheat = '[Banana Tree Fix 3.0.3]\n' + ''.join(f'04000000 {SITE + 4 * k:08X} {w:08X}\n' for k, w in enumerate(WORDS))
open(os.path.join(out, 'banana-tree-fix-3.0.3.txt'), 'w', newline='\n').write(cheat)
print(cheat, end=''); print('IPS', len(ips), 'bytes ->', d)
