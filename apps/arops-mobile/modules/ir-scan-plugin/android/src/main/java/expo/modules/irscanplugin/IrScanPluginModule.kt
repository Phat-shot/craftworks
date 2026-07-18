package expo.modules.irscanplugin

import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Exposes no functions to JS by itself — its only job is to register the
 * native "scanIrBeacon" VisionCamera Frame Processor Plugin (see
 * ScanIrBeaconFrameProcessorPlugin.kt) as soon as the app starts, so that
 * `VisionCameraProxy.initFrameProcessorPlugin('scanIrBeacon', {})` on the JS
 * side (see src/hooks/useIrScan.ts) can find it. OnCreate runs during Expo's
 * module registry initialization, which happens before the JS/React root
 * ever renders — well before any <Camera> could try to look the plugin up.
 */
class IrScanPluginModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("IrScanPlugin")

    OnCreate {
      FrameProcessorPluginRegistry.addFrameProcessorPlugin("scanIrBeacon") { proxy, options ->
        ScanIrBeaconFrameProcessorPlugin(proxy, options)
      }
    }
  }
}
