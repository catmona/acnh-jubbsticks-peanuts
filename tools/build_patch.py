"""Make jub-port-patch.json (format 2; tools/fix2.py says what is in it).
Usage: build_patch.py <port romfs> <release name> <fixes.json> <vanilla 3.0.3 size table> <out.json> [<older release romfs>=<name> ...]
The patch holds the fixes (label texts, rows, key paths), the 3.0.3 size table the page grows to fit, and short hashes of every file of
each release it knows (to tell which one it is given); none of the port's files. 'with_fix': the port's Model/UnitIcon* models; the page
ships them only with the memory fix (they crash 3.0.3 at the title without it)."""
import sys,os,json,zlib,struct,hashlib
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import fix2,parse
PR,NAME,FX,VR,DST=sys.argv[1:6]
def walk(R): return {os.path.relpath(os.path.join(dp,f),R).replace(os.sep,'/'):open(os.path.join(dp,f),'rb').read() for dp,_,fs in os.walk(R) for f in fs}
files=walk(PR); P={'format':2,'tid':fix2.TID,'release':NAME,'releases':{NAME:fix2.census(files)}}
for x in sys.argv[6:]:
    d,n=x.rsplit('=',1); P['releases'][n]=fix2.census(walk(d))
P['with_fix']=sorted(r for r in files if r.startswith('Model/UnitIcon'))
P['fixes']=json.load(open(FX))
d,v,E,tail=parse.load(VR); raw=struct.pack('<I',v)+b''.join(struct.pack('<III',*e) for e in E)+tail
co=zlib.compressobj(9,zlib.DEFLATED,-15); z=co.compress(raw)+co.flush()
P['rstb']={'version':v,'count':len(E),'data':fix2.b64(z),'content_sha256':hashlib.sha256(d).hexdigest()}
out,rep=fix2.apply(P,files)
bad=[r for r in rep if r['state'] in ('skipped','partial')]
assert not bad,bad   # every fix must fit the release it was made from
json.dump(P,open(DST,'w'),separators=(',',':'))
print('patch',os.path.getsize(DST)//1024,'KB;',len(P['fixes']),'fixes,',sum(len(f['ops']) for f in P['fixes']),'ops;',
      {k:sum(1 for r in rep if r['state']==k) for k in ('applied','already','off')},'; out files',len(out))
