import os,re,sys,shutil
SRC,OUT=sys.argv[1],sys.argv[2]
shutil.rmtree(OUT,ignore_errors=True); os.makedirs(OUT)
log=[]
def rep(s,name,old,new,count=None,regex=False):
    n=len(re.findall(old,s)) if regex else s.count(old)
    if n==0: raise SystemExit(f'MISSING in {name}: {old[:80]}')
    if count is not None and n!=count: raise SystemExit(f'COUNT {n}!={count} in {name}: {old[:80]}')
    log.append(f'{name}: {n}x {old[:50]!r}')
    return re.sub(old,new,s) if regex else s.replace(old,new)
NAV_OLD='border-radius: 37.5px; background: rgba(255, 255, 255, 0.5); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.6)">'
NAV_NEW='border-radius: 37.5px; background: #DEEBF0">'
for n in sorted(os.listdir(SRC)):
    if not(n.startswith('Blue') and n.endswith('.dc.html')): continue
    s=open(f'{SRC}/{n}').read(); b=n[:-8]
    # 1 corner text links share one row with City (top 36)
    if re.search(r'top: 28px; width: \d+px; height: 44px; display: flex; align-items: center; justify-content: flex-end',s):
        s=rep(s,b,r'top: 28px; (width: \d+px; height: 44px; display: flex; align-items: center; justify-content: flex-end)',r'top: 36px; \1',regex=True)
    # 2 nav container visible on white, same as Walk overview
    if b in('BlueCity','BlueMyMap','BlueMyMapSaved','BlueMyMapEmpty'): s=rep(s,b,NAV_OLD,NAV_NEW,1)
    # 3 account button on the 44 control size
    if 'aria-label="Your account" style="position: absolute; left: 318px; top: 34px; width: 46px; height: 46px' in s:
        s=rep(s,b,'left: 318px; top: 34px; width: 46px; height: 46px','left: 319px; top: 35px; width: 44px; height: 44px')
    # 4 share code sheet: input and button on one row, hint full width
    if b in('BlueCityCode','BlueCityCodeWrong'):
        s=rep(s,b,'top: 300px; width: 372px; height: 236px;','top: 300px; width: 372px; height: 220px;',1)
        s=rep(s,b,'left: 20px; top: 84px; width: 332px; height: 56px;','left: 20px; top: 84px; width: 216px; height: 56px;',1)
        s=rep(s,b,'top: 156px; margin: 0; width: 196px;','top: 156px; margin: 0; width: 314px;',1)
        s=rep(s,b,'left: 241px; top: 471px; width: 120px; height: 56px;','left: 253px; top: 384px; width: 108px; height: 56px;',1)
    # 5 report sheet covers the heart button under it
    if b=='BlueReport': s=rep(s,b,'top: 364px; width: 372px; height: 470px;','top: 364px; width: 372px; height: 472px;',1)
    # 6 dialogs: content at x 38, buttons concentric with the 42 corner
    if b in('BlueDiscard','BlueMyWalkDelete'): s=rep(s,b,'padding: 30px 26px 26px; border-radius: 42px','padding: 30px 18px 18px; border-radius: 42px',1)
    # 7 account cards: content at x 38; list rows text at x 30; readable placeholder
    if b.startswith('BlueAccount'):
        s=rep(s,b,'padding: 24px; border-radius: 34px','padding: 24px 18px; border-radius: 34px',1)
    if b=='BlueAccount':
        s=rep(s,b,'padding: 0 6px;','padding: 0 10px;',2)
        s=rep(s,b,'color: rgba(0, 0, 0, 0.35)">you@example.com','color: #4F6470">you@example.com',1)
    if b=='BlueAccountSent':
        s=rep(s,b,'left: 30px; top: 600px; margin: 0; width: 330px;','left: 38px; top: 478px; margin: 0; width: 314px;',1)
    # 8 finding GPS: text on the page grid
    if b=='BlueGPS':
        s=rep(s,b,'left: 74px; top: 511px; margin: 0; width: 260px;','left: 28px; top: 511px; margin: 0; width: 330px;',1)
        s=rep(s,b,'left: 76px; top: 636px; margin: 0; width: 260px;','left: 30px; top: 636px; margin: 0; width: 330px;',1)
    open(f'{OUT}/{n}','w').write(s)
print('\n'.join(log))
