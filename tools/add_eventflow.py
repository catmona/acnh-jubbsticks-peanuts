"""Add the EventFlow section to jub-port-patch.json.
Usage: add_eventflow.py <port EventFlowInfoProduct.byml> <vanilla 3.0.3 EventFlowInfoProduct.byml> <patch.json> <flow names, comma separated>
The port's Info byml is 2.x-era: it changes entries that 3.0.3 already has (hangs the game). The patch holds the 3.0.3 values of
just those entries ('revert'); the page puts them back, so the result is the 3.0.3 file plus the port's additions."""
import sys,os,json,hashlib
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import byml,bymlw
port,van,dst,flows=sys.argv[1:5]; sha=lambda b:hashlib.sha256(b).hexdigest()
pb=open(port,'rb').read(); P=byml.load(pb); V=byml.load(open(van,'rb').read())
rev={k:{x:V[k][x] for x in V[k] if V[k][x]!=P[k].get(x)} for k in V if V[k]!=P.get(k) and isinstance(V[k],dict)}
for k in P:   # 3.0.3 values are always [] or {subfile:[...]}; the port adds '' (SNPC_mol_02_Commune/MolConv)
    for x,y in (P[k].items() if isinstance(P[k],dict) else ()):
        if y=='' and x not in V.get(k,{}): rev.setdefault(k,{})[x]=[]
rev={k:x for k,x in rev.items() if x}
assert all(k in P for k in V) and not [k for k in V if V[k]!=P[k] and not isinstance(V[k],dict)]
for k in V:
    assert all(x in P[k] for x in V[k]), k   # the port only adds or changes, never removes
M={k:dict(P[k]) for k in P}
for k,x in rev.items(): M[k].update(x)
out=bymlw.dump(M)
J=json.load(open(dst))
J['eventflow']={'file':'EventFlow/Info/EventFlowInfoProduct.byml','in_sha256':sha(pb),'revert':rev,'out_sha256':sha(out),'flows':[f for f in flows.split(',') if f]}
json.dump(J,open(dst,'w'),separators=(',',':')); print('revert',{k:list(x) for k,x in rev.items()},'out',len(out))
