#!/usr/bin/env python3
import json, math, sys
from pathlib import Path
from collections import Counter
import cv2
import numpy as np

root=Path(sys.argv[1] if len(sys.argv)>1 else 'artifacts/c53')
corpus=root/'corpus'; renders=root/'renders'
CAND=json.loads((corpus/'candidate-manifest.json').read_text())
TEST=json.loads((corpus/'test-manifest.json').read_text())

def midframe(path):
    cap=cv2.VideoCapture(str(path)); n=int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 1); cap.set(cv2.CAP_PROP_POS_FRAMES,max(0,n//2)); ok,im=cap.read(); cap.release()
    if not ok: raise RuntimeError(f'cannot decode {path}')
    return im

def unit(v):
    v=np.asarray(v,np.float32).ravel(); n=float(np.linalg.norm(v)); return v/(n+1e-9)

def circle_topology(gray):
    h,w=gray.shape; s=min(h,w)
    blur=cv2.GaussianBlur(gray,(5,5),1.1)
    cs=cv2.HoughCircles(blur,cv2.HOUGH_GRADIENT,dp=1.2,minDist=max(10,int(s*.035)),param1=100,param2=22,minRadius=max(4,int(s*.008)),maxRadius=int(s*.40))
    if cs is None: return np.zeros(12,np.float32)
    a=np.asarray(cs[0],np.float32)
    if len(a)>32: a=a[np.argsort(a[:,2])[-32:]]
    xy=a[:,:2]; rr=a[:,2]/s
    c=xy.mean(axis=0); centered=(xy-c)/s
    if len(xy)>=2:
        cov=np.cov(centered.T); ev=np.sort(np.linalg.eigvalsh(cov))[::-1]; linearity=1-float(ev[1]/(ev[0]+1e-9))
    else: linearity=0
    center_disp=float(np.mean(np.linalg.norm(centered,axis=1)))
    med=np.median(xy,axis=0); concentric=float(np.mean(np.linalg.norm((xy-med)/s,axis=1)))
    radius_cv=float(rr.std()/(rr.mean()+1e-9))
    return np.array([
        min(len(a),32)/32, rr.mean(), rr.std(), radius_cv,
        c[0]/w,c[1]/h, center_disp, concentric, linearity,
        float(np.ptp(xy[:,0])/w),float(np.ptp(xy[:,1])/h),float(np.ptp(rr))
    ],np.float32)

def line_topology(lines,shape):
    h,w=shape; diag=math.hypot(w,h)
    if lines is None or not len(lines): return np.zeros(14,np.float32)
    rec=[]
    for q in lines[:,0]:
        x1,y1,x2,y2=map(float,q); dx=x2-x1;dy=y2-y1;L=math.hypot(dx,dy); a=(math.degrees(math.atan2(dy,dx))%180);rec.append((x1,y1,x2,y2,L,a))
    horiz=[r for r in rec if min(r[5],180-r[5])<12]; vert=[r for r in rec if abs(r[5]-90)<12]
    long=[r for r in rec if r[4]>.28*min(w,h)]
    def pos_stats(rs,axis):
        if not rs:return (0,0)
        vals=[((r[1]+r[3])/2)/h if axis=='y' else ((r[0]+r[2])/2)/w for r in rs]
        return float(np.mean(vals)),float(np.std(vals))
    hy,hs=pos_stats(horiz,'y');vx,vs=pos_stats(vert,'x')
    lengths=np.array([r[4]/diag for r in rec],np.float32)
    return np.array([
        min(len(rec),80)/80,min(len(horiz),30)/30,min(len(vert),30)/30,min(len(long),30)/30,
        hy,hs,vx,vs,float(lengths.mean()),float(lengths.std()),float(lengths.max()),
        sum(r[4] for r in horiz)/(sum(r[4] for r in rec)+1e-9),
        sum(r[4] for r in vert)/(sum(r[4] for r in rec)+1e-9),
        sum(r[4] for r in long)/(sum(r[4] for r in rec)+1e-9)
    ],np.float32)

def descriptor(im):
    h,w=im.shape[:2]; m=int(min(h,w)*.045); im=im[m:h-m,m:w-m]
    gray=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)
    mask=(gray<205).astype(np.uint8)*255
    mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
    occ=cv2.resize(mask.astype(np.float32)/255,(12,12),interpolation=cv2.INTER_AREA).ravel()
    px=cv2.resize((mask.mean(axis=0)/255).reshape(1,-1),(24,1),interpolation=cv2.INTER_AREA).ravel()
    py=cv2.resize((mask.mean(axis=1)/255).reshape(-1,1),(1,24),interpolation=cv2.INTER_AREA).ravel()
    M=cv2.moments(mask,True); hu=cv2.HuMoments(M).ravel(); hu=np.sign(hu)*np.log1p(np.abs(hu)*1e7)
    gx=cv2.Sobel(gray,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(gray,cv2.CV_32F,0,1,ksize=3); mag=cv2.magnitude(gx,gy); ang=(cv2.phase(gx,gy,angleInDegrees=True)%180)
    oh=np.zeros(12,np.float32)
    for i in range(12): oh[i]=mag[(ang>=i*15)&(ang<(i+1)*15)].sum()
    ys,xs=np.where(mask>0)
    if len(xs):
        cx,cy=xs.mean(),ys.mean(); r=np.sqrt((xs-cx)**2+(ys-cy)**2); r=r/(math.hypot(mask.shape[1],mask.shape[0])+.001); rh,_=np.histogram(r,bins=10,range=(0,.75)); rh=rh.astype(np.float32)
    else: rh=np.zeros(10,np.float32)
    nlab,lab,stats,cent=cv2.connectedComponentsWithStats(mask,8); areas=np.sort(stats[1:,cv2.CC_STAT_AREA].astype(np.float32)) if nlab>1 else np.array([],np.float32)
    comp=np.array([min(40,len(areas))/40, mask.mean()/255, *(np.percentile(areas,[25,50,75,95])/max(1,mask.size) if len(areas) else [0,0,0,0])],np.float32)
    edges=cv2.Canny(gray,80,180); lines=cv2.HoughLinesP(edges,1,np.pi/180,threshold=35,minLineLength=max(18,int(min(mask.shape)*.06)),maxLineGap=8)
    lh=np.zeros(12,np.float32)
    if lines is not None:
        for q in lines[:,0]:
            dx,dy=q[2]-q[0],q[3]-q[1]; a=(math.degrees(math.atan2(dy,dx))%180); L=math.hypot(dx,dy); lh[min(11,int(a//15))]+=L
    ct=circle_topology(gray); lt=line_topology(lines,gray.shape)
    # Block-wise normalization prevents a large occupancy grid from drowning the topology channels.
    return unit(np.concatenate([unit(occ),unit(px),unit(py),unit(hu),unit(oh),unit(rh),unit(comp),unit(lh),unit(ct)*1.35,unit(lt)*1.35]))

def dist(a,b): return float(1-np.dot(a,b))

cand=[]
for row in CAND:
    mp4=renders/'candidates'/row['file'].replace('.json','.mp4')
    cand.append((row,descriptor(midframe(mp4))))

# Inference intentionally finishes before truth.json is read. Candidate labels are registry knowledge;
# test family IDs are opaque until predictions have been persisted in memory.
pred=[]
for row in TEST:
    mp4=renders/'tests'/row['file'].replace('.json','.mp4'); d=descriptor(midframe(mp4))
    family_best={}
    for c,cd in cand:
        dd=dist(d,cd); cur=family_best.get(c['family_id'])
        if cur is None or dd<cur[0]: family_best[c['family_id']]=(dd,c.get('anchor'))
    ranked=sorted((v[0],fam,v[1]) for fam,v in family_best.items())
    best,runner=ranked[0],ranked[1]; margin=runner[0]-best[0]
    state='accepted' if best[0] < .42 and margin > .012 else 'ambiguous'
    pred.append({'id':row['id'],'mode':row['mode'],'state':state,'prediction':best[1] if state=='accepted' else None,'best_family':best[1],'best_anchor':best[2],'residual':round(best[0],6),'runner_up':runner[1],'runner_up_anchor':runner[2],'runner_up_residual':round(runner[0],6),'runner_up_margin':round(margin,6)})

truth=json.loads((corpus/'truth.json').read_text())
for p in pred:
    t=truth[p['id']]; p['truth_family']=t['family_id']; p['correct']=(p['prediction']==t['family_id']) if p['state']=='accepted' else None; p['best_correct']=p['best_family']==t['family_id']

def summarize(rows):
    n=len(rows); accepted=[x for x in rows if x['state']=='accepted']; correct=sum(x['correct'] is True for x in accepted); best=sum(x['best_correct'] for x in rows)
    return {'n':n,'best_family_accuracy':round(best/n,6) if n else 0,'accepted':len(accepted),'abstain':n-len(accepted),'accepted_accuracy':round(correct/len(accepted),6) if accepted else None,'coverage':round(len(accepted)/n,6) if n else 0}
summary={'all':summarize(pred)}
for mode in sorted(set(x['mode'] for x in pred)): summary[mode]=summarize([x for x in pred if x['mode']==mode])
conf=Counter((x['truth_family'],x['best_family']) for x in pred if not x['best_correct'])
report={'schema':'c53-physical-semantic-object-inverse-v3-topology','thresholds':{'max_residual':.42,'min_margin':.012},'candidate_anchors':sorted(set(x.get('anchor') for x in CAND)),'summary':summary,'hard_confusions':[{'truth':a,'predicted':b,'count':n} for (a,b),n in conf.most_common(30)],'predictions':pred}
(root/'analysis.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
