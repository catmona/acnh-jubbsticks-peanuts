"""Make the format-2 fixes (tools/fix2.py says what an op is) from the port's release, vanilla 3.0.3 and Jubbsticks 1.0.11.
Usage: make_fixes.py <port romfs> <vanilla 3.0.3 files> <vanilla 1.0.0 files> <Jubbsticks 1.0.11 romfs> <out fixes.json>
The fixes hold label texts, table rows and key paths only; nobody's whole files.
- Message text: the 3.0.3 labels the port's msbts lack; the labels the port's message tool broke (no end mark, or a tag cut off with
  the text after it); and the 1.0.11 labels the port lost (Jubbsticks' own lines and names, so the game shows empty boxes).
  A broken label with no good 1.0.11 or 3.0.3 copy takes its text plus an end mark, or (EUen) the port's own USen line.
- EventFlow/Info: 3.0.3's values of the index entries the port's 2.x-era copy changed (that copy hangs the load).
- The Roost: leave its 9 files out (optional)."""
import sys,os,re,json,struct,collections
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import fix2,byml
from fix2 import h16,b64,dz
import sarc as sarcm,msbt as msbtm
PR,VAN,V0,J,DST=sys.argv[1:6]
rd=lambda p:open(p,'rb').read()
def msgs(p):   # {msbt: {label: (text, atr)}} and {msbt: es} of a Message sarc
    if not os.path.exists(p): return {},{}
    P=sarcm.parse(dz(rd(p)))[0]; out={}; es={}
    for k,(h,a,b) in P.items():
        if not k.endswith('.msbt'): continue
        M=fix2.Msg(b); out[k]={l:M.get(l) for l in M.idx}; es[k]=M.es
    return out,es
def tags(raw):
    i=0; out=[]
    while i+1<len(raw):
        c=int.from_bytes(raw[i:i+2],'little')
        if c==0x0E:
            if i+8>len(raw): out.append((-1,-1,0)); break   # a tag cut off mid-header
            g,t,n=struct.unpack_from('<HHH',raw,i+2); out.append((g,t,n)); i+=8+n; continue
        if c==0x0F: i+=6; continue
        i+=2
    return out
def ended(t): return len(t)%2==0 and t.endswith(b'\0\0')
fixes=[]
def fix(id,title,group,ops,**k):
    if ops: fixes.append(dict(id=id,title=title,group=group,ops=ops,**k))

# Tag signatures vanilla uses; a 0-parameter tag of a kind vanilla only uses with parameters is one the port's tool cut off
vsig=set()
for f in sorted(os.listdir(os.path.join(VAN,'Message'))):
    if f.endswith('.sarc.zs'):
        for m,L in msgs(os.path.join(VAN,'Message',f))[0].items():
            for t,a in L.values(): vsig.update(tags(t))
vgt0={(g,t) for g,t,n in vsig if n==0}
def broken(t): return not ended(t) or any(n==0 and (g,tt) not in vgt0 for g,tt,n in tags(t))

# ItemParam: an item-name label's id means the same item in the port as in 1.0.11 when the resource name matches
def items(root):
    T=fix2.Tab(rd(os.path.join(root,'Bcsv/ItemParam.bcsv'))); o=T.F['3febc642']; z=T.size['3febc642']
    return {T.key(r,'54706054'):bytes(r[o:o+z]).split(b'\0')[0] for r in T.rows}
PI,JI=items(PR),items(J)
ITEM=re.compile(r'^[A-Za-z]+_(\d{5})(_pl)?$')

def common(a,b):
    n=0
    while n<min(len(a),len(b)) and a[n]==b[n]: n+=1
    return n
counts=collections.Counter()
for f in sorted(os.listdir(os.path.join(PR,'Message'))):
    if not f.endswith('.sarc.zs'): continue
    sar='Message/'+f; P,Pes=msgs(os.path.join(PR,sar)); V,Ves=msgs(os.path.join(VAN,sar)); JJ,Jes=msgs(os.path.join(J,sar)); Z=msgs(os.path.join(V0,sar))[0]
    O=msgs(os.path.join(PR,sar.replace('EUen','USen')))[0] if 'EUen' in f else {}   # EUen's last resort: the port's own USen line
    add303=[]; fixb=[]; add111=[]
    for m,L in P.items():
        v=V.get(m,{}); j=JJ.get(m,{}); z=Z.get(m,{})
        for l in sorted(v):   # 3.0.3 labels the port's copy lacks
            if l not in L: add303.append(['msg',sar,m,l,'add','',b64(v[l][0]),b64(v[l][1]) if Pes[m] else None])
        for l in sorted(L):   # labels the port's tool broke
            t,a=L[l]
            if not broken(t): continue
            cand=[x for x in (j.get(l),v.get(l)) if x and not broken(x[0])]
            if cand:
                best=max(cand,key=lambda x:(common(x[0],t),x is v.get(l)))
                new=best[0]
            elif not ended(t) and not broken(t+b'\0\0'): new=t+b'\0\0'
            elif O.get(m,{}).get(l) and not broken(O[m][l][0]): new=O[m][l][0]
            else: counts['broken, nothing to restore from']+=1; continue
            fixb.append(['msg',sar,m,l,'set',h16(t+a),b64(new),None])
        for l in sorted(j):   # 1.0.11 labels the port lost (not in 3.0.3 either)
            if l in L or l in v: continue
            if l in z: counts['1.0.0 label that 3.0.3 dropped']+=1; continue   # Nintendo's, not Jubbsticks'
            t,a=j[l]
            if broken(t): continue
            mm=ITEM.match(l) if m.startswith('Item/STR_ItemName') else None
            if mm:
                i=int(mm.group(1))
                if i not in PI or PI.get(i)!=JI.get(i): counts['1.0.11 item name for an id the port uses otherwise']+=1; continue
            if Pes[m] and len(a)!=Pes[m]:
                if a: counts['1.0.11 label with another ATR1 size']+=1; continue
                a=bytes(Pes[m])   # 1.0.11's copy had no ATR1 entries; 3.0.3's are 0 for plain lines
            add111.append(['msg',sar,m,l,'add','',b64(t),b64(a) if Pes[m] else None])
    name=f[:-len('.sarc.zs')]
    fix('v303-'+name,"3.0.3 text the port's "+name+" lacks",'text',add303,partial=True,verified='data')
    fix('broken-'+name,"Text the port's message tool cut short in "+name,'text',fixb,partial=True,verified='data')
    fix('lost111-'+name,"Jubbsticks' 1.0.11 text the port lost from "+name,'text',add111,partial=True,verified='data')
    counts[name]=(len(add303),len(fixb),len(add111))

# EventFlow index: 3.0.3's values of the entries the port's 2.x-era copy changed (add_eventflow.py's revert, as key-path ops)
E='EventFlow/Info/EventFlowInfoProduct.byml'; Pb=byml.load(rd(os.path.join(PR,E))); Vb=byml.load(rd(os.path.join(VAN,E))); ops=[]
for k in sorted(Vb):
    if not isinstance(Vb[k],dict) or Vb[k]==Pb.get(k): continue
    for x in sorted(Vb[k]):
        if Vb[k][x]!=Pb[k].get(x): ops.append(['byml',E,[k,x],Pb[k].get(x),Vb[k][x]])
for k in sorted(Pb):
    for x,y in sorted(Pb[k].items()) if isinstance(Pb[k],dict) else ():
        if y=='' and x not in Vb.get(k,{}): ops.append(['byml',E,[k,x],'',[]])
fix('flow-index',"3.0.3's event index entries (the port's 2.x-era copy hangs the island load)",'flows',ops,partial=True,verified='game')

ROOST=['Model/IdrMuseumCafe00.Nin_NX_NVN.zs','Param/Field/StagePreset/IdrMuseumCafe.byml']+sorted(
    'Model/'+x for x in os.listdir(os.path.join(PR,'Model')) if x.startswith('IdrMuseumCafe00_Tex_'))
assert all(os.path.exists(os.path.join(PR,r)) for r in ROOST) and len(ROOST)==9,ROOST
fix('no-roost',"Leave out the Roost's room (try this if the game crashes as the Roost loads)",'optional',[['drop',r] for r in ROOST],
    optional=True,default=False,verified='none')

json.dump(fixes,open(DST,'w'),indent=0,separators=(',',':'))
for k,v in counts.items(): print(k,v)
print(len(fixes),'fixes,',sum(len(f['ops']) for f in fixes),'ops')
