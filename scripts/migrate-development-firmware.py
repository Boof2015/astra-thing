#!/usr/bin/env python3
"""Developer-only bootstrap from the pre-manager image. Run locally on the Thing.

Uses the same signed verification, inactive-slot checks and readback as the manager.
Requires an explicit --install flag; cannot select a partition or run a supplied script.
"""
import argparse
import json
from pathlib import Path
import sys
import time

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app',type=Path)
    parser.add_argument('release',type=Path)
    parser.add_argument('--install',action='store_true')
    args=parser.parse_args()
    sys.path.insert(0,str(args.app))
    from management_update import Updater
    from release_verify import verify_envelope, verify_swu
    trust=json.loads((args.app/'trusted-keys.json').read_text())
    template=(args.app/'sw-description.template').read_text()
    envelope=json.loads(args.release.read_text())
    manifest=verify_envelope(envelope,trust)
    package=args.release.parent/manifest['artifacts']['update']['file']
    verify_swu(package,manifest,template)
    root=Path('/var/lib/astra-thing/management');root.mkdir(parents=True,exist_ok=True,mode=0o700)
    updater=Updater(root,trust,template,{'version':'0.2.0','build':'20260912000000'})
    updater.confirm_boot(False)  # Reconcile a failed candidate that returned to this older image.
    active,target=updater.slots()
    print(json.dumps({'verified':True,'currentSlot':active,'targetSlot':target,'version':manifest['version'],'build':manifest['build']}),flush=True)
    if not args.install:
        return
    job=updater.prepare(envelope,'development-bootstrap')
    with package.open('rb') as stream:
        updater.receive(job['id'],'development-bootstrap',stream,manifest['artifacts']['update']['bytes'])
    previous=None
    while True:
        job=updater.snapshot()
        if job['phase']!=previous:
            print(json.dumps(job),flush=True);previous=job['phase']
        if job['phase'] in ('failed','interrupted','rolled-back'):
            raise SystemExit('Firmware migration failed; check the operation record')
        if job['phase']=='complete':
            return
        if job['phase']=='restarting' and args.release.resolve().parent.parent == Path('/var/tmp/astra-manager-migration-'+manifest['build']):
            # This private bootstrap copy is no longer needed. The updater uses its own verified file.
            package.unlink(missing_ok=True)
        time.sleep(1)

if __name__=='__main__': main()
