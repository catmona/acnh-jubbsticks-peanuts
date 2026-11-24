import sys,struct,collections; sys.path.insert(0,'.')
import yaz0
def load(p):
    d=yaz0.dec(open(p,'rb').read()); m,n,v=struct.unpack('<4sII',d[:12])
    E=[struct.unpack_from('<III',d,12+12*i) for i in range(n)]
    tail=d[12+12*n:]; return d,v,E,tail
if __name__=='__main__':
  for p in sys.argv[1:]:
    d,v,E,tail=load(p); print(p[-50:],'n',len(E),'v',v,'tail',len(tail))
    print(' third field counts',collections.Counter(e[2] for e in E).most_common(5))
    print(' sorted',all(E[i][0]<E[i+1][0] for i in range(len(E)-1)))
    print(' tail',tail[:200])
    nc=struct.unpack_from('<I',tail,0)[0]; print(' tail u32',nc, len(tail)-4)
