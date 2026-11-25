"""Make the format-2 fixes (tools/fix2.py says what an op is) from the port's release, vanilla 3.0.3 and Jubbsticks 1.0.11.
Usage: make_fixes.py <port romfs> <vanilla 3.0.3 files> <vanilla 1.0.0 files> <Jubbsticks 1.0.11 romfs> <out fixes.json>
The fixes hold label texts, table rows and key paths only; nobody's whole files.
- Message text: the 3.0.3 labels the port's msbts lack; the labels the port's message tool broke (no end mark, or a tag cut off with
  the text after it); and the 1.0.11 labels the port lost (Jubbsticks' own lines and names, so the game shows empty boxes).
  A broken label with no good 1.0.11 or 3.0.3 copy takes its text plus an end mark, or (EUen) the port's own USen line.
- EventFlow/Info: 3.0.3's values of the index entries the port's 2.x-era copy changed (that copy hangs the load).
- Items: recipes 1226/1227 back to the woodland pieces, names for the port's unnamed items, 3.0.3's Nook Inc. balloon name, the
  field objects of 1.0.11's new flower colours.
- The workbench: 3.0.3's own flow and labels instead of the port's 1.0.11 copy (optional, on by default).
- The Roost: leave its 9 files out (optional)."""
import sys,os,re,json,struct,collections
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import fix2,byml
from fix2 import h16,b64,dz,unb
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

# Items. Recipes 1226 and 1227 made the woodland arch and shrub (883, 884) in 1.0.11; 3.0 gave those ids to the souvenir bags and
# the port moved the two pieces to 881 and 886 without moving the recipes.
RC='Bcsv/RecipeCraftParam.bcsv'; Rt=fix2.Tab(rd(os.path.join(PR,RC))); u16=lambda v:struct.pack('<H',v)
assert (PI[881],PI[886],JI[883],JI[884])==(b'FtrWoodlandArch',b'FtrWoodlandShrub',b'FtrWoodlandArch',b'FtrWoodlandShrub')
fix('recipes-woodland',"Recipes 1226 and 1227 make the woodland arch and shrub again (not the souvenir bags)",'items',
    [['cell',RC,'54706054',r,'89a3482c',b64(u16(a)),b64(u16(b))] for r,a,b in ((1226,883,881),(1227,884,886))
     if Rt.field(Rt.find('54706054',r),'89a3482c')==u16(a)],verified='data')

# Item names: the woodland pieces at their new ids, the petaltail dragonfly at its new id (1.0.11's 1030), and the fish and insect
# models, named the way 3.0.3 names its own ("saw stag model" next to "saw stag"); and 3.0.3's name for its Nook Inc. balloon,
# which the port left reading "green leaf balloon" (1.0.11's item 14540, gone in 3.0).
def kinds(root):
    t=fix2.Tab(rd(os.path.join(root,'Bcsv/ItemParam.bcsv'))); o=t.F['fc275e86']; z=t.size['fc275e86']
    return {t.key(r,'54706054'):bytes(r[o:o+z]).split(b'\0')[0] for r in t.rows}
PK=kinds(PR); BYNAME={v:k for k,v in PI.items()}
NAMEMSG={b'Kind_Fish':('STR_ItemName_31_Fish','Fish'),b'Kind_Insect':('STR_ItemName_30_Insect','Insect'),
         b'Kind_FishToy':('STR_ItemName_37_FishToy','FishToy'),b'Kind_InsectToy':('STR_ItemName_36_InsectToy','InsectToy')}
for lang in ('USen','EUen'):
    sar='Message/String_%s.sarc.zs'%lang; P,Pes=msgs(os.path.join(PR,sar)); V=msgs(os.path.join(VAN,sar))[0]; JJ=msgs(os.path.join(J,sar))[0]
    named=lambda i:any(re.match(r'^[A-Za-z]+_%05d$'%i,l) for m in P if m.startswith('Item/STR_ItemName') for l in P[m])
    ops=[]; F00='Item/STR_ItemName_00_Ftr.msbt'
    def add(m,l,t): assert not Pes['Item/'+m+'.msbt']; ops.append(['msg',sar,'Item/'+m+'.msbt',l,'add','',b64(t),None])
    for new,old in ((881,883),(886,884)):
        if not named(new): add('STR_ItemName_00_Ftr','Ftr_%05d'%new,P[F00]['Ftr_%05d'%old][0])
    jp=JJ['Item/STR_ItemName_30_Insect.msbt'].get('Insect_01030')
    if JI.get(1030)==PI.get(1028)==b'FtrInsectPetal' and jp and not named(1028): add('STR_ItemName_30_Insect','Insect_01028',jp[0])
    base={}
    for m,(bm,pre) in NAMEMSG.items():
        for src in (JJ,P):   # the port's names, and the 1.0.11 names lost111 puts back for ids that are the same item
            for l,(t,a) in src.get('Item/'+bm+'.msbt',{}).items():
                mm=re.match(r'^[A-Za-z]+_(\d{5})$',l); i=mm and int(mm.group(1))
                if mm and (src is P or PI.get(i)==JI.get(i)): base[(pre,i)]=t
    for o in ops: base[(o[3].split('_')[0],int(o[3].split('_')[1]))]=unb(o[6])
    for i in sorted(PI):
        k=PK[i]
        if k not in (b'Kind_FishToy',b'Kind_InsectToy') or named(i) or not PI[i].endswith(b'Toy'): continue
        b=BYNAME.get(PI[i][:-3]); bt=base.get(('Fish' if k==b'Kind_FishToy' else 'Insect',b)) if b is not None else None
        if not bt: counts['model with no named critter']+=1; continue
        bm,pre=NAMEMSG[k]; add(bm,'%s_%05d'%(pre,i),bt[:-2]+' model'.encode('utf-16le')+b'\0\0')
    fix('names-'+lang,"Names for the port's items that show none ("+lang+"): woodland arch and shrub, petaltail dragonfly, the fish and insect models",
        'items',ops,partial=True,verified='data')
    E='Item/STR_ItemName_80_Etc.msbt'; t,a=P[E]['Balloon_14540']; vt=V[E]['Balloon_14540'][0]
    if PI[14540]==b'ToolBalloonNook' and t!=vt:
        fix('balloon-'+lang,"3.0.3's name for its Nook Inc. balloon, which the port left as 'green leaf balloon' ("+lang+")",'items',
            [['msg',sar,E,'Balloon_14540','set',h16(t+a),b64(vt),None]],verified='data')

# Field objects of 1.0.11's new flowers (pink and coral pansies, blue tulips, black hyacinths, yellow anemones, fuchsia lilies, blue
# cosmos): the port dropped these 21 FgMainParam rows but kept the items, so planting one has nothing to place. Same row layout,
# same item ids and the same pansy model as 1.0.11; none of the keys is a 3.0.3 one.
FG='Bcsv/FgMainParam.bcsv'; Pf,Jf,Vf=(fix2.Tab(rd(os.path.join(x,FG))) for x in (PR,J,VAN))
assert Pf.F==Jf.F and Pf.el==Jf.el
pk={Pf.key(r,'54706054') for r in Pf.rows}; vk={Vf.key(r,'54706054') for r in Vf.rows}
lost=[r for r in Jf.rows if Jf.key(r,'54706054') not in pk and Jf.key(r,'54706054') not in vk]
fix('flowers-field',"Field objects for 1.0.11's new flower colours, so planting a pink or coral pansy (and the others) places a flower",'items',
    [['row',FG,'54706054',Jf.key(r,'54706054'),b64(bytes(r))] for r in sorted(lost,key=lambda r:Jf.key(r,'54706054'))],partial=True,verified='data')
counts['flower rows']=len(lost)

# The workbench: the port's Ftr_Working is 1.0.11's file byte for byte, whose only change was crafting bait in bulk, which 3.0 does
# itself. Leaving it out lets the game use its own 3.0.3 flow (crafting several at once, materials from storage, the hotel's
# tutorial), and 3.0.3 reuses 4 of the workbench labels for its phone cases, so those take 3.0.3's text back.
WF='EventFlow/Ftr_Working.bfevfl'; ops=[['drop',WF]]
assert rd(os.path.join(PR,WF))==rd(os.path.join(J,WF)) and os.path.exists(os.path.join(VAN,WF))
for lang in ('USen','EUen'):
    sar='Message/TalkFtr_%s.sarc.zs'%lang; P=msgs(os.path.join(PR,sar))[0]; V=msgs(os.path.join(VAN,sar))[0]; W='FTR_WorkingTable.msbt'
    for l in ('023','024','024_a','024_b'):
        t,a=P[W][l]; vt,va=V[W][l]
        if (t,a)!=(vt,va): ops.append(['msg',sar,W,l,'set',h16(t+a),b64(vt),b64(va)])
fix('workbench-303',"3.0.3's workbench: craft several at once and use materials from storage (untick for the port's 1.0.11 workbench)",'flows',
    ops,optional=True,default=True,verified='none')

ROOST=['Model/IdrMuseumCafe00.Nin_NX_NVN.zs','Param/Field/StagePreset/IdrMuseumCafe.byml']+sorted(
    'Model/'+x for x in os.listdir(os.path.join(PR,'Model')) if x.startswith('IdrMuseumCafe00_Tex_'))
assert all(os.path.exists(os.path.join(PR,r)) for r in ROOST) and len(ROOST)==9,ROOST
fix('no-roost',"Leave out the Roost's room (try this if the game crashes as the Roost loads)",'optional',[['drop',r] for r in ROOST],
    optional=True,default=False,verified='none')

json.dump(fixes,open(DST,'w'),indent=0,separators=(',',':'))
for k,v in counts.items(): print(k,v)
print(len(fixes),'fixes,',sum(len(f['ops']) for f in fixes),'ops')
