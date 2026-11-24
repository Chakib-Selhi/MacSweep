import { describe, expect, it } from 'vitest';
import type { CategoryResult, ScanDone } from '../../src/shared/types';
import {
  annotateOpenApps,
  canBelongToApp,
  findOpenApp,
  parseLsappinfo,
  type RunningApp,
} from '../../src/main/running-apps';

const SAMPLE = ` 1) "loginwindow" ASN:0x0-0x2002:
    bundleID="com.apple.loginwindow"
    pid = 423 type="UIElement"
 2) "universalaccessd" ASN:0x0-0xe00e:
    bundleID=[ NULL ]
    pid = 629
 3) "Google Chrome" ASN:0x0-0x1a01a:
    bundleID="com.google.Chrome"
    pid = 900
 4) "Xcode" ASN:0x0-0x2b02b:
    bundleID="com.apple.dt.Xcode"
`;

const apps: RunningApp[] = parseLsappinfo(SAMPLE);

describe('parseLsappinfo', () => {
  it('lit le nom et le bundleID de chaque app', () => {
    expect(apps).toEqual([
      { name: 'loginwindow', bundleId: 'com.apple.loginwindow' },
      { name: 'universalaccessd', bundleId: null },
      { name: 'Google Chrome', bundleId: 'com.google.Chrome' },
      { name: 'Xcode', bundleId: 'com.apple.dt.Xcode' },
    ]);
  });

  it('résiste à une sortie vide ou inattendue', () => {
    expect(parseLsappinfo('')).toEqual([]);
    expect(parseLsappinfo('bundleID="orphelin"\nn’importe quoi')).toEqual([]);
  });
});

describe('findOpenApp', () => {
  const item = (name: string) => `/Users/x/Library/Caches/${name}`;

  it.each([
    ['com.google.Chrome', 'Google Chrome'],
    ['COM.GOOGLE.CHROME', 'Google Chrome'],
    ['com.google.Chrome.helper', 'Google Chrome'],
    ['Google', 'Google Chrome'],
    ['Google Chrome', 'Google Chrome'],
    ['universalaccessd', 'universalaccessd'],
  ])('rattache %s à %s', (name, expected) => {
    expect(findOpenApp('user-caches', item(name), apps)).toBe(expected);
  });

  it.each(['com.apple.Safari', 'Goo', 'chrome', 'com.google'])('ne rattache pas %s', (name) => {
    expect(findOpenApp('user-caches', item(name), apps)).toBeNull();
  });

  it('rattache DerivedData et le support des appareils à Xcode ouvert', () => {
    expect(
      findOpenApp('xcode-derived-data', '/Users/x/Library/Developer/Xcode/DerivedData/P-a', apps),
    ).toBe('Xcode');
    expect(
      findOpenApp(
        'ios-device-support',
        '/Users/x/Library/Developer/Xcode/iOS DeviceSupport/17',
        apps,
      ),
    ).toBe('Xcode');
  });

  it('rattache les simulateurs à l’app Simulator ouverte', () => {
    const withSimulator = [...apps, { name: 'Simulator', bundleId: 'com.apple.iphonesimulator' }];
    expect(findOpenApp('ios-simulators', '/x/Devices/UDID', withSimulator)).toBe('Simulator');
    expect(findOpenApp('ios-simulators', '/x/Devices/UDID', apps)).toBeNull();
  });

  it('ne signale rien pour la Corbeille ni les caches de paquets', () => {
    expect(findOpenApp('trash', '/Users/x/.Trash/Xcode', apps)).toBeNull();
    expect(findOpenApp('js-package-caches', '/Users/x/.npm/_cacache', apps)).toBeNull();
  });
});

describe('annotateOpenApps', () => {
  it('ajoute openApp aux seuls éléments concernés', () => {
    const category: CategoryResult = {
      id: 'user-caches',
      totalBytes: 2,
      filesVisited: 2,
      items: [
        {
          path: '/Users/x/Library/Caches/com.google.Chrome',
          sizeBytes: 1,
          modifiedMs: 0,
          isDirectory: true,
        },
        {
          path: '/Users/x/Library/Caches/com.apple.Safari',
          sizeBytes: 1,
          modifiedMs: 0,
          isDirectory: true,
        },
      ],
    };
    const done: ScanDone = {
      scanId: 's',
      status: 'completed',
      root: '/h',
      duplicateGroups: [],
      categories: [category],
      deniedCount: 0,
      deniedDirs: [],
      durationMs: 1,
    };
    const annotated = annotateOpenApps(done, apps);
    expect(annotated.categories[0]?.items.map((i) => i.openApp)).toEqual([
      'Google Chrome',
      undefined,
    ]);
  });
});

describe('findOpenApp : nouvelles catégories (M5)', () => {
  const withBrowsers: RunningApp[] = [
    ...apps,
    { name: 'Safari', bundleId: 'com.apple.Safari' },
    { name: 'Mail', bundleId: 'com.apple.mail' },
  ];

  it('rattache chaque cache de navigateur à son navigateur', () => {
    expect(findOpenApp('browser-caches', '/Users/x/Library/Caches/Google', withBrowsers)).toBe(
      'Google Chrome',
    );
    expect(
      findOpenApp('browser-caches', '/Users/x/Library/Caches/com.apple.Safari', withBrowsers),
    ).toBe('Safari');
    expect(
      findOpenApp(
        'browser-caches',
        '/Users/x/Library/Containers/com.apple.Safari/Data/Library/Caches',
        withBrowsers,
      ),
    ).toBe('Safari');
    expect(
      findOpenApp('browser-caches', '/Users/x/Library/Caches/Firefox', withBrowsers),
    ).toBeNull();
  });

  it('rattache les pièces jointes à Mail et les caches Xcode à Xcode', () => {
    expect(findOpenApp('mail-downloads', '/x/Mail Downloads/abc', withBrowsers)).toBe('Mail');
    expect(findOpenApp('xcode-caches', '/x/Previews', withBrowsers)).toBe('Xcode');
  });

  it('déclare ces catégories comme liées à une app', () => {
    for (const id of ['browser-caches', 'mail-downloads', 'xcode-caches'] as const) {
      expect(canBelongToApp(id)).toBe(true);
    }
    expect(canBelongToApp('large-files')).toBe(false);
  });
});
