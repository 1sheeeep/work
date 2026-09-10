"""Build an additive class-only artifact on the verified deployed JAR.

No application resources, migrations, dependencies, or unrelated compiled classes
are taken from the dirty workspace. This script only writes build artifacts.
"""
import hashlib,json,sys,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[2]
stage=Path(sys.argv[1]).resolve()
if stage.parent != root/'platform/backend/target' or not stage.name.startswith('native-entry-candidate-'):
    raise SystemExit('OWNED_STAGE_REQUIRED')
base=root/'platform/backend/target/native-identity-release-posMXv/backend/app.jar'
if hashlib.sha256(base.read_bytes()).hexdigest()!='b1f7d051f929452a6cea02e70a9f1a6c2c7a6de7b20d58499f83881784a43166':
    raise SystemExit('DEPLOYED_BASELINE_CHANGED')
classes=root/'platform/backend/target/classes'
families=['cn/xzkj/erp/iam/preparation/CustomerServiceIdentityPreparation',
          'cn/xzkj/erp/iam/preparation/NativeCustomerServiceIdentity',
          'cn/xzkj/erp/customer/service/CustomerServiceWorkloadAuthenticationFilter',
          'cn/xzkj/erp/customer/service/CustomerServiceEntryExceptionHandler',
          'cn/xzkj/erp/customer/service/NativeCustomerServiceEntry',
          'cn/xzkj/erp/customer/service/NativeCustomerServiceEntryController']
overlay={}
for family in families:
    f=classes/(family+'.class')
    if not f.is_file():raise SystemExit('COMPILE_REQUIRED')
    for p in [f,*f.parent.glob(f.stem+'$*.class')]:
        overlay['BOOT-INF/classes/'+p.relative_to(classes).as_posix()]=p.read_bytes()
out=stage/'backend/app.jar'
with zipfile.ZipFile(base) as old,zipfile.ZipFile(out,'w') as new:
    for entry in old.infolist():
        new.writestr(entry,overlay.get(entry.filename,old.read(entry.filename)))
    for name,data in overlay.items():
        if name not in old.namelist():new.writestr(name,data)
with zipfile.ZipFile(base) as old,zipfile.ZipFile(out) as new:
    for name in old.namelist():
        if name not in overlay and old.read(name)!=new.read(name):raise SystemExit('UNRELATED_ENTRY_CHANGED')
    for info in new.infolist():
        if info.filename.startswith('BOOT-INF/lib/') and not info.is_dir() and info.compress_type!=zipfile.ZIP_STORED:
            raise SystemExit('NESTED_JAR_STORAGE_CHANGED')
(stage/'backend-class-overlay.json').write_text(json.dumps({'classes':sorted(overlay),'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'unchangedResourcesAndLibraries':True},indent=2))
print('BACKEND_OVERLAY_VERIFIED',len(overlay))
