"""Propose artwork groups from illustration crops, never from artist/name alone.
Writes review material under ignored data/images; the reviewed identity map is separate.
"""
import json, math, hashlib
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
import numpy as np
root = Path(__file__).resolve().parents[1]
rows = json.loads((root/'data/printings.json').read_text(encoding='utf8'))
cache = root/'data/images/printings'
review = root/'data/images/artwork-review'
review.mkdir(exist_ok=True)
n=32
D=np.cos(np.pi*(np.arange(n)[None,:]+.5)*np.arange(n)[:,None]/n)
def feature(path):
    im=Image.open(path).convert('RGB')
    crop=im.crop((im.width*.20, im.height*.18, im.width*.79, im.height*.57))
    a=np.asarray(crop.resize((n,n)).convert('L'),dtype=float)
    low=(D@a@D.T)[:8,:8].flatten()[1:]
    bits=low>np.median(low)
    color=np.asarray(crop.resize((8,8)),dtype=float)
    return bits,color
features={p['key']:feature(cache/(p['key'].replace('/','__')+'.webp')) for p in rows}
groups=[]
for p in rows:
    bits,color=features[p['key']]
    match=None
    for g in groups:
        if g['cardId']!=p['cardId']:continue
        other,ocolor=features[g['keys'][0]]
        if np.count_nonzero(bits!=other)<=6 and np.mean(np.abs(color-ocolor))<16:
            match=g;break
    if match:match['keys'].append(p['key'])
    else:groups.append({'cardId':p['cardId'],'keys':[p['key']]})
for i,g in enumerate(groups):g['reviewIndex']=i
(review/'proposals.json').write_text(json.dumps(groups,indent=2),encoding='utf8')
# All candidate groups and their printing thumbnails; one row per group.
for page,start in enumerate(range(0,len(groups),12)):
    sheet=Image.new('RGB',(1250,12*182),'#e9e9e9');d=ImageDraw.Draw(sheet)
    for row,g in enumerate(groups[start:start+12]):
        y=row*182
        d.text((4,y+2),str(g['reviewIndex'])+' '+g['cardId'],fill='black')
        for j,key in enumerate(g['keys']):
            im=Image.open(cache/(key.replace('/','__')+'.webp')).convert('RGB')
            im.thumbnail((96,138));sheet.paste(im,(j*124+4,y+21))
            d.text((j*124+4,y+160),key.split('/')[-1]+' '+key.split('/')[0][:7],fill='black')
    sheet.save(review/f'groups-{page+1:02}.jpg')
# Nearest split groups for same card: catches different crops of the same illustration.
splits=[]
for i,a in enumerate(groups):
    for b in groups[i+1:]:
        if a['cardId']!=b['cardId']:continue
        x,xc=features[a['keys'][0]];y,yc=features[b['keys'][0]]
        splits.append({'a':a['reviewIndex'],'b':b['reviewIndex'],'distance':int(np.count_nonzero(x!=y)), 'color':float(np.mean(np.abs(xc-yc)))})
(review/'split-candidates.json').write_text(json.dumps(sorted(splits,key=lambda p:p['distance']),indent=2),encoding='utf8')
print(json.dumps({'printings':len(rows),'proposedArtworks':len(groups),'pages':page+1,'splitPairs':len(splits)}))
