const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const APP_ICON_NAME = 'DaveAppIcon';
const APP_ICON_FILENAME = 'icon-vitruvius.png';
const execFileAsync = promisify(execFile);

const contents = {
  images: [
    {
      filename: APP_ICON_FILENAME,
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    },
  ],
  info: {
    author: 'xcode',
    version: 1,
  },
};

module.exports = function withDaveIosAppIcon(config) {
  config = withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const sourcePath = path.join(
        modConfig.modRequest.projectRoot,
        'assets',
        APP_ICON_FILENAME,
      );
      const targetDirectory = path.join(
        modConfig.modRequest.platformProjectRoot,
        modConfig.modRequest.projectName,
        'Images.xcassets',
        `${APP_ICON_NAME}.appiconset`,
      );

      await fs.promises.mkdir(targetDirectory, { recursive: true });
      await execFileAsync('sips', [
        '-z',
        '1024',
        '1024',
        sourcePath,
        '--out',
        path.join(targetDirectory, APP_ICON_FILENAME),
      ]);
      await fs.promises.writeFile(
        path.join(targetDirectory, 'Contents.json'),
        `${JSON.stringify(contents, null, 2)}\n`,
      );

      return modConfig;
    },
  ]);

  return withXcodeProject(config, (modConfig) => {
    const configurations = modConfig.modResults.pbxXCBuildConfigurationSection();

    for (const configuration of Object.values(configurations)) {
      if (configuration?.buildSettings?.PRODUCT_NAME) {
        configuration.buildSettings.ASSETCATALOG_COMPILER_APPICON_NAME = APP_ICON_NAME;
      }
    }

    return modConfig;
  });
};
