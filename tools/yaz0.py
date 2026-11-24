import struct
def dec(d):
    assert d[:4]==b'Yaz0'; n=struct.unpack('>I',d[4:8])[0]; o=bytearray(); i=16
    while len(o)<n:
        c=d[i]; i+=1
        for b in range(8):
            if len(o)>=n: break
            if c&(0x80>>b): o.append(d[i]); i+=1
            else:
                b1,b2=d[i],d[i+1]; i+=2; dist=((b1&15)<<8|b2)+1
                if b1>>4: L=(b1>>4)+2
                else: L=d[i]+0x12; i+=1
                for _ in range(L): o.append(o[-dist])
    return bytes(o)
def enc_raw(d):
    # store-only yaz0 (all literals)
    o=bytearray(b'Yaz0'+struct.pack('>I',len(d))+b'\0'*8)
    for i in range(0,len(d),8):
        ch=d[i:i+8]; o.append((0xff<<(8-len(ch)))&0xff); o+=ch
    return bytes(o)
