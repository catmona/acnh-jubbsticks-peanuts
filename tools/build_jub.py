"""Build the merged Jubbsticks-port mod (third mod, order 2). Usage: build_jub.py <workspace> <out romfs dir>
Workspace: port-dl/repo (the port's extracted release), vanilla/update_2228224 (3.0.3 romfs files from your own game), comb-files (ACNH-Combined's copies)."""
import sys,os,shutil,struct,collections,zstandard
S=sys.argv[1]; OUT=sys.argv[2]; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import bcsv,sarc,msbt
PR=os.path.join(S,'port-dl/repo/atmosphere/contents/01006F8002326000/romfs'); VAN=os.path.join(S,'vanilla/update_2228224'); CF=os.path.join(S,'comb-files')
MODELS8={'PltFlwRose','PltFlwPansy','UnitIconPltFruitCoconut','UnitIconPltFruitCherry','UnitIconPltFruitPeach','UnitIconPltFruitApple','UnitIconPltFruitPear','Layout_FtrIcon_Coconut'}
if os.path.exists(OUT): shutil.rmtree(OUT)
n=0
for dp,_,fs in os.walk(PR):
    for f in fs:
        rel=os.path.relpath(os.path.join(dp,f),PR).replace(chr(92),'/')
        if rel.startswith('System/'): continue
        if rel.startswith('Model/') and f.split('.')[0] in MODELS8: continue
        d=os.path.join(OUT,rel); os.makedirs(os.path.dirname(d),exist_ok=True); shutil.copyfile(os.path.join(dp,f),d); n+=1
print('copied',n)
def rd(p): return open(p,'rb').read()
def merge3(name,kf,fix=None):
    vb=rd(os.path.join(VAN,'Bcsv',name)); cb=rd(os.path.join(CF,name)); hb=rd(os.path.join(PR,'Bcsv',name))
    V,C,H=bcsv.parse(vb),bcsv.parse(cb),bcsv.parse(hb)
    idx=lambda t:{bcsv.val(t,r,kf):i for i,r in enumerate(t['rows'][:t['n']])}
    vi,ci,hi=idx(V),idx(C),idx(H); vo,co,ho=dict(V['fields']),dict(C['fields']),dict(H['fields'])
    rows=[bytearray(r) for r in H['rows'][:H['n']]]; take=0
    for k,i in ci.items():
        v,c,hh=V['rows'][vi[k]],C['rows'][i],H['rows'][hi[k]]
        for f in co:
            s=min(V['size'][f],C['size'][f],H['size'][f])
            a,b,d=v[vo[f]:vo[f]+s],c[co[f]:co[f]+s],hh[ho[f]:ho[f]+s]
            if b!=a and d==a: rows[hi[k]][ho[f]:ho[f]+s]=b; take+=1
    if fix:
        for k,i in hi.items(): fix(rows[i],ho,V['rows'][vi[k]] if k in vi else None,vo)
    return hb[:H['ds']]+b''.join(bytes(r) for r in rows)+hb[H['ds']+H['el']*H['n']:],take
def w(rel,data):
    p=os.path.join(OUT,rel); os.makedirs(os.path.dirname(p),exist_ok=True); open(p,'wb').write(data)
KEY=0x54706054
o,t=merge3('ItemParam.bcsv',KEY); w('Bcsv/ItemParam.bcsv',o); print('ItemParam taken',t)
# Stack field 4c9ba961: the port's 254 is kept (its author's stack-to-254 feature; owner's choice, Nov 24)
o,t=merge3('ItemKind.bcsv',KEY); w('Bcsv/ItemKind.bcsv',o); print('ItemKind taken',t)
# Daily: positional match of his rows to vanilla rows, take Combined's bytes
name='EventFlagsLifeSupportDailyParam.bcsv'
V,C,H=[bcsv.parse(rd(os.path.join(p,name))) for p in (os.path.join(VAN,'Bcsv'),CF,os.path.join(PR,'Bcsv'))]
assert V['el']==C['el']==H['el'] and V['fields']==H['fields']
ro=dict(H['fields'])[0x127ccfd9]; rs=H['size'][0x127ccfd9]  # Combined's only edit in this table: reward x2 on every row (checked: 219/219)
rows=[];hit=0;new=0
for r in H['rows'][:H['n']]:
    c=bytearray(r); c[ro:ro+rs]=(int.from_bytes(c[ro:ro+rs],'little')*2).to_bytes(rs,'little'); rows.append(bytes(c)); hit+=1
hb=rd(os.path.join(PR,'Bcsv',name)); w('Bcsv/'+name,hb[:H['ds']]+b''.join(rows)+hb[H['ds']+H['el']*H['n']:]); print('Daily matched',hit,'his-own rows',new)
# String_USen
dc=zstandard.ZstdDecompressor(); cc=zstandard.ZstdCompressor(level=19)
def load(p): return rd(p)
Vs=sarc.parse(dc.decompress(load(os.path.join(VAN,'Message/String_USen.sarc.zs')),max_output_size=1<<28))[0]
Cs=sarc.parse(dc.decompress(load(os.path.join(CF,'String_USen.sarc.zs')),max_output_size=1<<28))[0]
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
newent={};restored=0;renamed=0
for f in Hs:
    if f not in Vs: continue
    changed=False
    S_,L,T,g=parse_msg(Hs[f][2]); _,VL,VT,_=parse_msg(Vs[f][2]); _,CL,CT,_=parse_msg(Cs[f][2])
    for nm,i in VL.items():
        if nm not in L: L[nm]=len(T); T.append(VT[i]); restored+=1; changed=True
    for nm,i in CL.items():
        if nm in VL and CT[i]!=VT[VL[nm]] and nm in L and T[L[nm]]==VT[VL[nm]]: T[L[nm]]=CT[i]; renamed+=1; changed=True
    if changed:
        order=sorted(L.items(),key=lambda x:x[1]); secs=[]
        for m,x in S_:
            if m==b'LBL1': x=lbl_build(order,g)
            elif m==b'TXT2': x=msbt.build_txt2(T)
            elif m==b'ATR1': x=struct.pack('<I',len(T))+x[4:]
            secs.append([m,x])
        newent[f]=msbt.build(Hs[f][2],secs)
nb,al=sarc.replace(hraw,newent); w('Message/String_USen.sarc.zs',cc.compress(nb)); print('String_USen restored labels',restored,'renamed',renamed,'files rebuilt',len(newent),'sarc align',al)
