"""Build using official aapt2/R8/apksig Maven artifacts and an existing JDK.
Keys are created outside the repository; never add them to Git or to a public archive.
"""
from pathlib import Path
import argparse, subprocess, shutil, os, re, zipfile, struct, json, secrets, hashlib
parser=argparse.ArgumentParser()
parser.add_argument('--tools',type=Path,required=True)
parser.add_argument('--signing',type=Path,required=True)
args=parser.parse_args()
tools=args.tools.resolve();signing=args.signing.resolve()
root=Path(__file__).resolve().parents[2];source=root/'native/android';build=source/'build';build.mkdir(exist_ok=True)
for filename, info in json.loads((source/'tools.lock.json').read_text()).items():
 if hashlib.sha256((tools/filename).read_bytes()).hexdigest() != info['sha256']:raise RuntimeError('Unexpected tool checksum: '+filename)
jdk=next(tools.glob('jdk*/Contents/Home'))
def run(parts, **kwargs):subprocess.run([str(x) for x in parts],check=True,**kwargs)
java=jdk/'bin/java';javac=jdk/'bin/javac';aapt=tools/'aapt2';platform=tools/'android-all.jar'
assets=build/'assets';assets.mkdir(exist_ok=True)
html=(root/'index.html').read_text()
html=re.sub(r'^.*<script src="./pwa.js" defer></script>.*\n','',html,flags=re.M)
html=re.sub(r'^.*<link rel="manifest".*\n','',html,flags=re.M)
html=html.replace('<head>','''<head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'">
    <script src="./native.js" defer></script>''',1)
(assets/'index.html').write_text(html)
shutil.copy2(source/'native.js',assets/'native.js');shutil.copytree(root/'icons',assets/'icons',dirs_exist_ok=True)
run([aapt,'compile','--dir',source/'res','-o',build/'res.zip'])
run([aapt,'link','-o',build/'resources.apk','-I',platform,'--manifest',source/'AndroidManifest.xml','--auto-add-overlay','-A',assets,build/'res.zip'])
classes=build/'classes';classes.mkdir(exist_ok=True)
run([javac,'--release','8','-encoding','UTF-8','-classpath',platform,'-d',classes,*source.glob('src/**/*.java')])
dex=build/'dex';dex.mkdir(exist_ok=True)
run([java,'-Xmx1g','-cp',tools/'r8.jar','com.android.tools.r8.D8','--release','--min-api','26','--lib',platform,'--lib',jdk,'--output',dex,*classes.rglob('*.class')])
# Resource and dex files must be uncompressed and aligned before APK signing.
with zipfile.ZipFile(build/'resources.apk') as inp,zipfile.ZipFile(build/'unsigned.apk','w') as out:
 entries=[(info.filename,inp.read(info.filename)) for info in inp.infolist() if not info.is_dir()]+[('classes.dex',(dex/'classes.dex').read_bytes())]
 for name,content in entries:
  info=zipfile.ZipInfo(name);info.compress_type=zipfile.ZIP_STORED
  offset=out.fp.tell()+30+len(name.encode('utf-8'))
  padding=(-offset)%4
  if padding:info.extra=struct.pack('<HH',0xd935,padding)+b'\0'*padding
  out.writestr(info,content)
signing.mkdir(exist_ok=True,parents=True);signing.chmod(0o700)
secret=signing/'signing.json';store=signing/'zatraty-release.p12'
if not secret.exists():
 if store.exists():raise RuntimeError('Signing key exists but password is missing; do not replace the key.')
 secret.write_text(json.dumps({'password':secrets.token_urlsafe(36)}));secret.chmod(0o600)
password=json.loads(secret.read_text())['password'];env={**os.environ,'ZATRATY_SIGN_PASSWORD':password}
if not store.exists():
 run([jdk/'bin/keytool','-genkeypair','-keystore',store,'-storetype','PKCS12','-storepass:env','ZATRATY_SIGN_PASSWORD','-keypass:env','ZATRATY_SIGN_PASSWORD','-alias','zatraty','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Zatraty Local Release'],env=env)
 store.chmod(0o600)
run([javac,'-classpath',tools/'apksig.jar','-d',build,source/'SignApk.java'])
run([java,'-cp',str(build)+os.pathsep+str(tools/'apksig.jar'),'SignApk',store,build/'unsigned.apk',build/'Zatraty-8.1.1.apk'],env=env)
print('APK:',build/'Zatraty-8.1.1.apk')
