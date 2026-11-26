import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CODESIGN = '/usr/bin/codesign';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'MacSweep',
    executableName: 'MacSweep',
    appBundleId: 'local.macsweep',
    appCategoryType: 'public.app-category.utilities',
    asar: true,
    icon: 'assets/icon',
  },
  rebuildConfig: {},
  hooks: {
    // Ad hoc signature (D49): no Apple Developer account, but a valid seal over the final bundle,
    // made after Forge has written Info.plist and flipped the fuses.
    postPackage: async (_config, result) => {
      if (result.platform !== 'darwin') return;
      for (const outputPath of result.outputPaths) {
        const appPath = path.join(outputPath, 'MacSweep.app');
        await run(CODESIGN, ['--force', '--deep', '--sign', '-', appPath]);
        await run(CODESIGN, ['--verify', '--deep', '--strict', appPath]);
      }
    },
  },
  makers: [new MakerDMG({ format: 'ULFO' }), new MakerZIP({}, ['darwin'])],
  plugins: [
    new VitePlugin({
      build: [
        { entry: { main: 'src/main/index.ts' }, config: 'vite.main.config.mts', target: 'main' },
        {
          entry: { 'scan-worker': 'src/main/scanner/worker.ts' },
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: { preload: 'src/preload/index.ts' },
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.mts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    }),
  ],
};

export default config;
