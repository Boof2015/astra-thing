import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'prototype'))
from management_core import Pairing, Conflict
from hardware_pairing import EphemeralKey, b64
from management_update import Updater

class PairingTests(unittest.TestCase):
    def test_approval_proof_expiry_and_revocation(self):
        with tempfile.TemporaryDirectory() as directory:
            now = [10]
            manager = EphemeralKey()
            self.addCleanup(manager.close)
            pairing = Pairing(Path(directory) / 'managers.json', 'a'*32, 'b'*64, clock=lambda:now[0])
            response = pairing.request({'label':'Test computer','publicKey':manager.public,'nonce':b64(b'x'*32)})
            proof = {'id':response['id'],'proof':pairing.pending['proof']}
            with self.assertRaises(Conflict): pairing.finish(proof)
            with self.assertRaises(ValueError): pairing.finish({**proof,'proof':'wrong'})
            with self.assertRaises(Conflict): pairing.approve(response['id'], 'wrong')
            pairing.approve(response['id'], pairing.pending['code'])
            credential = pairing.finish(proof)
            self.assertEqual(pairing.finish(proof), credential)
            self.assertEqual(pairing.authorize('Bearer '+credential['token']), credential['managerId'])
            self.assertNotIn(credential['token'], (Path(directory)/'managers.json').read_text())
            pairing.forget_all()
            self.assertIsNone(pairing.authorize('Bearer '+credential['token']))
            response = pairing.request({'label':'Other','publicKey':manager.public,'nonce':b64(b'y'*32)})
            now[0] += 91
            self.assertIsNone(pairing.snapshot())
            with self.assertRaises(Conflict): pairing.approve(response['id'], '000000')

class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.updater = Updater(self.root, {}, '', {'version':'0.3.0','build':'20260912000000'}, boot_id='boot-original')
        self.updater.job = {'id':'a'*32,'phase':'restarting','bootId':'boot-original','previousSlot':'a','targetSlot':'b','version':'0.3.0','build':'20260912000000'}

    def test_does_not_confirm_rollback_before_reboot(self):
        with patch('management_update.Path.read_text', return_value='superbird.slot=a'):
            self.updater.confirm_boot(True)
        self.assertEqual(self.updater.job['phase'], 'restarting')

    def test_new_slot_requires_ui_health_and_expected_build(self):
        self.updater.boot_id = 'boot-new'
        with patch('management_update.Path.read_text', return_value='superbird.slot=b'):
            self.updater.confirm_boot(False)
            self.assertEqual(self.updater.job['phase'], 'restarting')
            self.updater.version['build']='20260913000000'
            self.updater.confirm_boot(True)
            self.assertEqual(self.updater.job['phase'], 'restarting')
            self.updater.version['build']='20260912000000'
            self.updater.confirm_boot(True)
        self.assertEqual(self.updater.job['phase'], 'complete')

    def test_old_slot_after_reboot_reports_rollback(self):
        self.updater.boot_id = 'boot-new'
        with patch('management_update.Path.read_text', return_value='superbird.slot=a'):
            self.updater.confirm_boot(True)
        self.assertEqual(self.updater.job['phase'], 'rolled-back')

    def test_wrong_upload_owner_and_length_cannot_write(self):
        self.updater.job.update(phase='receiving', owner='owner', bytes=20)
        for owner, length in [('other',20),('owner',21)]:
            with self.assertRaises(ValueError): self.updater.receive('a'*32,owner,io.BytesIO(b'x'*20),length)
        self.assertEqual(list(self.root.glob('*.swu')), [])

    def test_interrupted_job_is_never_successful(self):
        (self.root/'operation.json').write_text(json.dumps({**self.updater.job,'phase':'installing'}))
        restarted=Updater(self.root,{},'',self.updater.version,boot_id='boot-new')
        self.assertEqual(restarted.snapshot()['phase'],'interrupted')

    def test_abandoned_upload_reservation_expires_without_touching_partitions(self):
        self.updater.job.update(phase='receiving', owner='owner', bytes=20)
        self.updater.receive_deadline = 100
        with patch('management_update.time.monotonic', return_value=101):
            self.assertEqual(self.updater.snapshot()['phase'], 'interrupted')
            with self.assertRaises(ValueError):
                self.updater.receive('a'*32, 'owner', io.BytesIO(b'x'*20), 20)
        self.assertEqual(list(self.root.glob('*.swu')), [])

if __name__ == '__main__': unittest.main()
