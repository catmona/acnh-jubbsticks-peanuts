import struct
def sections(b):
    assert b[:8]==b'MsgStdBn' and b[8:10]==b'\xff\xfe', b[:10]
    n=struct.unpack_from('<H',b,0xe)[0]; o=0x20; out=[]
    for _ in range(n):
        mg=b[o:o+4]; sz=struct.unpack_from('<I',b,o+4)[0]; out.append([mg,b[o+16:o+16+sz]]); o=(o+16+sz+15)&~15
    return out
def labels(d):
    n=struct.unpack_from('<I',d,0)[0]; L={}
    for i in range(n):
        c,off=struct.unpack_from('<II',d,4+8*i); o=off
        for _ in range(c):
            ln=d[o]; name=d[o+1:o+1+ln].decode(); idx=struct.unpack_from('<I',d,o+1+ln)[0]; L[name]=idx; o+=1+ln+4
    return L
def texts(d):
    n=struct.unpack_from('<I',d,0)[0]; offs=list(struct.unpack_from('<%dI'%n,d,4))+[len(d)]
    return [d[offs[i]:offs[i+1]] for i in range(n)]
def build_txt2(T):
    o=4+4*len(T); offs=[]; body=b''
    for t in T: offs.append(o+len(body)); body+=t
    return struct.pack('<I',len(T))+struct.pack('<%dI'%len(T),*offs)+body
def build(b,secs):
    out=bytearray(b[:0x20])
    for mg,d in secs:
        out+=mg+struct.pack('<I',len(d))+b'\0'*8+d
        while len(out)%16: out+=b'\xab'
    struct.pack_into('<I',out,0x12,len(out)); return bytes(out)
