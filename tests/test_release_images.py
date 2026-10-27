import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('release_images', Path(__file__).resolve().parents[1] / 'scripts/verify-release-images.py')
release_images = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_images)


class ReleaseIdentityTests(unittest.TestCase):
    def test_old_deploy_artifacts_cannot_be_signed_as_a_new_build(self):
        flash = {'metadata': {'version': '0.3.0'}}
        update = {'version': '0.3.0+20260912224043'}
        release_images.check_identity(flash, update, {'version': '0.3.0', 'build': '20260912224043'})
        with self.assertRaisesRegex(ValueError, 'do not match'):
            release_images.check_identity(flash, update, {'version': '0.3.0', 'build': '20261027000000'})
        with self.assertRaisesRegex(ValueError, 'do not match'):
            release_images.check_identity({'metadata': {'version': '0.2.0'}}, update, {'version': '0.3.0', 'build': '20260912224043'})


if __name__ == '__main__':
    unittest.main()
