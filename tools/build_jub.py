"""Build the standalone Peanuts romfs of the Jubbsticks port. Usage: build_jub.py <workspace> <out romfs dir> [--no-icons]
--no-icons leaves out the 25 Model/UnitIcon* models (they crash ACNH 3.0.3 at the title unless the memory fix is installed; PORT.md).
Workspace: port-dl/repo (the port's extracted release), vanilla/update_2228224 (3.0.3 romfs files from your own game).
Item tables are the port's as is; the Message sarcs get back the vanilla 3.0.3 labels the port's copies lack. The size table is build_rstb.py's job."""
import sys,os,shutil,struct,collections,zstandard
S=sys.argv[1]; OUT=sys.argv[2]; NOICONS='--no-icons' in sys.argv[3:]; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import sarc,msbt
PR=os.path.join(S,'port-dl/repo/atmosphere/contents/01006F8002326000/romfs'); VAN=os.path.join(S,'vanilla/update_2228224')
if os.path.exists(OUT): shutil.rmtree(OUT)
n=0
for dp,_,fs in os.walk(PR):
    for f in fs:
        rel=os.path.relpath(os.path.join(dp,f),PR).replace(chr(92),'/')
        if rel.startswith('System/'): continue
        if NOICONS and rel.startswith('Model/UnitIcon'): continue   # without the memory fix they crash ACNH 3.0.3 at the title (PORT.md)
        d=os.path.join(OUT,rel); os.makedirs(os.path.dirname(d),exist_ok=True); shutil.copyfile(os.path.join(dp,f),d); n+=1
print('copied',n)
def rd(p): return open(p,'rb').read()
def w(rel,data):
    p=os.path.join(OUT,rel); os.makedirs(os.path.dirname(p),exist_ok=True); open(p,'wb').write(data)
# Message sarcs: each msbt gets back the vanilla 3.0.3 labels the port's copy lacks (String: 79 item names, TalkSNpc: 1 line).
# There is no vanilla EUen here, so the EUen sarcs get the USen text; the label sets of the two are the same in the port and in 3.0.3.
dc=zstandard.ZstdDecompressor(); cc=zstandard.ZstdCompressor(level=19)
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
    S=msbt.sections(b); d={m:x for m,x in S}; return S,msbt.labels(d[b'LBL1']),msbt.texts(d[b'TXT2']),struct.unpack_from('<I',d[b'LBL1'],0)[0],d.get(b'ATR1')
def attr(a,i):   # one label's ATR1 entry (empty when the file's entries are 0 bytes)
    es=struct.unpack_from('<I',a,4)[0] if a else 0; return a[8+es*i:8+es*(i+1)] if es else b''
for f in sorted(os.listdir(os.path.join(PR,'Message'))):
    vp=os.path.join(VAN,'Message',f.replace('_EUen','_USen'))
    if not f.endswith('.sarc.zs') or not os.path.exists(vp): continue
    Vs=sarc.parse(dc.decompress(rd(vp),max_output_size=1<<30))[0]
    hraw=dc.decompress(rd(os.path.join(PR,'Message',f)),max_output_size=1<<30); Hs=sarc.parse(hraw)[0]
    newent={};restored=0
    for k in Hs:
        if k not in Vs or not k.endswith('.msbt'): continue
        S_,L,T,g,A=parse_msg(Hs[k][2]); _,VL,VT,_,VA=parse_msg(Vs[k][2]); add=[]
        for nm,i in VL.items():
            if nm not in L: L[nm]=len(T); T.append(VT[i]); add.append(attr(VA,i)); restored+=1
        if not add: continue
        assert A is None or struct.unpack_from('<I',A,0)[0]*struct.unpack_from('<I',A,4)[0]+8==len(A), (f,k,'ATR1 has a string pool')
        order=sorted(L.items(),key=lambda x:x[1]); secs=[]
        for m,x in S_:
            if m==b'LBL1': x=lbl_build(order,g)
            elif m==b'TXT2': x=msbt.build_txt2(T)
            elif m==b'ATR1': x=struct.pack('<I',len(T))+x[4:]+b''.join(add)
            secs.append([m,x])
        newent[k]=msbt.build(Hs[k][2],secs)
    if newent:
        nb,al=sarc.replace(hraw,newent); w('Message/'+f,cc.compress(nb)); print(f,'restored labels',restored,'files rebuilt',len(newent),'sarc align',al)
