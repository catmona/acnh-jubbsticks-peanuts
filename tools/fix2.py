"""Patch format 2: fixes applied by meaning (a message label, a table row, a key path), each one checked against the file it
finds, so a fix whose target is unchanged still applies to a later port release and one whose target changed is skipped and named.
docs/app.js (build2) does the same in the browser; this is its Python twin (build_patch.py, the parity check, the release Action).

A fix: {id, title, group, ops, partial?, optional?, default?, verified?, note?}. 'partial': its ops are independent, so the ones that
fit apply even when others don't; otherwise one op that doesn't fit skips the whole fix. 'optional' fixes are checkboxes on the page
('default' is their starting state). Op kinds (JSON lists, first item the kind; files are romfs paths; bytes are base64):
  ["msg", sarc, msbt, label, mode, pre, text, atr]  mode 'add': only when the label is absent (present: nothing to do);
                                                     'set': only when h16(text + ATR1 entry) of the label is pre. atr null: keep / none
  ["cell", file, keycol, key, col, pre, new]        a bcsv field of the row whose keycol (hex hash) holds key
  ["row", file, keycol, key, row]                   add a bcsv row (its whole bytes) unless one with that key is there
  ["byml", file, path, pre, new]                    set a byml value at a key path when the old value equals pre (null: absent)
  ["drop", file]                                    leave the file out
  ["delta", file, pre, parts]                       rebuild a whole file whose h16 is pre: parts are [from, len] copies or b64 inserts
An op's state: 'done' (applied), 'ok' (already as wanted, or nothing to do), 'gone' (its file, msbt or row isn't there), 'diff'
(the target isn't what the fix was made for)."""
import sys,os,struct,hashlib,base64,json,zlib
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import sarc as sarcm,msbt as msbtm,byml,bymlw,yaz0,zstandard
h16=lambda b:hashlib.sha256(b).hexdigest()[:16]
b64=lambda b:base64.b64encode(b).decode(); unb=lambda s:base64.b64decode(s)
TID='01006F8002326000'; RS='System/Resource/ResourceSizeTable.srsizetable'
_dz=zstandard.ZstdDecompressor()
def dz(b): return _dz.decompress(b,max_output_size=1<<30)

def hashg(nm,g):
    h=0
    for ch in nm.encode(): h=(h*0x492+ch)&0xffffffff
    return h%g

class Msg:
    """An msbt that can take label edits; rebuilt only when edited, laid out exactly as docs/app.js msbtEdit does."""
    def __init__(s,b):
        s.b=b; s.secs=msbtm.sections(b); d={bytes(m):x for m,x in s.secs}
        s.g=struct.unpack_from('<I',d[b'LBL1'],0)[0]; s.idx=msbtm.labels(d[b'LBL1']); s.T=msbtm.texts(d[b'TXT2'])
        A=d.get(b'ATR1'); s.A=bytearray(A) if A is not None else None; s.es=struct.unpack_from('<I',A,4)[0] if A else 0
        s.n0=len(s.T); s.new=[]; s.dirty=False
    def atr(s,i):
        if not s.es: return b''
        return bytes(s.A[8+s.es*i:8+s.es*(i+1)]) if i<s.n0 else s.new[i-s.n0]
    def get(s,l):
        i=s.idx.get(l); return None if i is None else (s.T[i],s.atr(i))
    def put(s,l,t,a):   # a None: keep the label's ATR1 entry (or none, for a new label in a file whose entries are 0 bytes)
        i=s.idx.get(l)
        if i is None:
            a=a if a is not None else b''
            if len(a)!=s.es: raise ValueError('attribute size for '+l)
            if a and len(s.A)!=8+s.es*s.n0: raise ValueError('ATR1 has a string pool; not handled')
            s.idx[l]=len(s.T); s.T.append(t); s.new.append(a)
        else:
            s.T[i]=t
            if a is not None and s.es:
                if i<s.n0: s.A[8+s.es*i:8+s.es*(i+1)]=a
                else: s.new[i-s.n0]=a
        s.dirty=True
    def build(s):
        order=sorted(s.idx.items(),key=lambda x:x[1]); groups=[[] for _ in range(s.g)]
        for nm,i in order: groups[hashg(nm,s.g)].append((nm,i))
        head=struct.pack('<I',s.g); off=4+8*s.g; body=b''; ent=b''
        for gr in groups:
            ent+=struct.pack('<II',len(gr),off+len(body))
            for nm,i in gr: body+=bytes([len(nm.encode())])+nm.encode()+struct.pack('<I',i)
        secs=[]
        for m,x in s.secs:
            if m==b'LBL1': x=head+ent+body
            elif m==b'TXT2': x=msbtm.build_txt2(s.T)
            elif m==b'ATR1': x=struct.pack('<I',len(s.T))+bytes(s.A[4:])+b''.join(s.new)
            secs.append([m,x])
        return msbtm.build(s.b,secs)

class Sarc:
    def __init__(s,raw): s.raw=dz(raw); s.P=sarcm.parse(s.raw)[0]; s.M={}
    def msg(s,name):
        if name not in s.M:
            if name not in s.P: return None
            s.M[name]=Msg(s.P[name][2])
        return s.M[name]
    def build(s):
        new={k:m.build() for k,m in s.M.items() if m.dirty}
        return sarcm.replace(s.raw,new)[0] if new else None

class Tab:
    """A bcsv: header, then fixed-size rows to the end of the file; the row count is the first u32."""
    def __init__(s,b):
        s.b=b; n,s.el,fc=struct.unpack_from('<IIH',b,0); hdr=0x1c if b[0xc:0x10]==b'VSCB' else 0x0c
        s.F={'%08x'%h:o for h,o in (struct.unpack_from('<II',b,hdr+8*i) for i in range(fc))}
        offs=sorted(s.F.values())+[s.el]; s.size={c:offs[offs.index(o)+1]-o for c,o in s.F.items()}
        s.ds=hdr+8*fc; assert s.ds+s.el*n==len(b),'bcsv with a tail'
        s.rows=[bytearray(b[s.ds+s.el*r:s.ds+s.el*(r+1)]) for r in range(n)]; s.dirty=False
    def key(s,r,c):
        o=s.F[c]; z=s.size[c]; return int.from_bytes(r[o:o+min(z,4)],'little')
    def find(s,c,k):
        for i,r in enumerate(s.rows):
            if s.key(r,c)==k: return i
        return None
    def field(s,i,c): o=s.F[c]; return bytes(s.rows[i][o:o+s.size[c]])
    def setf(s,i,c,v): o=s.F[c]; s.rows[i][o:o+s.size[c]]=v; s.dirty=True
    def insert(s,c,k,row):   # at its sorted place when the table is sorted by that key, else at the end
        ks=[s.key(r,c) for r in s.rows]
        at=len(ks)
        if all(ks[i]<=ks[i+1] for i in range(len(ks)-1)): at=next((i for i,x in enumerate(ks) if x>k),len(ks))
        s.rows.insert(at,bytearray(row)); s.dirty=True
    def build(s): return struct.pack('<I',len(s.rows))+s.b[4:s.ds]+b''.join(bytes(r) for r in s.rows)

def zs_size(b):
    """Decompressed size of a zstd file: the frame header's content size when it has one, else by decompressing."""
    if b[:4]==b'\x28\xb5\x2f\xfd':
        fhd=b[4]; fcs=fhd>>6; single=(fhd>>5)&1; did=[0,1,2,4][fhd&3]; o=5+(0 if single else 1)+did
        n=[1 if single else 0,2,4,8][fcs]
        if n:
            v=int.from_bytes(b[o:o+n],'little')+(256 if n==2 else 0)
            # a single frame only: the frame must end the file (checked cheaply by decompressing when in doubt is too slow; trust it)
            return v
    return len(dz(b))
def dec_size(rel,b):
    if rel.endswith('.zs'): return zs_size(b)
    if b[:4]==b'Yaz0': return struct.unpack_from('>I',b,4)[0]
    return len(b)

def rstc(b):   # (version, {crc: [crc, size, x]}, tail) of a decompressed RSTC table
    assert b[:4]==b'RSTC'; n,v=struct.unpack_from('<II',b,4); E={}
    for i in range(n): e=list(struct.unpack_from('<III',b,12+12*i)); E[e[0]]=e
    return v,E,b[12+12*n:]
def rstc_build(v,E,tail): return b'RSTC'+struct.pack('<II',len(E),v)+b''.join(struct.pack('<III',*E[k]) for k in sorted(E))+tail
def size_table(base,port_table,out):
    """build_rstb.py's rule over every file that goes out: raise its entry to fit, or take the port's own entry for files 3.0.3 lacks."""
    v,T,tail=rstc(base); P=rstc(port_table)[1] if port_table else {}; up=lambda n:(n+31)//32*32
    for rel in sorted(out):
        if rel==RS: continue
        dec=dec_size(rel,out[rel]); name=rel[:-3] if rel.endswith('.zs') else rel; k=zlib.crc32(name.encode())
        if k in T:
            old=T[k][1]; model='.Nin_NX_NVN' in rel
            T[k][1]=max(old,up(dec)+old) if (model and old-dec<16384) else (old if model else max(old,up(dec)+1024))
        elif k in P: T[k]=list(P[k])
    return rstc_build(v,T,tail)

def census(files): return {r:h16(b) for r,b in files.items()}
def release(patch,files):
    """The release the files are, or the closest one and how far off it is."""
    C=census(files); best=None
    for name,R in patch['releases'].items():
        same=sum(1 for r,h in R.items() if C.get(r)==h); score=(same,-abs(len(C)-len(R)))
        if best is None or score>best[0]: best=(score,name,R)
    _,name,R=best
    changed=sorted(r for r in R if r in C and C[r]!=R[r]); gone=sorted(r for r in R if r not in C); new=sorted(r for r in C if r not in R)
    return {'name':name,'exact':not(changed or gone or new),'changed':changed,'gone':gone,'new':new}

class State:
    def __init__(s,files): s.files=files; s.S={}; s.B={}; s.Y={}; s.drop=set(); s.repl={}
    def has(s,r): return r in s.files and r not in s.drop
    def sarc(s,r):
        if r not in s.S: s.S[r]=Sarc(s.files[r]) if s.has(r) else None
        return s.S[r]
    def tab(s,r):
        if r not in s.B: s.B[r]=Tab(s.files[r]) if s.has(r) else None
        return s.B[r]
    def yml(s,r):
        if r not in s.Y: s.Y[r]=[byml.load(s.files[r]),False] if s.has(r) else None
        return s.Y[r]

def _path(root,path):
    x=root
    for k in path[:-1]:
        if not isinstance(x,dict) or k not in x: return None,None
        x=x[k]
    return (x,path[-1]) if isinstance(x,dict) else (None,None)

def check(st,op):
    """('done'|'ok'|'gone'|'diff', why, apply-function or None)."""
    k=op[0]
    if k=='msg':
        _,f,m,l,mode,pre,t,a=op; S=st.sarc(f)
        if S is None: return 'gone',f,None
        M=S.msg(m)
        if M is None: return 'gone',f+':'+m,None
        t=unb(t); a=unb(a) if a is not None else None; cur=M.get(l)
        if mode=='add':
            if cur is not None: return 'ok','',None
            return 'done','',lambda:M.put(l,t,a)
        if cur is None: return 'gone',m+':'+l,None
        if cur[0]==t and (a is None or cur[1]==a): return 'ok','',None
        if h16(cur[0]+cur[1])!=pre: return 'diff',m+':'+l,None
        return 'done','',lambda:M.put(l,t,a)
    if k in ('cell','row'):
        f=op[1]; T=st.tab(f)
        if T is None: return 'gone',f,None
        kc,key=op[2],op[3]
        if kc not in T.F: return 'diff',f+' has no column '+kc,None
        i=T.find(kc,key)
        if k=='row':
            row=unb(op[4])
            if i is not None: return ('ok','',None) if bytes(T.rows[i])==row else ('diff','%s row %d'%(f,key),None)
            if len(row)!=T.el: return 'diff',f+' row size',None
            return 'done','',lambda:T.insert(kc,key,row)
        c,pre,new=op[4],unb(op[5]),unb(op[6])
        if i is None: return 'gone','%s row %d'%(f,key),None
        if c not in T.F or T.size[c]!=len(new): return 'diff',f+' column '+c,None
        cur=T.field(i,c)
        if cur==new: return 'ok','',None
        if cur!=pre: return 'diff','%s row %d %s'%(f,key,c),None
        return 'done','',lambda:T.setf(i,c,new)
    if k=='byml':
        _,f,path,pre,new=op; Y=st.yml(f)
        if Y is None: return 'gone',f,None
        d,last=_path(Y[0],path)
        if d is None: return 'gone',f+':'+'/'.join(path),None
        cur=d.get(last)
        if cur==new: return 'ok','',None
        if cur!=pre: return 'diff',f+':'+'/'.join(path),None
        def ap(): d[last]=new; Y[1]=True
        return 'done','',ap
    if k=='drop':
        f=op[1]
        if not st.has(f): return 'ok','',None
        return 'done','',lambda:st.drop.add(f)
    if k=='delta':
        _,f,pre,parts=op
        if not st.has(f): return 'gone',f,None
        cur=st.repl.get(f,st.files[f])
        if h16(cur)!=pre: return 'diff',f,None
        def ap():
            o=bytearray()
            for p in parts: o+=unb(p) if isinstance(p,str) else cur[p[0]:p[0]+p[1]]
            st.repl[f]=bytes(o)
        return 'done','',ap
    raise ValueError('unknown op '+k)

def apply(patch,files,on=None,memfix=True,others=()):
    """files: {romfs path: bytes} of the port's download. on: ids of the optional fixes to apply (None: their defaults).
    Returns (out files, report). The report lists every fix with its state and, for one that didn't fit, why."""
    assert patch['format']==2 and patch['tid']==TID
    st=State(files); rep=[]
    for fx in patch['fixes']:
        want=fx.get('default',True) if (on is None or not fx.get('optional')) else fx['id'] in on
        if not want: rep.append({'id':fx['id'],'state':'off'}); continue
        res=[check(st,op) for op in fx['ops']]
        bad=[(s,w) for s,w,_ in res if s in ('gone','diff')]; todo=[a for s,_,a in res if s=='done']
        if bad and (not fx.get('partial') or len(bad)==len(res)): state='skipped'; todo=[]
        else: state='partial' if bad else ('applied' if todo else 'already')
        for a in todo: a()
        rep.append({'id':fx['id'],'state':state,'done':len(todo),'ops':len(fx['ops']),'why':sorted({w for _,w in bad})[:8],'nbad':len(bad)})
    out={}
    gate=set() if memfix else set(patch.get('with_fix',[]))
    for r,b in files.items():
        if r in st.drop or r in gate or r==RS: continue
        out[r]=st.repl.get(r,b)
    for r,S in st.S.items():
        if S is None or r not in out: continue
        nb=S.build()
        if nb is not None: out[r]=zstandard.ZstdCompressor(level=3).compress(nb)
    for r,T in st.B.items():
        if T is not None and T.dirty and r in out: out[r]=T.build()
    for r,Y in st.Y.items():
        if Y is not None and Y[1] and r in out: out[r]=bymlw.dump(Y[0])
    base=zlib.decompress(base64.b64decode(patch['rstb']['data']),-15)
    base=b'RSTC'+struct.pack('<I',patch['rstb']['count'])+base
    assert hashlib.sha256(base).hexdigest()==patch['rstb']['content_sha256']
    pt=yaz0.dec(files[RS]) if RS in files else None
    tab=size_table(base,pt,out)
    for o in others:
        v,T,tail=rstc(tab); ov,OE,_=rstc(o); assert ov==v
        for k,e in OE.items():
            if k not in T: T[k]=list(e)
            elif e[1]>T[k][1]: T[k][1]=e[1]
        tab=rstc_build(v,T,tail)
    out[RS]=tab   # decompressed; callers compress it (yaz0.enc_raw) when writing a mod
    return out,rep
