"""Package the standalone launcher with its SDK, without npm dependencies."""
import json
from pathlib import Path
import zipfile
root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text())['version']
output = root / 'dist' / f'tempest-remote-launcher-{version}.zip'
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ['scripts/remote.js', 'scripts/clients.js', 'lib/remote-sdk.cjs', 'lib/REMOTE-SDK-LICENSE', 'README.md', 'LICENSE']:
        archive.write(root / name, Path('tempest-remote-launcher') / name)
print(output)
