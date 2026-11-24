"""Build the standalone Peanuts romfs of the Jubbsticks port. Usage: build_jub.py <workspace> <out romfs dir>
Workspace: port-dl/repo (the port's extracted release), vanilla/update_2228224 (3.0.3 romfs files from your own game).
Item tables are the port's as is; String_USen gets back the vanilla 3.0.3 labels the port's copy lacks. The size table is build_rstb.py's job."""
import sys,os,shutil,struct,collections,zstandard
S=sys.argv[1]; OUT=sys.argv[2]; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import sarc,msbt
PR=os.path.join(S,'port-dl/repo/atmosphere/contents/01006F8002326000/romfs'); VAN=os.path.join(S,'vanilla/update_2228224')
if os.path.exists(OUT): shutil.rmtree(OUT)
n=0
for dp,_,fs in os.walk(PR):
    for f in fs:
        rel=os.path.relpath(os.path.join(dp,f),PR).replace(chr(92),'/')
        if rel.startswith('System/'): continue
        d=os.path.join(OUT,rel); os.makedirs(os.path.dirname(d),exist_ok=True); shutil.copyfile(os.path.join(dp,f),d); n+=1
print('copied',n)
def rd(p): return open(p,'rb').read()
def w(rel,data):
    p=os.path.join(OUT,rel); os.makedirs(os.path.dirname(p),exist_ok=True); open(p,'wb').write(data)
# String_USen
dc=zstandard.ZstdDecompressor(); cc=zstandard.ZstdCompressor(level=19)
def load(p): return rd(p)
Vs=sarc.parse(dc.decompress(load(os.path.join(VAN,'Message/String_USen.sarc.zs')),max_output_size=1<<28))[0]
hraw=dc.decompress(load(os.path.join(PR,'Message/String_USen.sarc.zs')),max_output_size=1<<28); Hs=sarc.parse(hraw)[0]
def hashg(nm,g):
    h=0
    for ch in nm.encode(): h=(h*0x492+ch)&0xffffffff
    return h%g
def lbl_build(order,g):
    groups=[[] for _ in range(g)]
    for nm,i in order: groups[hashg(nm,g)].append((nm,i))
    hdr=struct.pack('<I',g); off=4+8*g; body=b''; ent=[]
    for gr in groups:
        ent.append((len(gr),off+len(body)))
        for nm,i in gr: body+=bytes([len(nm.encode())])+nm.encode()+struct.pack('<I',i)
    return hdr+b''.join(struct.pack('<II',*e) for e in ent)+body
def parse_msg(b):
    S=msbt.sections(b); d={m:x for m,x in S}; return S,msbt.labels(d[b'LBL1']),msbt.texts(d[b'TXT2']),struct.unpack_from('<I',d[b'LBL1'],0)[0]
newent={};restored=0
for f in Hs:
    if f not in Vs: continue
    changed=False
    S_,L,T,g=parse_msg(Hs[f][2]); _,VL,VT,_=parse_msg(Vs[f][2])
    for nm,i in VL.items():
        if nm not in L: L[nm]=len(T); T.append(VT[i]); restored+=1; changed=True
    if changed:
        order=sorted(L.items(),key=lambda x:x[1]); secs=[]
        for m,x in S_:
            if m==b'LBL1': x=lbl_build(order,g)
            elif m==b'TXT2': x=msbt.build_txt2(T)
            elif m==b'ATR1': x=struct.pack('<I',len(T))+x[4:]
            secs.append([m,x])
        newent[f]=msbt.build(Hs[f][2],secs)
nb,al=sarc.replace(hraw,newent); w('Message/String_USen.sarc.zs',cc.compress(nb)); print('String_USen restored labels',restored,'files rebuilt',len(newent),'sarc align',al)
