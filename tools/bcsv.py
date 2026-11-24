import struct
def parse(b):
    n,el,fc=struct.unpack_from('<IIH',b,0); hdr=0x1c if b[0xc:0x10]==b'VSCB' else 0x0c
    ver=struct.unpack_from('<I',b,0x10)[0] if hdr==0x1c else None
    F=[struct.unpack_from('<II',b,hdr+8*i) for i in range(fc)]
    ds=hdr+8*fc
    order=sorted(F,key=lambda x:x[1]); size={}
    for i,(h,o) in enumerate(order): size[h]=(order[i+1][1] if i+1<len(order) else el)-o
    rows=[b[ds+el*r:ds+el*(r+1)] for r in range(n)]
    return dict(n=n,el=el,ver=ver,fields=F,size=size,rows=rows,ds=ds,hdr=hdr)
def val(t,row,h):
    o=dict(t['fields'])[h]; s=t['size'][h]; v=row[o:o+s]
    if s==4: return struct.unpack('<I',v)[0]
    if s==1: return v[0]
    if s==2: return struct.unpack('<H',v)[0]
    return v.split(b'\0')[0].decode('utf8','replace') if v.rstrip(b'\0').isascii() and v[:1]!=b'\0' else v.hex()
def table(t): return [{('%08x'%h):val(t,r,h) for h,_ in t['fields']} for r in t['rows']]
import os
def modfile(X,n,rel,pick=None):
    for dp,dn,fn in os.walk(os.path.join(X,n)):
        if pick and pick not in dp: continue
        p=dp.replace(os.sep,'/')
        i=p.lower().find('/romfs/')
        if i<0 and p.lower().endswith('/romfs'): i=len(p)-6
        if i<0: continue
        r=p[i+7:]
        for f in fn:
            if (r+'/'+f if r else f).lower()==rel.lower(): return os.path.join(dp,f)
