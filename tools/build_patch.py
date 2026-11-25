"""Make jub-port-patch.json from the merged build. Usage: build_patch.py <his romfs dir> <merged romfs dir> <out.json>
The patch holds only byte edits, text snippets and the size table; none of his files.
'strings' is String_USen; 'messages' the other Message sarcs that change (same shape; an added label may carry its ATR1 entry).
'with_fix': the port's Model/UnitIcon* models. The page ships them only with the memory fix (they crash 3.0.3 at the title without it)."""
import sys,os,json,base64,hashlib,zlib,struct,zstandard
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import sarc,msbt,yaz0,parse
IN,OUT,dst=sys.argv[1:4]; b64=lambda b:base64.b64encode(b).decode(); sha=lambda b:hashlib.sha256(b).hexdigest()
def walk(R):
    return {os.path.relpath(os.path.join(dp,f),R).replace(os.sep,'/') for dp,_,fs in os.walk(R) for f in fs}
A,B=walk(IN),walk(OUT); rd=lambda R,r:open(os.path.join(R,r),'rb').read()
assert not (B-A-{'System/Resource/ResourceSizeTable.srsizetable'}),B-A
P={'format':1,'tid':'01006F8002326000','release':'UJAP-V0.0.2'}
P['drop']=sorted(A-B); P['with_fix']=sorted(r for r in B if r.startswith('Model/UnitIcon')); changed=sorted(r for r in A&B if rd(IN,r)!=rd(OUT,r))
P['bcsv']={}
for r in changed:
    if not r.endswith('.bcsv'): continue
    a,b=rd(IN,r),rd(OUT,r); assert len(a)==len(b); ed=[]; i=0
    while i<len(a):
        if a[i]!=b[i]:
            j=i
            while j<len(a) and (a[j]!=b[j] or (j+1<len(a) and a[j+1]!=b[j+1])): j+=1
            ed.append([i,b64(b[i:j])]); i=j
        else: i+=1
    P['bcsv'][r]={'in_sha256':sha(a),'out_sha256':sha(b),'edits':ed}
dz=zstandard.ZstdDecompressor()
def msg(e):
    d={m:x for m,x in msbt.sections(e)}; L=msbt.labels(d[b'LBL1']); T=msbt.texts(d[b'TXT2']); A=d.get(b'ATR1'); es=struct.unpack_from('<I',A,4)[0] if A else 0
    return {k:(T[i],A[8+es*i:8+es*(i+1)] if es else b'') for k,i in sorted(L.items(),key=lambda x:x[1])}  # index order
def sarcdiff(r):   # the msbt edits that turn his sarc into ours: labels added (text, ATR1 entry when the file has them), texts set
    ha=dz.decompress(rd(IN,r),max_output_size=1<<30); hb=dz.decompress(rd(OUT,r),max_output_size=1<<30)
    Ha,_,_=sarc.parse(ha); Hb,_,_=sarc.parse(hb); S={}
    assert list(Ha)==list(Hb),r
    for f in Ha:
        if Ha[f][2]==Hb[f][2]: continue
        a,b=msg(Ha[f][2]),msg(Hb[f][2]); assert not [k for k in a if k not in b]
        S[f]={'add':[[k,b64(b[k][0])]+([b64(b[k][1])] if b[k][1] else []) for k in b if k not in a],'set':[[k,b64(b[k][0])] for k in b if k in a and a[k][0]!=b[k][0]]}
        assert not [k for k in a if a[k][1]!=b[k][1]],(r,f,'ATR1 changed')
    return {'file':r,'in_content_sha256':sha(ha),'out_content_sha256':sha(hb),'msbt':S}
r='Message/String_USen.sarc.zs'; P['strings']=sarcdiff(r); S=P['strings']['msbt']
P['messages']=[sarcdiff(x) for x in changed if x.startswith('Message/') and x.endswith('.sarc.zs') and x!=r]
d,v,E,tail=parse.load(os.path.join(OUT,'System/Resource/ResourceSizeTable.srsizetable'))
raw=struct.pack('<I',v)+b''.join(struct.pack('<III',*e) for e in E)+tail   # entries sorted by crc already
co=zlib.compressobj(9,zlib.DEFLATED,-15); z=co.compress(raw)+co.flush()
P['rstb']={'version':v,'count':len(E),'tail_len':len(tail),'data':b64(z),'content_sha256':sha(d)}
json.dump(P,open(dst,'w'),separators=(',',':')); print('patch',os.path.getsize(dst)//1024,'KB; drop',len(P['drop']),'with_fix',len(P['with_fix']),'bcsv',{k:len(x['edits']) for k,x in P['bcsv'].items()},'strings',{k:(len(x['add']),len(x['set'])) for k,x in S.items()},'messages',{m['file']:{k:len(x['add']) for k,x in m['msbt'].items()} for m in P['messages']})
