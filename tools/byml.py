import struct
def load(b):
    assert b[:2]==b'YB',b[:2]
    ver,ko,so,ro=struct.unpack_from('<HIII',b,2)
    def strtab(o):
        if not o: return []
        n=struct.unpack_from('<I',b,o)[0]>>8
        offs=struct.unpack_from('<%dI'%n,b,o+4)
        return [b[o+x:b.index(b'\0',o+x)].decode('utf8','replace') for x in offs]
    K=strtab(ko); S=strtab(so)
    def val(t,v):
        if t==0xA0: return S[v]
        if t==0xD0: return bool(v)
        if t==0xD1: return struct.unpack('<i',struct.pack('<I',v))[0]
        if t==0xD2: return struct.unpack('<f',struct.pack('<I',v))[0]
        if t==0xD3: return ('u',v)
        if t in (0xD4,0xD5,0xD6):
            q=b[v:v+8]; return struct.unpack({0xD4:'<q',0xD5:'<Q',0xD6:'<d'}[t],q)[0]
        if t==0xFF: return None
        if t in (0xC0,0xC1): return node(v)
        return ('?%x'%t,v)
    def node(o):
        t=b[o]; n=struct.unpack('<I',b[o:o+4])[0]>>8
        if t==0xC0:
            ts=b[o+4:o+4+n]; vo=(o+4+n+3)&~3
            return [val(ts[i],struct.unpack_from('<I',b,vo+4*i)[0]) for i in range(n)]
        if t==0xC1:
            d={}
            for i in range(n):
                e=o+4+8*i; ki=struct.unpack('<I',b[e:e+3]+b'\0')[0]; tt=b[e+3]; v=struct.unpack_from('<I',b,e+4)[0]
                d[K[ki]]=val(tt,v)
            return d
        raise ValueError('node %x'%t)
    return node(ro) if ro else None
def diff(a,b,p='',out=None,lim=200):
    if out is None: out=[]
    if len(out)>=lim: return out
    if type(a)!=type(b): out.append((p,'type',a if not isinstance(a,(dict,list)) else type(a).__name__,b if not isinstance(b,(dict,list)) else type(b).__name__))
    elif isinstance(a,dict):
        for k in sorted(set(a)|set(b)):
            if k not in a: out.append((p+'/'+k,'added',str(b[k])[:60]))
            elif k not in b: out.append((p+'/'+k,'removed',str(a[k])[:60]))
            else: diff(a[k],b[k],p+'/'+k,out,lim)
    elif isinstance(a,list):
        if len(a)!=len(b): out.append((p,'len',len(a),len(b)))
        for i in range(min(len(a),len(b))): diff(a[i],b[i],p+'[%d]'%i,out,lim)
    elif a!=b: out.append((p,a,b))
    return out
