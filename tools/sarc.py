import struct,sys,hashlib
def parse(b):
    assert b[:4]==b'SARC',b[:4]
    hl,bom,size,doff,ver=struct.unpack_from('<HHIIH',b,4)
    assert b[0x14:0x18]==b'SFAT'
    _,n,hmul=struct.unpack_from('<HHI',b,0x18)
    ents=[]
    for i in range(n):
        h,attr,s,e=struct.unpack_from('<IIII',b,0x20+16*i); ents.append((h,attr,s,e))
    so=0x20+16*n; assert b[so:so+4]==b'SFNT'; nt=so+8
    out={}
    for h,attr,s,e in ents:
        name=None
        if attr>>24: o=nt+(attr&0xffffff)*4; name=b[o:b.index(b'\0',o)].decode()
        out[name or '%08x'%h]=(h,attr,b[doff+s:doff+e])
    return out,hmul,doff
if __name__=='__main__':
    V,_,dv=parse(open(sys.argv[1],'rb').read())
    print('vanilla',len(V),'entries data@',hex(dv))
    for m in sys.argv[2:]:
        M,_,dm=parse(open(m,'rb').read())
        add=[k for k in M if k not in V]; gone=[k for k in V if k not in M]; ch=[k for k in M if k in V and M[k][2]!=V[k][2]]
        print('==',m.split('/')[-3] if '/' in m else m,len(M),'entries; new',add[:10],'missing',len(gone),gone[:8],'changed',len(ch))
        for k in ch: print('   ch',k,len(V[k][2]),'->',len(M[k][2]))
def replace(b,new):
    """Rebuild SARC b with entries (by name) replaced by new[name]; keeps SFAT/SFNT and order, re-lays data."""
    P,_,doff=parse(b); n=struct.unpack_from('<H',b,0x1a)[0]
    ents=[struct.unpack_from('<IIII',b,0x20+16*i) for i in range(n)]
    byhash={v[0]:k for k,v in P.items()}
    starts=[e[2] for e in ents]; al=1
    while al<0x2000 and all(s%(al*2)==0 for s in starts): al*=2
    al=max(al,4)
    head=bytearray(b[:doff]); data=bytearray()
    for i,(h,attr,s,e) in enumerate(ents):
        k=byhash[h]; d=new.get(k,P[k][2])
        while len(data)%al: data+=b'\0'
        st=len(data); data+=d; struct.pack_into('<II',head,0x20+16*i+8,st,st+len(d))
    out=head+data; struct.pack_into('<I',out,8,len(out)); return bytes(out),al
