"""Apply jub-port-patch.json (format 2) in Python, as the page does. Usage:
  apply_patch.py <port romfs dir> <patch.json> <out zip> [--no-fix] [--on id,id] [--report report.json]
--no-fix: without the memory fix (the UnitIcon models stay out). --on: the optional fixes to apply (default: their defaults).
Prints which release the files are (or the closest one), and every fix that was skipped or only partly applied."""
import sys,os,json,zipfile
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import fix2,yaz0
a=sys.argv[1:]; R,PJ,OUT=a[:3]; opt=a[3:]
def arg(k):
    return opt[opt.index(k)+1] if k in opt else None
files={os.path.relpath(os.path.join(dp,f),R).replace(os.sep,'/'):open(os.path.join(dp,f),'rb').read() for dp,_,fs in os.walk(R) for f in fs}
P=json.load(open(PJ,encoding='utf8')); rel=fix2.release(P,files)
on=set(arg('--on').split(',')) if arg('--on') else None
out,rep=fix2.apply(P,files,on=on,memfix='--no-fix' not in opt)
pre='atmosphere/contents/%s/romfs/'%fix2.TID
with zipfile.ZipFile(OUT,'w',zipfile.ZIP_STORED) as z:
    for r in sorted(out): z.writestr(pre+r,yaz0.enc_raw(out[r]) if r==fix2.RS else out[r])
F={f['id']:f for f in P['fixes']}
print('release',rel['name'],'exact' if rel['exact'] else '(closest; %d changed, %d new, %d gone)'%(len(rel['changed']),len(rel['new']),len(rel['gone'])))
for x in rep:
    if x['state'] in ('skipped','partial'): print(x['state'],x['id'],'-',F[x['id']]['title'],x['why'])
print('built',len(out),'files')
if arg('--report'): json.dump({'release':rel,'fixes':rep},open(arg('--report'),'w'),indent=1)
