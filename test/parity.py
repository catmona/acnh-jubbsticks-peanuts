"""Compare two built zips file by file (zstd and Yaz0 files after decompressing). Usage: python -I test/parity.py <a.zip> <b.zip>"""
import sys,os,zipfile; sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','tools')); import fix2,yaz0
A,B=(zipfile.ZipFile(x) for x in sys.argv[1:3]); na,nb=set(A.namelist()),set(B.namelist())
def plain(n,b): return fix2.dz(b) if n.endswith('.zs') else yaz0.dec(b) if b[:4]==b'Yaz0' else b
diff=[n for n in sorted(na&nb) if plain(n,A.read(n))!=plain(n,B.read(n))]
print(len(na),'and',len(nb),'files; only in first',sorted(na-nb)[:5],'only in second',sorted(nb-na)[:5],'; differ',len(diff),diff[:10])
sys.exit(1 if diff or na!=nb else 0)
