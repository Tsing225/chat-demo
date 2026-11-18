package com.tsing.deepseekforchat;

import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reads the Android system font scale (Settings.System.FONT_SCALE) so the web UI can
 * follow the system font size. Implemented in Java like ApkInstallerPlugin: the app
 * module has zero Kotlin anywhere. Registered manually in MainActivity
 * (registerPlugin); cap sync cannot wipe that. One read-only method, no permissions.
 */
@CapacitorPlugin(name = "FontScale")
public class FontScalePlugin extends Plugin {

    @PluginMethod
    public void getFontScale(PluginCall call) {
        float scale =
                Settings.System.getFloat(
                        getContext().getContentResolver(), Settings.System.FONT_SCALE, 1.0f);
        JSObject result = new JSObject();
        result.put("scale", scale);
        call.resolve(result);
    }
}
