"""Build a signed, universal APK using an existing Android SDK and JDK (no Gradle downloads)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def run(args, **kwargs):
    kwargs.setdefault('cwd', ROOT)
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True,
                            encoding='utf-8', errors='replace', **kwargs)
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        print(result.stderr.strip())
    result.check_returncode()
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sdk', default=os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT'))
    parser.add_argument('--java-home', default=os.environ.get('JAVA_HOME'))
    parser.add_argument('--build-tools', default='36.0.0')
    args = parser.parse_args()
    if not args.sdk:
        parser.error('Pass --sdk with an existing Android SDK path.')
    sdk = Path(args.sdk).resolve()
    bt = sdk / 'build-tools' / args.build_tools
    platform = sdk / 'platforms/android-36/android.jar'
    suffix = '.exe' if os.name == 'nt' else ''
    java = Path(args.java_home) / 'bin' if args.java_home else Path(shutil.which('java')).parent
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    major, minor, patch = map(int, version.split('.'))
    version_code = major * 10000 + minor * 100 + patch
    build = ROOT / 'android/build'
    for folder in ['assets', 'gen', 'classes', 'dex']:
        generated = build / folder
        if generated.resolve().parent != build.resolve() or generated.is_symlink():
            raise RuntimeError('Generated build directory points outside android/build')
        if generated.exists():
            shutil.rmtree(generated)
        generated.mkdir(parents=True, exist_ok=True)
    private = ROOT / 'android/private'
    private.mkdir(parents=True, exist_ok=True)
    output = ROOT / 'outputs'
    output.mkdir(exist_ok=True)
    run([shutil.which('node'), ROOT / 'scripts/build.js'], cwd=ROOT)
    shutil.copyfile(ROOT / 'balatro.html', build / 'assets/balatro.html')
    # aapt2 on Windows cannot open some Unicode absolute paths; ASCII paths relative to cwd work.
    shutil.copyfile(platform, build / 'android.jar')
    run([bt / ('aapt2' + suffix), 'compile', '--dir', 'android/res', '-o', 'android/build/resources.zip'])
    run([bt / ('aapt2' + suffix), 'link', '-I', 'android/build/android.jar', '--manifest', 'android/AndroidManifest.xml',
         '--min-sdk-version', '26', '--target-sdk-version', '36', '--version-code', version_code,
         '--version-name', version, '-A', 'android/build/assets', '--java', 'android/build/gen',
         '-o', 'android/build/unsigned.apk', 'android/build/resources.zip'])
    sources = list((ROOT / 'android/src').rglob('*.java')) + list((build / 'gen').rglob('*.java'))
    run([java / ('javac' + suffix), '-J-Dfile.encoding=UTF-8', '-J-Duser.language=en', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-Xlint:-options',
         '-classpath', platform, '-d', build / 'classes', *sources])
    run([java / ('java' + suffix), '-cp', bt / 'lib/d8.jar', 'com.android.tools.r8.D8',
         '--lib', platform, '--min-api', '26', '--output', build / 'dex',
         *sorted((build / 'classes').rglob('*.class'))])
    with zipfile.ZipFile(build / 'unsigned.apk', 'a', compression=zipfile.ZIP_DEFLATED) as apk:
        for dex in sorted((build / 'dex').glob('*.dex')):
            apk.write(dex, dex.name)
    run([bt / ('zipalign' + suffix), '-f', '4', 'android/build/unsigned.apk', 'android/build/aligned.apk'])
    key, password_file = private / 'release.jks', private / 'keystore-password.txt'
    if key.exists() != password_file.exists():
        raise RuntimeError('Incomplete signing material. Restore the original key/password pair; do not regenerate.')
    if not key.exists():
        password = secrets.token_urlsafe(32)
        password_file.write_text(password, encoding='ascii')
        env = {**os.environ, 'PIXEL_KEY_PASS': password}
        run([java / ('keytool' + suffix), '-genkeypair', '-keystore', key, '-alias', 'pixel-balatro',
             '-storetype', 'JKS', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
             '-dname', 'CN=Pixel Balatro, O=Hell-space, C=CN', '-storepass:env', 'PIXEL_KEY_PASS',
             '-keypass:env', 'PIXEL_KEY_PASS'], env=env)
    apk = output / f'PixelBalatro-{version}-android.apk'
    signer = [java / ('java' + suffix), '-Dfile.encoding=UTF-8', '-Duser.language=en', '-jar', bt / 'lib/apksigner.jar']
    signing_env = {**os.environ, 'PIXEL_KEY_PASS': password_file.read_text(encoding='ascii').strip()}
    run([*signer, 'sign', '--ks', key, '--ks-key-alias', 'pixel-balatro',
         '--ks-pass', 'env:PIXEL_KEY_PASS', '--key-pass', 'env:PIXEL_KEY_PASS',
         '--v4-signing-enabled', 'false', '--out', apk, build / 'aligned.apk'], env=signing_env)
    apk.with_suffix('.apk.idsig').unlink(missing_ok=True)
    verification = run([*signer, 'verify', '--verbose', '--print-certs', apk])
    run([bt / ('zipalign' + suffix), '-c', '4', apk.relative_to(ROOT)])
    badging = run([bt / ('aapt' + suffix), 'dump', 'badging', apk.relative_to(ROOT)])
    with zipfile.ZipFile(apk) as package:
        asset = package.read('assets/balatro.html')
        if asset != (ROOT / 'balatro.html').read_bytes():
            raise RuntimeError('Packaged HTML differs from the verified source build')
        if any(n.startswith('lib/') for n in package.namelist()):
            raise RuntimeError('Unexpected native library in universal APK')
    receipt = {'version': version, 'versionCode': version_code, 'package': 'io.github.hellspace.pixelbalatro',
               'apk': apk.name, 'bytes': apk.stat().st_size,
               'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
               'htmlSha256': hashlib.sha256(asset).hexdigest(),
               'minSdk': 26, 'targetSdk': 36, 'nativeLibraries': False,
               'signatureVerification': verification, 'badging': badging}
    (output / 'android-build.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'APK: {apk}')
    print(f'SHA256: {receipt["sha256"]}')


if __name__ == '__main__':
    main()
