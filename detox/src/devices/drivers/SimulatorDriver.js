const exec = require('child-process-promise').exec;
const path = require('path');
const fs = require('fs');
const _ = require('lodash');
const IosDriver = require('./IosDriver');
const AppleSimUtils = require('../ios/AppleSimUtils');
const configuration = require('../../configuration');
const environment = require('../../utils/environment');
const DeviceRegistry = require('../DeviceRegistry');
const DetoxRuntimeError = require('../../errors/DetoxRuntimeError');
const log = require('../../utils/logger').child({ __filename });

const SimulatorLogPlugin = require('../../artifacts/log/ios/SimulatorLogPlugin');
const SimulatorScreenshotPlugin = require('../../artifacts/screenshot/SimulatorScreenshotPlugin');
const SimulatorRecordVideoPlugin = require('../../artifacts/video/SimulatorRecordVideoPlugin');

class SimulatorDriver extends IosDriver {

  constructor(config) {
    super(config);
    this._applesimutils = new AppleSimUtils();

    this.deviceRegistry = new DeviceRegistry({
      createDeviceWithProperties: this._createDeviceWithProperties.bind(this),
      getDevicesWithProperties: this._getDevicesWithProperties.bind(this),
    });
  }

  async _createDeviceWithProperties(properties) {
    const device = await this._applesimutils.getDevicesWithProperties(properties);
    return SimulatorDriver.remapSimUtilsObject(device);
  }

  async _getDevicesWithProperties(properties) {
    const devices = await this._applesimutils.getDevicesWithProperties(properties);
    return devices.map(SimulatorDriver.remapSimUtilsObject);
  }

  async _createDeviceWithProperties(properties) {
    const devices = await this._applesimutils.getDevicesWithProperties(properties);
    return devices.map(SimulatorDriver.remapSimUtilsObject);
  }

  static remapSimUtilsObject(device) {
    return _.mapKeys(device, SimulatorDriver.renameUDID);
  }

  static renameUDID(_value, key) {
    return key === 'udid' ? 'id' : key;
  }

  declareArtifactPlugins() {
    const appleSimUtils = this._applesimutils;

    return {
      log: (api) => new SimulatorLogPlugin({ api, appleSimUtils }),
      screenshot: (api) => new SimulatorScreenshotPlugin({ api, appleSimUtils }),
      video: (api) => new SimulatorRecordVideoPlugin({ api, appleSimUtils }),
    };
  }

  async prepare() {
    const detoxFrameworkPath = await environment.getFrameworkPath();

    if (!fs.existsSync(detoxFrameworkPath)) {
      throw new DetoxRuntimeError({
        message: `${detoxFrameworkPath} could not be found, this means either you changed a version of Xcode or Detox postinstall script was unsuccessful.`,
        hint: `To attempt a fix try running 'detox clean-framework-cache && detox build-framework-cache'`,
      });
    }
  }

  async cleanup(deviceId, bundleId) {
    await this.deviceRegistry.freeDevice(deviceId);
    await super.cleanup(deviceId, bundleId);
  }

  async acquireFreeDevice(name) {
    const deviceId = await this.deviceRegistry.acquireDevice(name);

    if (deviceId) {
      await this.boot(deviceId);
    } else {
      log.error({ event: 'ACQUIRE_DEVICE_ERROR' }, `Unable to acquire free device: ${name}`);
    }

    return deviceId;
  }

  async getBundleIdFromBinary(appPath) {
    try {
      const result = await exec(`/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "${path.join(appPath, 'Info.plist')}"`);
      const bundleId = _.trim(result.stdout);
      if (_.isEmpty(bundleId)) {
        throw new Error();
      }
      return bundleId;
    } catch (ex) {
      throw new Error(`field CFBundleIdentifier not found inside Info.plist of app binary at ${appPath}`);
    }
  }

  async boot(deviceId) {
    const coldBoot = await this._applesimutils.boot(deviceId);
    await this.emitter.emit('bootDevice', { coldBoot, deviceId });
  }

  async installApp(deviceId, binaryPath) {
    await this._applesimutils.install(deviceId, binaryPath);
  }

  async uninstallApp(deviceId, bundleId) {
    await this._applesimutils.uninstall(deviceId, bundleId);
  }

  async launchApp(deviceId, bundleId, launchArgs) {
    await this.emitter.emit('beforeLaunchApp', {bundleId, deviceId, launchArgs});
    const pid = await this._applesimutils.launch(deviceId, bundleId, launchArgs);
    await this.emitter.emit('launchApp', {bundleId, deviceId, launchArgs, pid});

    return pid;
  }

  async terminate(deviceId, bundleId) {
    await this._applesimutils.terminate(deviceId, bundleId);
  }

  async sendToHome(deviceId) {
    return await this._applesimutils.sendToHome(deviceId);
  }

  async shutdown(deviceId) {
    await this._applesimutils.shutdown(deviceId);
    await this.emitter.emit('shutdownDevice', { deviceId });
  }

  async setLocation(deviceId, lat, lon) {
    await this._applesimutils.setLocation(deviceId, lat, lon);
  }

  async setPermissions(deviceId, bundleId, permissions) {
    await this._applesimutils.setPermissions(deviceId, bundleId, permissions);
  }

  async resetContentAndSettings(deviceId) {
    await this.shutdown(deviceId);
    await this._applesimutils.resetContentAndSettings(deviceId);
    await this.boot(deviceId);
  }

  validateDeviceConfig(deviceConfig) {
    if (!deviceConfig.binaryPath) {
      configuration.throwOnEmptyBinaryPath();
    }

    if (!deviceConfig.name) {
      configuration.throwOnEmptyName();
    }
  }

  getLogsPaths(deviceId) {
    return this._applesimutils.getLogsPaths(deviceId);
  }
}

module.exports = SimulatorDriver;
