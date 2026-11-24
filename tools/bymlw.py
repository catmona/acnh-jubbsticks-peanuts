import struct
def dump(root,ver=3):
    keys=set();strs=set()
    def scan(x):
        if isinstance(x,dict):
            for k,v in x.items(): keys.add(k); scan(v)
        elif isinstance(x,list):
            for v in x: scan(v)
        elif isinstance(x,str): strs.add(x)
    scan(root)
    K=sorted(keys,key=lambda s:s.encode()); S=sorted(strs,key=lambda s:s.encode())
    ki={k:i for i,k in enumerate(K)}; si={s:i for i,s in enumerate(S)}
    def table(L):
        n=len(L); hdr=struct.pack('<I',0xC2|(n<<8)); off=4+4*(n+1); offs=[];body=b''
        for s in L:
            offs.append(off+len(body)); body+=s.encode()+b'\0'
        offs.append(off+len(body)); out=hdr+b''.join(struct.pack('<I',o) for o in offs)+body
        return out+b'\0'*((-len(out))%4)
    out=bytearray(16)  # header placeholder
    kt=table(K); ko=len(out); out+=kt
    st=table(S); so=len(out); out+=st
    def enc(x):
        if x is None: return 0xFF,0
        if isinstance(x,bool): return 0xD0,int(x)
        if isinstance(x,str): return 0xA0,si[x]
        if isinstance(x,int): return 0xD1,struct.unpack('<I',struct.pack('<i',x))[0]
        if isinstance(x,float): return 0xD2,struct.unpack('<I',struct.pack('<f',x))[0]
        if isinstance(x,tuple) and x[0]=='u': return 0xD3,x[1]
        if isinstance(x,(dict,list)): return 'n',x
        raise ValueError(x)
    def node(x):
        # children first
        ch=[]
        items=sorted(x.items(),key=lambda kv:ki[kv[0]]) if isinstance(x,dict) else list(enumerate(x))
        vals=[]
        for k,v in items:
            e=enc(v)
            if e[0]=='n': vals.append((k,0xC1 if isinstance(v,dict) else 0xC0,None,v))
            else: vals.append((k,e[0],e[1],None))
        # place children after this node: compute own size
        n=len(items)
        if isinstance(x,dict): size=4+8*n
        else: size=4+n+((-(4+n))%4)+4*n
        pos=len(out); out.extend(b'\0'*size)
        for i,(k,t,v,sub) in enumerate(vals):
            if sub is not None: v=node(sub)
            vals[i]=(k,t,v,sub)
        if isinstance(x,dict):
            struct.pack_into('<I',out,pos,0xC1|(n<<8))
            for i,(k,t,v,_) in enumerate(vals):
                e=pos+4+8*i; out[e:e+3]=struct.pack('<I',ki[k])[:3]; out[e+3]=t; struct.pack_into('<I',out,e+4,v)
        else:
            struct.pack_into('<I',out,pos,0xC0|(n<<8))
            for i,(k,t,v,_) in enumerate(vals): out[pos+4+i]=t
            vo=pos+4+n+((-(4+n))%4)
            for i,(k,t,v,_) in enumerate(vals): struct.pack_into('<I',out,vo+4*i,v)
        return pos
    # root must be placed at end after tables; pad 4
    ro=node(root)
    struct.pack_into('<2sHIII',out,0,b'YB',ver,ko,so,ro)
    return bytes(out)
