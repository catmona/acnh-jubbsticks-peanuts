"""Usage: build_rstb.py <base table (vanilla 3.0.3, from your own game)> <port table> <romfs dir> <out> [--with <other mod zip>...]
Base + raised sizes for every file in romfs that has an entry; entries for files that have none are copied from the port's own table if it has one.
With --with, each other mod's table is max-merged in (its sizes raised, its extra entries added), so it can be installed first."""
import sys,os,zlib,struct,zstandard,zipfile,tempfile; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import yaz0,parse
d,v,E,tail=parse.load(sys.argv[1]); T={e[0]:list(e) for e in E}
pd,pv,PE,ptail=parse.load(sys.argv[2]); P={e[0]:e for e in PE}
R=sys.argv[3]; up=lambda n:(n+31)//32*32; zs=zstandard.ZstdDecompressor(); raised=added=nonew=0
for dp,_,fs in os.walk(R):
    for f in fs:
        full=os.path.join(dp,f); rel=os.path.relpath(full,R).replace(os.sep,'/'); raw=open(full,'rb').read()
        if rel.endswith('.zs'): dec=len(zs.decompress(raw,max_output_size=1<<30)); name=rel[:-3]
        elif raw[:4]==b'Yaz0': dec=len(yaz0.dec(raw)); name=rel
        else: dec=len(raw); name=rel
        k=zlib.crc32(name.encode())
        if k in T:
            old=T[k][1]
            new=max(old,up(dec)+old) if ('.Nin_NX_NVN' in rel and old-dec<16384) else (old if '.Nin_NX_NVN' in rel else max(old,up(dec)+1024))
            if new!=old: T[k][1]=new; raised+=1
        elif k in P: T[k]=list(P[k]); added+=1
        else: nonew+=1
W=sys.argv[6:] if sys.argv[5:6]==['--with'] else []
for z in W:
    zf=zipfile.ZipFile(z); n=[x for x in zf.namelist() if x.endswith('System/Resource/ResourceSizeTable.srsizetable')]
    if not n: print('no size table in',z); continue
    t=os.path.join(tempfile.mkdtemp(),'t'); open(t,'wb').write(zf.read(n[0])); _,ov,OE,_=parse.load(t)
    assert ov==v,('table version',ov,v); up=ad=0
    for k,s,z0 in OE:
        if k not in T: T[k]=[k,s,z0]; ad+=1
        elif s>T[k][1]: T[k][1]=s; up+=1
    print(os.path.basename(z),'raised',up,'added',ad)
out=b'RSTC'+struct.pack('<II',len(T),v)+b''.join(struct.pack('<III',*T[k]) for k in sorted(T))+tail
open(sys.argv[4],'wb').write(yaz0.enc_raw(out)); assert yaz0.dec(open(sys.argv[4],'rb').read())==out
print('entries',len(E),'->',len(T),'raised',raised,'added from port table',added,'files with no entry anywhere',nonew)
