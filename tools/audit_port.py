"""Audit the Jubbsticks port's romfs against vanilla 3.0.3 and Jubbsticks 1.0.11 (2.0-era).
Usage: audit_port.py <port romfs> <vanilla 3.0.3 files> <vanilla 3.0.3 size table> <Jubbsticks 1.0.11 zip> <out json>
Vanilla files: the 3.0.3 copies of the port's non-model files, from your own game.
For each port file: new or replacing vanilla, byte-identical to Jubbsticks 1.0.11 (2.0-era) or not, and against vanilla:
flows: strings vanilla has that the port lacks (3.0 content the port file drops); bcsv: rows and ids; byml: diffs; sarc: files."""
import sys, os, zlib, json, re, struct, zipfile, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import yaz0, bcsv, byml, sarc, msbt
import zstandard
PR, VAN, VR, JZ, OUT = sys.argv[1:6]
zs = zstandard.ZstdDecompressor()
def dec(b): return zs.decompress(b, max_output_size=1 << 30) if b[:4] == b'\x28\xb5\x2f\xfd' else (yaz0.dec(b) if b[:4] == b'Yaz0' else b)
# vanilla rstb
d = yaz0.dec(open(VR, 'rb').read()); n = struct.unpack_from('<I', d, 4)[0]
VT = {struct.unpack_from('<I', d, 12 + 12 * i)[0]: struct.unpack_from('<I', d, 16 + 12 * i)[0] for i in range(n)}
jz = zipfile.ZipFile(JZ); J = {x.split('romfs/', 1)[1]: x for x in jz.namelist() if 'romfs/' in x and not x.endswith('/')}
rows = []
for dp, _, fs in os.walk(PR):
    for f in fs:
        full = os.path.join(dp, f); rel = os.path.relpath(full, PR).replace(os.sep, '/')
        raw = open(full, 'rb').read(); nm = rel[:-3] if rel.endswith('.zs') else rel
        vf = os.path.join(VAN, rel)
        r = dict(rel=rel, top=rel.split('/')[0], vanilla_entry=VT.get(zlib.crc32(nm.encode())), has_van=os.path.exists(vf))
        r['jub'] = ('same' if jz.read(J[rel]) == raw else 'changed') if rel in J else 'not in 1.0.11'
        if r['top'] == 'Model':
            r['dec'] = len(dec(raw))
        if r['has_van']:
            a = dec(open(vf, 'rb').read()); b = dec(raw); r['van_same'] = a == b; r['van_len'] = len(a); r['port_len'] = len(b)
            if not r['van_same']:
                if rel.endswith('.bfevfl'):
                    S = lambda x: set(m.decode() for m in re.findall(rb'[\x20-\x7e]{4,}', x))
                    sa, sb = S(a), S(b); r['van_only'] = sorted(sa - sb)[:80]; r['port_only_n'] = len(sb - sa); r['van_only_n'] = len(sa - sb)
                elif rel.endswith('.bcsv'):
                    ta, tb = bcsv.parse(a), bcsv.parse(b); r['rows'] = (ta['n'], tb['n'])
                    fa = set(h for h, _ in ta['fields']); fb = set(h for h, _ in tb['fields']); r['fields'] = (len(fa), len(fb), len(fa - fb))
                    ka = collections.Counter(bytes(x) for x in ta['rows']); kb = collections.Counter(bytes(x) for x in tb['rows'])
                    r['rows_changed_or_gone'] = sum((ka - kb).values()); r['rows_new_or_changed'] = sum((kb - ka).values())
                    # rows keyed by the first field (usually the id)
                    h0 = ta['fields'][0][0]
                    if h0 in dict(tb['fields']):
                        ia = {bcsv.val(ta, x, h0) for x in ta['rows']}; ib = {bcsv.val(tb, x, h0) for x in tb['rows']}
                        r['ids_missing'] = len(ia - ib); r['ids_added'] = len(ib - ia); r['ids_missing_sample'] = sorted(map(str, ia - ib))[:15]
                elif rel.endswith('.byml'):
                    try:
                        df = byml.diff(byml.load(a), byml.load(b)); r['byml_diffs'] = len(df); r['byml_sample'] = [str(x)[:160] for x in df[:8]]
                    except Exception as e: r['byml_err'] = repr(e)
                elif rel.endswith('.sarc.zs') or rel.endswith('.sarc'):
                    try:
                        A = sarc.parse(a)[0]; B = sarc.parse(b)[0]
                        r['sarc_van_only'] = sorted(set(A) - set(B))[:20]; r['sarc_files'] = (len(A), len(B))
                        r['sarc_changed'] = sorted(k for k in A if k in B and A[k][2] != B[k][2])
                    except Exception as e: r['sarc_err'] = repr(e)
        rows.append(r)
json.dump(rows, open(OUT, 'w'), indent=1)
c = collections.Counter((r['top'], 'replaces vanilla' if (r['vanilla_entry'] is not None or r['has_van']) else 'new', r['jub']) for r in rows)
for k, v in sorted(c.items()): print(v, *k)
